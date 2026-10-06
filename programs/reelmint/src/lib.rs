use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_lang::solana_program::{instruction::{Instruction, AccountMeta}, program::invoke_signed};

// Deployment placeholders. Replace with generated program ID and verifier public key before deployment.
// No one can sign as the System Program; the placeholder verifier deliberately prevents initialization.
declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZq6W2BeZ7FEfcYkgMQHGz");
pub const VERIFIER: Pubkey = pubkey!("11111111111111111111111111111111");
pub const METEORA_CONFIG: Pubkey = pubkey!("11111111111111111111111111111111");
pub const DBC: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
pub const DAMM: Pubkey = pubkey!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

#[program]
pub mod reelmint {
    use super::*;
    // The PDA can sign ONLY pool initialization and fee collection, never recipient changes,
    // LP transfers, liquidity withdrawal, arbitrary token transfers, or arbitrary CPI.
    pub fn execute_meteora<'info>(ctx: Context<'_, '_, '_, 'info, ExecuteMeteora<'info>>, data: Vec<u8>) -> Result<()> {
        require!(data.len() >= 8, VaultError::ForbiddenInstruction);
        let a = ctx.remaining_accounts;
        let vault = &ctx.accounts.vault;
        let native = token::spl_token::native_mint::ID;
        let base_ata = get_associated_token_address(&vault.key(), &vault.mint);
        let quote_ata = get_associated_token_address(&vault.key(), &native);
        if ctx.accounts.target.key() == DBC && data[..8] == [140,85,215,176,102,54,104,79] {
            require!(a.len() == 16, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[0].key(), METEORA_CONFIG, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[2].key(), vault.key(), VaultError::ForbiddenInstruction);
            require_keys_eq!(a[3].key(), vault.mint, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[4].key(), native, VaultError::ForbiddenInstruction);
        } else if ctx.accounts.target.key() == DBC && data[..8] == [82,220,250,189,3,85,107,45] {
            require!(a.len() == 13 && data.len() == 24 && data[8..16] == [0;8], VaultError::ForbiddenInstruction);
            require_keys_eq!(a[2].key(), base_ata, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[3].key(), quote_ata, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[6].key(), vault.mint, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[7].key(), native, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[8].key(), vault.key(), VaultError::ForbiddenInstruction);
        } else if ctx.accounts.target.key() == DAMM && data[..8] == [180,38,154,17,133,33,162,211] {
            require!(a.len() == 15 && data.len() == 8, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[3].key(), base_ata, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[4].key(), quote_ata, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[7].key(), vault.mint, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[8].key(), native, VaultError::ForbiddenInstruction);
            require_keys_eq!(a[10].key(), vault.key(), VaultError::ForbiddenInstruction);
        } else { return err!(VaultError::ForbiddenInstruction); }
        let accounts = a.iter().map(|v| AccountMeta { pubkey: v.key(), is_signer: v.is_signer || v.key() == vault.key(), is_writable: v.is_writable }).collect();
        let instruction = Instruction { program_id: ctx.accounts.target.key(), accounts, data };
        let mut infos = a.to_vec(); infos.push(ctx.accounts.target.to_account_info());
        let bump = [vault.bump]; let seeds: &[&[u8]] = &[b"vault", vault.mint.as_ref(), &bump];
        invoke_signed(&instruction, &infos, &[seeds])?;
        Ok(())
    }
    pub fn initialize_vault(ctx: Context<InitializeVault>, mint: Pubkey, identity: [u8; 32]) -> Result<()> {
        require!(identity != [0; 32] && mint != Pubkey::default(), VaultError::InvalidIdentity);
        let vault = &mut ctx.accounts.vault;
        vault.mint = mint;
        vault.identity = identity;
        vault.verifier = ctx.accounts.verifier.key();
        vault.bump = ctx.bumps.vault;
        emit!(VaultCreated { vault: vault.key(), mint, identity });
        Ok(())
    }
    pub fn claim(ctx: Context<Claim>, identity: [u8; 32], expires_at: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at >= now && expires_at <= now + 600, VaultError::Expired);
        require!(identity == ctx.accounts.vault.identity, VaultError::InvalidIdentity);
        let vault_key = ctx.accounts.vault.key();
        let wrapped = &ctx.accounts.wrapped_sol;
        require_keys_eq!(wrapped.key(), get_associated_token_address(&vault_key, &token::spl_token::native_mint::ID), VaultError::InvalidTokenAccount);
        if wrapped.owner == &token::ID && !wrapped.data_is_empty() {
            let data = wrapped.try_borrow_data()?;
            let account = TokenAccount::try_deserialize(&mut &data[..])?;
            require_keys_eq!(account.owner, vault_key, VaultError::InvalidTokenAccount);
            require_keys_eq!(account.mint, token::spl_token::native_mint::ID, VaultError::InvalidTokenAccount);
            drop(data);
            let mint = ctx.accounts.vault.mint;
            let bump = [ctx.accounts.vault.bump];
            let seeds: &[&[u8]] = &[b"vault", mint.as_ref(), &bump];
            token::close_account(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), CloseAccount { account: wrapped.to_account_info(), destination: ctx.accounts.vault.to_account_info(), authority: ctx.accounts.vault.to_account_info() }, &[seeds]))?;
        }
        let source = ctx.accounts.vault.to_account_info();
        let rent = Rent::get()?.minimum_balance(source.data_len());
        let amount = source.lamports().checked_sub(rent).ok_or(VaultError::InsufficientBalance)?;
        require!(amount > 0, VaultError::InsufficientBalance);
        let destination = ctx.accounts.recipient.to_account_info();
        let destination_balance = destination.lamports().checked_add(amount).ok_or(VaultError::Overflow)?;
        **source.try_borrow_mut_lamports()? -= amount;
        **destination.try_borrow_mut_lamports()? = destination_balance;
        emit!(FeesClaimed { vault: vault_key, recipient: destination.key(), amount });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteMeteora<'info> {
    pub verifier: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.mint.as_ref()], bump = vault.bump, has_one = verifier @ VaultError::InvalidVerifier)] pub vault: Account<'info, Vault>,
    /// CHECK: Program address and instruction discriminator are allowlisted in handler.
    #[account(executable)] pub target: UncheckedAccount<'info>,
}
#[derive(Accounts)]
#[instruction(mint: Pubkey, identity: [u8; 32])]
pub struct InitializeVault<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    #[account(address = VERIFIER @ VaultError::InvalidVerifier)] pub verifier: Signer<'info>,
    #[account(init, payer = payer, space = 8 + 32 + 32 + 32 + 1, seeds = [b"vault", mint.as_ref()], bump)] pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)] pub recipient: Signer<'info>,
    pub verifier: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.mint.as_ref()], bump = vault.bump, has_one = verifier @ VaultError::InvalidVerifier)] pub vault: Account<'info, Vault>,
    /// CHECK: Exact associated address, owner and native mint checked in handler. Can be uninitialized.
    #[account(mut)] pub wrapped_sol: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}
#[account]
pub struct Vault { pub mint: Pubkey, pub identity: [u8; 32], pub verifier: Pubkey, pub bump: u8 }
#[event]
pub struct VaultCreated { pub vault: Pubkey, pub mint: Pubkey, pub identity: [u8; 32] }
#[event]
pub struct FeesClaimed { pub vault: Pubkey, pub recipient: Pubkey, pub amount: u64 }
#[error_code]
pub enum VaultError {
    #[msg("Only fixed-config launches and fee collection into this vault are allowed.")] ForbiddenInstruction,
    #[msg("The account identity does not match the permanent vault recipient.")] InvalidIdentity,
    #[msg("Wrong verification authority.")] InvalidVerifier,
    #[msg("The claim authorization expired.")] Expired,
    #[msg("There are no withdrawable fees.")] InsufficientBalance,
    #[msg("Invalid wrapped SOL account.")] InvalidTokenAccount,
    #[msg("Balance overflow.")] Overflow,
}
