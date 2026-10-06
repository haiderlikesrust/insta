# Fanfare

An Instagram creator launchpad using Meteora Dynamic Bonding Curve and DAMM v2, with a custom Anchor escrow. The app is a working integration foundation; no mainnet escrow or Meta app has been deployed/configured by this build. Live transaction endpoints fail closed until configured and reviewed.

## Product rules

- A recipient must be an **existing, Meta-verified Instagram account**. The implemented Instagram Login flow supports **professional accounts**. This release requires the creator to verify before others can launch for them. It does not resolve arbitrary personal accounts or scrape Instagram.
- Vault identity is `SHA256("fanfare:instagram:v1:" + Instagram user_id)`. Handles are display/lookup values, never withdrawal authority. Recycled handles cannot inherit an old vault. Deleted/inaccessible accounts have no alternate recipient or admin recovery route.
- Fixed **2% total trading fee**, with dynamic fees disabled on DBC and the graduated DAMM v2 pool. Meteora's protocol share is deducted inside that fee; 100% of the remaining creator allocation belongs to the Instagram-bound vault. No additional platform fee is configured.
- Initial fully diluted market cap: **20 SOL**. Graduation fully diluted market cap: **250 SOL**. The SDK computes a reserve threshold of approximately **55.120302302 SOL**, which is different from market cap. Solana integer rounding makes the initial implied cap approximately 20.0000007546 SOL.
- Default supply: **1 billion tokens**, 6 decimals, immutable metadata authority, no creator token allocation. 100% of graduated liquidity is permanently locked for the creator vault. The pool continues trading after graduation.
- All app prices/market caps are displayed in **USD**, converted from SOL using the user-specified `https://frontend-api-v3.pump.fun/sol-price` endpoint. The curve itself remains SOL-denominated. Stale/unavailable prices are marked, never replaced with invented values. Network fees/payout settlement remain in SOL.
- GMGN charts use its documented embed at `https://www.gmgn.cc/kline/sol/{mint}`. Fanfare cannot override undocumented chart currency parameters; app valuation cards are USD. New token coverage depends on GMGN.

## Run locally

Use Node 22.13+ (Node 24 LTS recommended), npm, and optionally Rust/Anchor for the contract.

```powershell
npm.cmd install
npm.cmd run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_nice_scorpion.sql
npm.cmd run dev
```

Open the URL printed by the server. Production preview: `npm.cmd start -- --port 8787`.
Apply the initial local migration once per clean local database. Production Sites deployments apply the committed migrations automatically. Auth/drafts are stored in D1; local QA records do not ship to production.

```powershell
npm.cmd run typecheck
npm.cmd test
node scripts/smoke.mjs http://127.0.0.1:5173
cargo check -p reelmint
```

The smoke script creates disposable records only on localhost, uses a generated unfunded test wallet, and never submits a blockchain transaction. Native Rust compilation is not an SBF build, validator integration test, or audit.

## Connect real services

See `.env.example` for runtime names. Use the hosting secret manager for secrets; never commit Meta secrets or the verifier's secret key.

