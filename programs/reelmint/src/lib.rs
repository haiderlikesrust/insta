use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, CloseAccount, Mint, Token, TokenAccount, Transfer};
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
    pub fn initialize_buyback(ctx: Context<InitializeBuyback>) -> Result<()> {
        require_keys_neq!(ctx.accounts.instara_mint.key(), token::spl_token::native_mint::ID, VaultError::InvalidTokenAccount);
        ctx.accounts.buyback.instara_mint = ctx.accounts.instara_mint.key();
        Ok(())
    }
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
    pub fn claim<'info>(ctx: Context<'_, '_, '_, 'info, Claim<'info>>, identity: [u8; 32], expires_at: i64, gross_amount: u64, minimum_out: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at >= now && expires_at <= now + 600, VaultError::Expired);
        require!(identity == ctx.accounts.vault.identity, VaultError::InvalidIdentity);
        let vault_key = ctx.accounts.vault.key();
        // Fixed, signed gross amount: fees earned after quoting remain in this vault.
        let (buyback_amount, creator_amount) = split_claim(gross_amount)?;
        require!(gross_amount <= ctx.accounts.wrapped_sol.amount && minimum_out > 0, VaultError::InsufficientBalance);
        let a = ctx.remaining_accounts;
        let target = ctx.accounts.swap_program.key();
        let (input, output, base, quote, authority, token_a, token_b, referral) = if target == DBC {
            require!(a.len() == 15, VaultError::ForbiddenInstruction);
            (3,4,7,8,9,10,11,12)
        } else if target == DAMM {
            require!(a.len() == 14, VaultError::ForbiddenInstruction);
            (2,3,6,7,8,9,10,11)
        } else { return err!(VaultError::ForbiddenInstruction); };
        require_keys_eq!(a[input].key(), ctx.accounts.wrapped_sol.key(), VaultError::InvalidTokenAccount);
        require_keys_eq!(a[output].key(), ctx.accounts.instara_tokens.key(), VaultError::InvalidTokenAccount);
        require_keys_eq!(a[base].key(), ctx.accounts.instara_mint.key(), VaultError::InvalidTokenAccount);
        require_keys_eq!(a[quote].key(), token::spl_token::native_mint::ID, VaultError::InvalidTokenAccount);
        require_keys_eq!(a[authority].key(), vault_key, VaultError::ForbiddenInstruction);
        require_keys_eq!(a[token_a].key(), token::ID, VaultError::ForbiddenInstruction);
        require_keys_eq!(a[token_b].key(), token::ID, VaultError::ForbiddenInstruction);
        require_keys_eq!(a[referral].key(), target, VaultError::ForbiddenInstruction); // Anchor None sentinel.
        require_keys_eq!(a[a.len()-1].key(), target, VaultError::ForbiddenInstruction);
        let before = ctx.accounts.instara_tokens.amount;
        let before_quote = ctx.accounts.wrapped_sol.amount;
        let mint = ctx.accounts.vault.mint;
        let bump = [ctx.accounts.vault.bump];
        let seeds: &[&[u8]] = &[b"vault", mint.as_ref(), &bump];
        let mut data = vec![248,198,158,145,225,117,135,200]; // Meteora exact-input swap only.
        data.extend_from_slice(&buyback_amount.to_le_bytes());
        data.extend_from_slice(&minimum_out.to_le_bytes());
        let accounts = a.iter().map(|v| AccountMeta { pubkey: v.key(), is_signer: v.key() == vault_key, is_writable: v.is_writable }).collect();
        let ix = Instruction { program_id: target, accounts, data };
        let mut infos = a.to_vec(); infos.push(ctx.accounts.swap_program.to_account_info());
        invoke_signed(&ix, &infos, &[seeds])?;
        ctx.accounts.instara_tokens.reload()?;
        ctx.accounts.wrapped_sol.reload()?;
        let bought = ctx.accounts.instara_tokens.amount.checked_sub(before).ok_or(VaultError::InvalidTokenAccount)?;
        require!(bought >= minimum_out && before_quote.checked_sub(ctx.accounts.wrapped_sol.amount) == Some(buyback_amount), VaultError::InvalidTokenAccount);
        token::burn(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Burn { mint: ctx.accounts.instara_mint.to_account_info(), from: ctx.accounts.instara_tokens.to_account_info(), authority: ctx.accounts.vault.to_account_info() }, &[seeds]), bought)?;
        token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer { from: ctx.accounts.wrapped_sol.to_account_info(), to: ctx.accounts.payout_sol.to_account_info(), authority: ctx.accounts.vault.to_account_info() }, &[seeds]), creator_amount)?;
        // This temporary account is created for this claim; never close a user's existing ATA.
        token::close_account(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), CloseAccount { account: ctx.accounts.payout_sol.to_account_info(), destination: ctx.accounts.recipient.to_account_info(), authority: ctx.accounts.vault.to_account_info() }, &[seeds]))?;
        emit!(FeesClaimed { vault: vault_key, recipient: ctx.accounts.recipient.key(), amount: creator_amount });
        emit!(InstaraBurned { vault: vault_key, mint: ctx.accounts.instara_mint.key(), gross_amount, spent_lamports: buyback_amount, burned_tokens: bought });
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
pub struct InitializeBuyback<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    #[account(address = VERIFIER @ VaultError::InvalidVerifier)] pub verifier: Signer<'info>,
    #[account(init, payer = payer, space = 8 + 32, seeds = [b"buyback"], bump)] pub buyback: Account<'info, Buyback>,
    pub instara_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)] pub recipient: Signer<'info>,
    pub verifier: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.mint.as_ref()], bump = vault.bump, has_one = verifier @ VaultError::InvalidVerifier)] pub vault: Account<'info, Vault>,
    #[account(mut, token::authority = vault, token::mint = native_mint, constraint = wrapped_sol.key() == get_associated_token_address(&vault.key(), &native_mint.key()) @ VaultError::InvalidTokenAccount)] pub wrapped_sol: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    #[account(seeds = [b"buyback"], bump, has_one = instara_mint @ VaultError::InvalidTokenAccount)] pub buyback: Account<'info, Buyback>,
    #[account(mut)] pub instara_mint: Account<'info, Mint>,
    #[account(mut, token::authority = vault, token::mint = instara_mint, constraint = instara_tokens.key() == get_associated_token_address(&vault.key(), &instara_mint.key()) @ VaultError::InvalidTokenAccount)] pub instara_tokens: Account<'info, TokenAccount>,
    #[account(init, payer = recipient, seeds = [b"payout", vault.key().as_ref()], bump, token::mint = native_mint, token::authority = vault)] pub payout_sol: Account<'info, TokenAccount>,
    #[account(address = token::spl_token::native_mint::ID)] pub native_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    /// CHECK: Only DBC/DAMM exact-input swaps are allowed by the handler.
    #[account(executable)] pub swap_program: UncheckedAccount<'info>,
}
#[account]
pub struct Vault { pub mint: Pubkey, pub identity: [u8; 32], pub verifier: Pubkey, pub bump: u8 }
#[account]
pub struct Buyback { pub instara_mint: Pubkey }
pub fn split_claim(gross: u64) -> Result<(u64,u64)> {
    require!(gross >= 10_000, VaultError::InsufficientBalance);
    let buyback = gross / 10;
    Ok((buyback, gross - buyback))
}
#[event]
pub struct VaultCreated { pub vault: Pubkey, pub mint: Pubkey, pub identity: [u8; 32] }
#[event]
pub struct FeesClaimed { pub vault: Pubkey, pub recipient: Pubkey, pub amount: u64 }
#[event]
pub struct InstaraBurned { pub vault: Pubkey, pub mint: Pubkey, pub gross_amount: u64, pub spent_lamports: u64, pub burned_tokens: u64 }
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deduction_is_ten_percent_without_overflow_or_lost_remainder() {
        assert!(split_claim(9999).is_err());
        for gross in [10_000, 1_000_000_000, 10_009, u64::MAX] {
            let (burn, creator) = split_claim(gross).unwrap();
            assert_eq!(burn, gross / 10);
            assert_eq!(burn + creator, gross);
        }
    }
}
