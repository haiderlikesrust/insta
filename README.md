# Instara

An Instagram creator launchpad using Meteora Dynamic Bonding Curve and DAMM v2, with a custom Anchor escrow. The app is a working integration foundation; the mainnet escrow and profile-reading credentials still need deployment/configuration. Live transaction endpoints fail closed until configured and reviewed.

## Product rules

- Anyone can launch for an **existing public Instagram account** after a server-side profile lookup. The creator does not need to join first. Fees remain locked until the owner adds a generated code to their bio and verifies with a wallet. Personal, Creator, and Business profiles are eligible if the reader can retrieve them. Private, missing, ambiguous, or unreadable profiles fail closed.
- A persistent **Claimed** badge appears beside tokens after the linked account completes ownership verification. It follows the numeric account ID, survives verification expiry and handle changes, and does not mean fees were withdrawn or the token was endorsed. Profile existence checks alone never set this badge.
- Vault identity is `SHA256("fanfare:instagram:v1:instagram-public:" + Instagram numeric account ID)`. Handles are display/lookup values, never withdrawal authority. Public IDs are explicitly namespaced separately from the retired OAuth integration's scoped IDs; no automatic migration or fee reassignment occurs. Recycled handles cannot inherit an old vault. Deleted/inaccessible accounts have no alternate recipient or admin recovery route.
- Fixed **2% total trading fee**, with dynamic fees disabled on DBC and the graduated DAMM v2 pool. Meteora's protocol share is deducted inside that fee; 100% of the remaining creator allocation accrues in the Instagram-bound vault. Each claim deducts **10% to buy and burn INSTARA**, then pays **90% to the verified creator**, atomically. The main INSTARA token is exempt: its creator fees go entirely to the dev wallet.
- Initial fully diluted market cap: **20 SOL**. Graduation fully diluted market cap: **250 SOL**. The SDK computes a reserve threshold of approximately **55.120302302 SOL**, which is different from market cap. Solana integer rounding makes the initial implied cap approximately 20.0000007546 SOL.
- Default supply: **1 billion tokens**, 6 decimals, immutable metadata authority, no creator token allocation. 100% of graduated liquidity is permanently locked for the creator vault. The pool continues trading after graduation.
- All app prices/market caps are displayed in **USD**, converted from SOL using the user-specified `https://frontend-api-v3.pump.fun/sol-price` endpoint. The curve itself remains SOL-denominated. Stale/unavailable prices are marked, never replaced with invented values. Network fees/payout settlement remain in SOL.
- GMGN charts use its documented embed at `https://www.gmgn.cc/kline/sol/{mint}`. Instara cannot override undocumented chart currency parameters; app valuation cards are USD. New token coverage depends on GMGN.

See [main-token launch and buyback setup](docs/MAIN-TOKEN.md) for `/admin`, `DEV_WALLET_ADDRESS`, `INSTARA_MINT`, and the atomic 90/10 community payout.

## Run locally

For production, follow [the Dokploy setup](docs/DOKPLOY.md) for **https://instara.xyz**. It uses Node, Nginx and PostgreSQL, matching Grailshot's deployment structure. The commands below are the optional local Cloudflare preview.

Use Node 22.13+ (Node 24 LTS recommended), npm, and optionally Rust/Anchor for the contract.

```powershell
npm.cmd install
npm.cmd run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_nice_scorpion.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_yummy_queen_noir.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_colossal_kid_colt.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_legal_sally_floyd.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_vengeful_venom.sql
npm.cmd run dev
```

Open the URL printed by the server. Production preview: `npm.cmd start -- --port 8787`.
Apply each local migration once, in order. Production Sites deployments apply the committed migrations automatically. Auth/drafts are stored in D1; local QA records do not ship to production.

```powershell
npm.cmd run typecheck
npm.cmd test
node scripts/smoke.mjs http://127.0.0.1:5173
cargo check -p reelmint
```

The smoke script creates disposable records only on localhost, uses a generated unfunded test wallet, and never submits a blockchain transaction. Native Rust compilation is not an SBF build, validator integration test, or audit.

## Connect real services

See `.env.example` for runtime names. Use the hosting secret manager for secrets; never commit the Apify token or verifier's secret key.