1. **Meta:** register an Instagram API app with Instagram Login and `instagram_business_basic`. Configure `${APP_ORIGIN}/api/instagram/callback` exactly. Supply `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, and the API version approved for your app. Complete Meta's required review/access setup. Test success, cancellation, revoked access, renamed accounts, and professional account eligibility. Tokens are used once to fetch `user_id,username`, then discarded; every launch/claim requires verification newer than 15 minutes.
2. **Meteora configuration:** `lib/curve.ts` is the authoritative economics configuration. `scripts/create-meteora-config.ts` prepares a partially signed configuration transaction using `SOLANA_RPC_URL` and `CONFIG_PAYER_PUBLIC_KEY`; run it with `npx tsx scripts/create-meteora-config.ts`. It writes an ignored `outputs/meteora-config-transaction.json`, **does not submit**, and does not read a payer private key. Review/sign/submit with your wallet before expiry. Persist the resulting public config address as `METEORA_CONFIG_KEY`.
3. **Escrow:** replace the explicit program ID, `VERIFIER`, and `METEORA_CONFIG` deployment placeholders in `programs/reelmint/src/lib.rs`; synchronize `Anchor.toml`. Build for Solana with Anchor in a supported environment. Review and test the contract against Meteora before deploying. Configure `ESCROW_PROGRAM_ID`, `VERIFIER_PUBLIC_KEY`, and secret `VERIFIER_SECRET_KEY` (JSON array of 64 bytes). The placeholder verifier cannot sign; initialization is intentionally impossible until replaced. Protect the upgrade authority and verifier with appropriate operational controls.
4. **End-to-end verification:** test atomic vault+pool launch, both fee claim phases, quote ATA creation/closing, DAMM migration and permanently locked position fee collection, transaction-size limits, blockhash expiry, cancellation, repeated submission, RPC timeouts, and finalized confirmation. Confirm Meteora's migration keeper handles the registered config, or operate a keeper. Price the transaction's rent/network cost in the wallet. No bundled first buy is implemented.
5. Set `APP_ORIGIN`, a mainnet `SOLANA_RPC_URL`, `SOLANA_NETWORK=mainnet-beta`, and only after review set `ESCROW_REVIEWED=true` and `LIVE_LAUNCHES_ENABLED=true`. These are operator gates, not proof of an audit. The server additionally checks the on-chain program and curve configuration and simulates unsigned transactions before returning them for wallet approval.

## Fee and trust model

The on-chain vault stores mint, permanent Instagram identity hash, verifier public key, and PDA bump. It has no recipient reassignment instruction. It can sign only allowlisted Meteora pool creation and fee-collection instructions. Collection destinations are constrained to the vault's own token accounts. The launcher cannot withdraw or transfer the creator authority/LP position.

The verifier service attests to off-chain Instagram ownership. The contract requires its signature plus the recipient wallet's signature for withdrawal, checks the identity hash and authorization expiry, and retains rent. **A compromised verifier can authorize an incorrect wallet, and an upgradeable program has upgrade-authority trust.** The design is not trustless Instagram authentication. Recovery from loss of the original account is deliberately not a reroute.

Wallet login uses single-use signed challenges and hashed server-side sessions in HttpOnly/SameSite cookies. OAuth state is single-use and session-bound. Server writes enforce same-origin requests, input limits, and per-minute throttling. Prepared transactions are bound to exact message hashes. Signatures are recorded before broadcast, and only finalized matching transactions can become listings. A refresh recovers submitted intents; expired launch attempts can return to draft only after final blockheight expiry and a check that no mint exists.

Trading occurs through Meteora-compatible routes; this release links to GMGN and embeds charts rather than implementing a separate swap terminal. No fabricated coins, balances, trading history, or fee earnings are shown. The app currently accepts permanent image/metadata URLs rather than providing a file pinning service.

## Layout

- `app/page.tsx`, `app/globals.css`: responsive launch, explore, creator claim views.
- `components/market.tsx`: USD curve summary and GMGN chart panel.
- `app/api/[...path]/route.ts`: wallet verification, Instagram link, drafts, launch/claim lifecycle.
- `lib/curve.ts`, `lib/chain.ts`, `lib/escrow.ts`: fixed economics, Meteora transaction building, escrow instruction encoding.
- `programs/reelmint/src/lib.rs`: Anchor escrow source (deployment placeholders).
- `db/schema.ts`, `drizzle/`: durable records and schema migrations.
- `public/fanfare-logo.png`: generated transparent brand symbol.

## Primary integration references

- [Meteora DBC SDK](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk)
- [Meteora DBC program](https://github.com/MeteoraAg/dynamic-bonding-curve)
- [Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)
- [GMGN chart embed](https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-price-chart)

Fanfare is independent of Meta, Instagram, Meteora, and GMGN. Creator verification does not imply endorsement of a community token. Brand name availability has not been legally cleared.
