# Main token and backend payouts

## Setup through /admin

1. Set APP_ORIGIN, DEV_WALLET_ADDRESS (public address) and SOLANA_RPC_URL (mainnet). Sign into /admin with the dev wallet.
2. Click **Create launch configuration** and approve the transaction. The fixed 2% / 20-to-250 SOL market-cap configuration is created on Meteora and saved in PostgreSQL after finality. This is a config account, not an API key or a custom program.
3. Enable MAIN_LAUNCH_ENABLED when ready. Supply the permanent metadata/image URLs and launch INSTARA. Its mint is saved automatically. All main-token creator fees after Meteora's protocol share go directly to the dev wallet, without Instagram verification or the 10% deduction.
4. Click **Prepare creator claims** to create and save the shared transaction lookup table. Keep this table active; the dev wallet controls it. If a future route exceeds the packet limit, extend this table with the new accounts before retrying.
5. Configure APIFY_API_TOKEN and BACKEND_WALLET_SECRET_KEY. Fund the dedicated backend wallet with SOL for network fees and rent. Test end to end before enabling LIVE_LAUNCHES_ENABLED.

No manual METEORA_CONFIG_KEY, INSTARA_MINT or SOLANA_LOOKUP_TABLES is needed for this workflow. Existing environment overrides remain supported; remove old placeholder values. Optional advanced overrides: INSTARA_BUYBACK_POOL and BUYBACK_SLIPPAGE_BPS (default 100, bounded 1–300).

Wallet-approved setup transactions are confirmed before their addresses are saved. Database constraints prevent duplicate pending setups. Expired transactions can be recovered only after finalized block-height expiry and an on-chain absence check. Preserve the database across redeployments. The server never needs the dev wallet's private key.

## Custody model

There is no custom Instara Solana program. Meteora and SPL Token perform all on-chain operations. One backend private key deterministically derives an isolated fee authority per coin from its mint using HMAC-SHA256. The database binds each coin to its permanent Instagram ID. Handles cannot authorize withdrawal.

Meteora fees accumulate under that authority until a freshly verified creator requests a claim. There is no continuous sweep before verification. A signed wallet session and recent bio proof authorize the payout wallet. Claims are submitted by the backend and do not require another wallet transaction signature.

**This is custodial.** The operator controls the fee-wallet keys and can act outside the app. Protect and back up both the master key and database. Changing the key does not transfer existing fee authority; restore the original key or perform an explicit migration. Existing custom-program pools are not automatically rerouted. The app has no fallback recipient for an inaccessible Instagram account.

## Claim sequence

1. Simulate collection from DBC and, after graduation, permanently locked DAMM v2 positions. Snapshot the fee wallet's WSOL amount, excluding rent. Reserve floor(gross / 10) for the buyback and the remainder for the creator. Minimum gross is 10,000 lamports and the quote must return positive output.
2. Save a unique pending claim and its fully signed **collection + exact-input buyback** transaction before broadcasting. Buy INSTARA using the fixed 10% input and an enforced minimum output. Additional fees collected after the snapshot remain for a future claim.
3. Wait for finalized confirmation, verify the exact transaction message, and read the actual tokens purchased from pre/post token balances. The original payout wallet and buyback mint are stored on the claim.
4. Save and broadcast a second transaction that **burns the exact acquired tokens and pays the creator's 90% in native SOL together**. A temporary WSOL account unwraps the payout. The backend pays network costs and account rent separately; rent is refunded to the backend.
5. Mark completion only after a matching finalized payout. The Dokploy worker checks pending claims every 15 seconds; user confirmation can also resume them.

These are two transactions. A failed payout leaves the purchased tokens and reserved funds in backend custody for retry; it does not buy again. Burn and transfer share the second transaction, so failure rolls both back. Signed bytes are durable before broadcast. Retries resend identical bytes; replacements require finalized failure or finalized expiry with no successful signature status. Unique claims and compare-and-swap writes prevent concurrent payouts.

The 10% is swap input, including the pool's swap fee. Slippage changes tokens received. No burn totals are fabricated. Pending claims keep their recorded target and recipient even if environment values or login state change.

## Before public funds

Automated tests cover authorization, rounding, key isolation, SQL uniqueness, worker authentication, payout instructions, concurrent workers, timeout retries, expiry and replay. They use mocked RPC responses and do not replace live DBC/DAMM tests. Validate real profile freshness, graduation, liquidity, lookup-table sizing, funded fee accounts, RPC history, process restarts and recovery before public launches.