1. **Profile reader:** create an Apify account, open Console → Settings → API & Integrations, and store its token as the server-only secret `APIFY_API_TOKEN`. No Meta app or Instagram password is collected in this flow. The backend runs `apify/instagram-profile-scraper` for one username. A first read fixes the numeric account ID before revealing the random code; a second fresh run checks the bio. Each code contains 128 random bits, expires after 15 minutes, is bound to the signed wallet session, and is consumed atomically. Claims require ownership verification newer than 15 minutes; launches require a profile existence check newer than 15 minutes. The profile response also supplies follower count, bio, and optional picture; these are not proofs by themselves. Test real profile freshness, missing/private profiles, wrong codes, ID changes, API quota failures, and account renames before enabling payouts. Live provider calls have not been tested without credentials.
2. **Meteora configuration:** `lib/curve.ts` is the authoritative economics configuration. `scripts/create-meteora-config.ts` prepares a partially signed configuration transaction using `SOLANA_RPC_URL` and `CONFIG_PAYER_PUBLIC_KEY`; run it with `npx tsx scripts/create-meteora-config.ts`. It writes an ignored `outputs/meteora-config-transaction.json`, **does not submit**, and does not read a payer private key. Review/sign/submit with your wallet before expiry. Persist the resulting public config address as `METEORA_CONFIG_KEY`.
3. **Escrow:** replace the explicit program ID, `VERIFIER`, and `METEORA_CONFIG` deployment placeholders in `programs/reelmint/src/lib.rs`; synchronize `Anchor.toml`. Build for Solana with Anchor in a supported environment. Review and test the contract against Meteora before deploying. Configure `ESCROW_PROGRAM_ID`, `VERIFIER_PUBLIC_KEY`, and secret `VERIFIER_SECRET_KEY` (JSON array of 64 bytes). The placeholder verifier cannot sign; initialization is intentionally impossible until replaced. Protect the upgrade authority and verifier with appropriate operational controls.
4. **End-to-end verification:** test atomic vault+pool launch, both fee claim phases, persistent fee ATA and temporary payout-account handling, DAMM migration and permanently locked position fee collection, transaction-size limits, blockhash expiry, cancellation, repeated submission, RPC timeouts, and finalized confirmation. Confirm Meteora's migration keeper handles the registered config, or operate a keeper. Price the transaction's rent/network cost in the wallet. No bundled first buy is implemented.
5. Set `APP_ORIGIN`, a mainnet `SOLANA_RPC_URL`, `SOLANA_NETWORK=mainnet-beta`, and only after review set `ESCROW_REVIEWED=true` and `LIVE_LAUNCHES_ENABLED=true`. These are operator gates, not proof of an audit. The server additionally checks the on-chain program and curve configuration and simulates unsigned transactions before returning them for wallet approval.

## Fee and trust model

The on-chain vault stores mint, permanent Instagram identity hash, verifier public key, and PDA bump. It has no recipient reassignment instruction. It can sign allowlisted Meteora pool creation, fee collection, and claim-time exact-input buybacks of the immutable INSTARA mint. Collection destinations are constrained to the vault's own token accounts. The launcher cannot withdraw or transfer the creator authority/LP position.

The verifier service attests to off-chain Instagram ownership. The contract requires its signature plus the recipient wallet's signature for withdrawal, checks the identity hash and authorization expiry, and retains rent. **A compromised verifier can authorize an incorrect wallet, and an upgradeable program has upgrade-authority trust.** The design is not trustless Instagram authentication. Recovery from loss of the original account is deliberately not a reroute.

Wallet login uses single-use signed challenges and hashed server-side sessions in HttpOnly/SameSite cookies. Bio codes are session-bound, single-use, and expire. The profile-reading provider is an additional trust point: this is a server attestation, not a cryptographic proof from Instagram. Users should only paste codes generated using their own wallet. Server writes enforce same-origin requests, input limits, and per-minute throttling. The server limits profile reads to 50/day across the app and passes a $0.01 per-run charge ceiling to Apify. Also set a provider spending limit; the free plan is usage-limited, not unlimited. Verification typically takes two paid profile reads. No credentials means verification is unavailable, never a fake success.

Prepared transactions are bound to exact message hashes. Signatures are recorded before broadcast, and only finalized matching transactions can become listings. A refresh recovers submitted intents; expired launch attempts can return to draft only after final blockheight expiry and a check that no mint exists.

Trading occurs through Meteora-compatible routes; this release links to GMGN and embeds charts rather than implementing a separate swap terminal. No fabricated coins, balances, trading history, or fee earnings are shown. The app currently accepts permanent image/metadata URLs rather than providing a file pinning service.

## Layout

- `app/page.tsx`, `app/globals.css`: responsive launch, explore, creator claim views.
- `components/market.tsx`: USD curve summary and GMGN chart panel.
- `app/api/[...path]/route.ts`: wallet verification, bio verification, drafts, launch/claim lifecycle.
- `components/bio-verification.tsx`, `lib/bio.ts`, `lib/bio-proof.ts`, `lib/profile-reader.ts`: code generation, asynchronous public-profile reading, account binding, and proof consumption.
- `lib/curve.ts`, `lib/chain.ts`, `lib/escrow.ts`: fixed economics, Meteora transaction building, escrow instruction encoding.
- `programs/reelmint/src/lib.rs`: Anchor escrow source (deployment placeholders).
- `db/schema.ts`, `drizzle/`: durable records and schema migrations.
- `public/brand-logo.png`: generated transparent brand symbol.

## Primary integration references

- [Meteora DBC SDK](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk)
- [Meteora DBC program](https://github.com/MeteoraAg/dynamic-bonding-curve)
- [Apify Instagram Profile Scraper](https://apify.com/apify/instagram-profile-scraper)
- [Apify pricing](https://apify.com/pricing)
- [GMGN chart embed](https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-price-chart)

Instara is independent of Meta, Instagram, Meteora, and GMGN. Creator verification does not imply endorsement of a community token. Brand name availability has not been legally cleared.
