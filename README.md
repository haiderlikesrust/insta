# Instara

Instagram creator-token launchpad on Meteora DBC and DAMM v2 with backend-controlled fee wallets. **No custom Solana program is required.** Production hosting: Dokploy at https://instara.xyz.

## Product rules

- Launch for an existing public Instagram account after a fresh profile lookup. Its owner can join later and verify using a one-time code in their bio. Missing, private, ambiguous or unreadable accounts fail closed.
- A persistent **Claimed** badge follows the permanent account ID after verification. It does not mean the creator endorsed the coin or withdrew fees. Recycled handles cannot inherit old earnings.
- Fixed **2% trading fee** before and after graduation. Meteora takes its protocol share. Each community creator claim spends **10% buying and burning INSTARA** and pays **90% to the creator**. The main token is exempt: all its creator fees go to the dev wallet.
- Starts at **20 SOL market cap**, graduates at **250 SOL market cap**. The reserve threshold is about 55.120302302 SOL, which is different from market cap. Supply: 1 billion, 6 decimals, no creator token allocation, permanently locked creator liquidity after migration.
- App valuations display USD using the requested pump.fun SOL-price endpoint. Settlement is SOL. GMGN charts depend on its coverage.
- Instara holds fee-wallet keys. Verification and payout enforcement are backend responsibilities; this is custodial.

## Setup

See [Dokploy deployment](docs/DOKPLOY.md), [main token and payouts](docs/MAIN-TOKEN.md), and deploy/dokploy.env.example.

Required inputs: APP_ORIGIN, POSTGRES_PASSWORD, DEV_WALLET_ADDRESS, SOLANA_RPC_URL, APIFY_API_TOKEN and BACKEND_WALLET_SECRET_KEY. Keep MAIN_LAUNCH_ENABLED and LIVE_LAUNCHES_ENABLED false until ready and tested. The backend key accepts base58 or a JSON array of 64 bytes. Use a dedicated funded wallet and securely back it up; do not use a personal wallet key.

Sign into /admin to create the Meteora configuration, launch INSTARA and prepare the claim lookup table. Generated addresses are saved automatically after finalized wallet-approved transactions. Remove old placeholder environment overrides. No escrow program ID or verifier keys are needed.

Apify's token is in Console → Settings → API & Integrations. The reader uses apify/instagram-profile-scraper for one public username. Bio codes have 128 random bits, expire after 15 minutes, bind to a signed wallet session and permanent account ID, and are consumed once. Claims need verification newer than 15 minutes. The app limits reads to 50/day and requests a $0.01 per-run charge ceiling; set provider spending limits too. No Meta login or Instagram password is collected.

## Run and validate

Use Node 22.13+ and npm. Run npm ci, npm run typecheck, npm test and npm run build:dokploy. Dokploy includes a Node web application, Nginx gateway, settlement worker and PostgreSQL. Migrations apply automatically.

The optional Cloudflare preview uses a separate local D1 database. Build with npm run build, then apply each committed drizzle/*.sql migration exactly once in filename order using Wrangler's local D1 execute command. Run npm start -- --port 8787. Local records do not ship to production. The standalone worker is part of Dokploy; local preview confirmation also resumes claims.

The localhost-only scripts/smoke.mjs checks auth, persistence, CSRF and disabled live gates with disposable unfunded wallets. Financial tests use mocked RPC responses. Real profile reads, DBC/DAMM collection, swaps, burns and restart recovery still need controlled integration testing before public funds.

## Payout and trust model

Each coin gets an isolated deterministic backend fee wallet. PostgreSQL binds it to the Instagram ID and serializes claims. The first transaction collects fees and buys INSTARA. After finality, the second burns the actual purchased tokens and pays the creator atomically. Signed transactions are persisted before broadcast and retried until finality or definitive failure/expiry. The worker cannot initiate a new claim or change its recipient.

This model trusts the operator, backend signing key, database and profile reader. Back up the key and database together. Changing the key does not recover existing authorities. Fees for inaccessible accounts have no automatic alternate recipient.

Wallet challenges are single-use; sessions use HttpOnly/SameSite cookies. Writes enforce origin checks, validation and rate limits. Launch transactions are bound to exact message hashes and listed only after finalized confirmation. Expired launches require block-height and mint-absence checks before recovery.

Each confirmed mint has a public /token/<address> page with a GMGN chart, USD valuations, creator badge, contract address and social links. Explore sorts by newest, oldest or 24-hour USD volume from DEX Screener (unindexed coins show unavailable volume).

Both launch forms accept image uploads and optional website, X, Telegram and USD dev-buy amounts. Images are compressed in the browser and stored in the database; launch metadata is generated automatically at an immutable content-addressed URL. The default metadata website is APP_ORIGIN/token/<mint>. These hosted assets depend on your domain and database backups; no external pinning API is needed. A dev buy is an atomic Meteora first purchase by the launching wallet, quoted against the initial curve with 1% slippage protection and a fresh SOL/USD conversion. Network/account creation costs are additional. Zero skips the purchase. This app links to GMGN for subsequent trading. No fake coins, balances, volume or earnings are displayed.

## Files

- lib/curve.ts and lib/chain.ts: economics and Meteora launches.
- lib/custody.ts, lib/custodial-claims.ts and lib/settlement-engine.ts: backend fee wallets and durable payouts.
- lib/bio.ts, lib/bio-proof.ts and lib/bio-store.ts: Instagram verification.
- app/admin/page.tsx and lib/main-token.ts: restricted setup and main launch.
- scripts/settlement-worker.mjs: authenticated settlement retries.
- db/schema.ts and drizzle/: configuration and transaction ledger.
- public/brand-logo.png, public/instara-logo-square.png and public/instara-x-banner.png: brand assets.

## References

- [Meteora DBC SDK](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk)
- [Meteora DBC program](https://github.com/MeteoraAg/dynamic-bonding-curve)
- [Apify Instagram Profile Scraper](https://apify.com/apify/instagram-profile-scraper)
- [GMGN chart embed](https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-price-chart)

Instara is independent of Instagram, Meta, Meteora and GMGN. Verification is not endorsement of a community coin.
