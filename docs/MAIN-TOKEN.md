# Main token and claim-time buyback

## Private main-token launcher

Open `/admin`. `DEV_WALLET_ADDRESS` is a public Solana address, not a private key or a password. The wallet must sign the standard one-time login challenge before the server permits any admin reads or writes. Other wallets receive 403; an unset allowlist fails closed. Hiding the URL is not the access control.

The main token is fixed to name **Instara** / ticker **INSTARA**. Its creator authority is the dev wallet itself. There is no Instagram binding, and **100% of its creator fees after Meteora's protocol share go to the dev wallet**, without the community buyback deduction. It uses the existing 2% trading fee and 20 / 250 SOL market-cap curve. The page also supports dev fee claims after launch and graduation.

Set `APP_ORIGIN`, `DEV_WALLET_ADDRESS`, `SOLANA_RPC_URL`, `SOLANA_NETWORK=mainnet-beta`, and `METEORA_CONFIG_KEY`. After testing the configuration, set `MAIN_LAUNCH_ENABLED=true`. Main launch is independent of the Instagram reader, the INSTARA mint setting and the community escrow flags. The dev wallet signs the actual launch transaction; the server never needs its secret key. The payer covers network fees and account rent. Supply remains 1 billion and no dev token allocation is added.

A reserved database record allows only one main launch. Pending launches must be confirmed or safely recovered after blockhash expiry and an on-chain mint check. Setting `INSTARA_MINT` also blocks creating a second main token. Keep database backups; deleting the database removes the launch record. Changing the configured dev wallet does not transfer the existing on-chain creator authority.

After finalization, copy the displayed mint into `INSTARA_MINT` in Dokploy's environment and redeploy. The application does not mutate its own environment. The main token needs liquidity before buybacks can execute.

## Community fee claims

Meteora still allocates all non-protocol creator fees and permanently locked creator liquidity to the Instagram vault. There is no recurring buyback worker and no deduction while fees are accumulating. **At each payout** the escrow spends floor(gross lamports / 10) buying INSTARA, burns the exact acquired token amount using SPL Token's burn instruction, and sends the remaining lamports as native SOL to the verified creator. Rounding dust goes to the creator. Minimum gross claim is 10,000 lamports and the quote must produce a positive minimum output. Network fees, account rent, and the buyback pool's own swap fee are separate; the 10% is the total swap input, not a guaranteed token output.

Collection, buyback, burn and payout share one transaction. A bad mint, unavailable pool, insufficient liquidity, failed minimum-output check, or failed burn rolls everything back. The signed gross amount is fixed; additional fees collected after quoting remain in the vault's wrapped-SOL account for a later claim. That account's rent is never included in the split. A temporary payout account is created and closed in the same transaction, returning its rent to the payer. Existing creator wallet token accounts are not closed. There is no alternative untaxed community payout instruction.

The buyback mint is read from `INSTARA_MINT` and must match an immutable on-chain `buyback` policy PDA initialized once by the deployment verifier. Editing `.env` cannot silently redirect existing buybacks to another mint. The implementation supports standard SPL Token INSTARA/SOL pools on Meteora DBC and DAMM v2. The main launch pool is derived automatically; a migrated DBC pool resolves to its DAMM pool. `INSTARA_BUYBACK_POOL` can optionally select another compatible pool. Only a Meteora exact-input swap is allowed by the escrow; arbitrary CPI and referrals are rejected. `BUYBACK_SLIPPAGE_BPS` defaults to 100 (1%) and is bounded to 1–300.

## One-time buyback setup

After deploying the updated escrow and launching/funding the main token:

1. Set `INSTARA_MINT` and the verifier/configuration variables in a secure shell environment.
2. Run `npx tsx scripts/prepare-buyback-setup.ts`. It writes unsigned/partially signed transactions to ignored `outputs/buyback-setup.json` and **does not broadcast**.
3. Review and sign the policy initialization, lookup-table creation, and table-extension transactions using the dev wallet, in order before their blockhash expires. The policy pins the target mint permanently. The verifier also signs its initialization. Keep `MAIN_LAUNCH_ENABLED=true` only when main-token operations are intended.
4. Set `SOLANA_LOOKUP_TABLES` to the generated table address after it is finalized and active. Tables contain public addresses only. The setup table covers shared accounts for the currently selected buyback pool. Extend the table with the new pool's public accounts after INSTARA graduates or if a transaction exceeds 1,232 bytes. Transactions fail closed when too large; fees are not collected separately as a workaround.
5. Complete on-chain integration testing and escrow review before enabling `ESCROW_REVIEWED=true` and `LIVE_LAUNCHES_ENABLED=true`.

Confirmed transactions contain `FeesClaimed` and `InstaraBurned` events with the creator payout, gross amount, SOL spent and tokens burned. No burn totals are fabricated or inferred from submitted transactions.

Validation in this repository covers native Rust compilation and integer splitting, JS instruction encoding/signatures/access control, SQL persistence and HTTP authorization. It does not replace an SBF build, validator tests against Meteora programs, or a smart-contract audit. Test both source fee-collection phases and both buyback pool phases, atomic rollback on slippage/burn failure, extra fees arriving during quotes, wrong-mint/pool injection, replay, and transaction size before live use.
