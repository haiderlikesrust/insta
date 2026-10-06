# Deploy Instara with Dokploy

This follows Grailshot's deployment pattern: a standalone Node web server behind Nginx, PostgreSQL on a private network, and a persistent database volume. Only the gateway joins `dokploy-network`. The application includes its API, so it does not need Grailshot's separate game service.

## Dokploy settings

1. Create a project and a **Compose** service named `instara`.
2. Select the GitHub repository `haiderlikesrust/insta`, branch `main`. For Git URL source, use `https://github.com/haiderlikesrust/insta.git`.
3. Set Compose path to `compose.dokploy.yaml` and build context to the repository root. Do not use the CI override on the public server.
4. Copy `deploy/dokploy.env.example` into Dokploy's environment settings. Keep `APP_ORIGIN=https://instara.xyz`. Replace `POSTGRES_PASSWORD` with a unique long alphanumeric password; this is interpolated into a database URL.
5. Add domain **instara.xyz** to service **gateway**, container port **80**, path `/`. Enable HTTPS and Let's Encrypt. Point the domain's DNS at your Dokploy server.
6. Deploy. `/api/health` must return HTTP 200 with `database: "postgres"`. Migrations run automatically under a PostgreSQL advisory lock before database requests are served.

Keep `LIVE_LAUNCHES_ENABLED=false` and `ESCROW_REVIEWED=false` until the contract and end-to-end transactions are reviewed and tested. The website can run without external credentials; profile checks need `APIFY_API_TOKEN`. Live launches additionally require the RPC, Meteora config, and escrow/verifier configuration described in the main README. Store secrets only in Dokploy, never source or public build variables.

The session cookie uses `APP_ORIGIN` to select Secure mode. `TRUST_PROXY_HOPS=2` assumes Dokploy's reverse proxy → Nginx → Node. Keep Node private; adjust the hop count if your proxy topology changes.

## Persistence and updates

The named `instara-postgres` volume stores sessions, tokens, profile ownership and verification state. Keep the same Compose project when updating. Back up PostgreSQL before updates; do not remove its volume when redeploying. Changing the environment password does not automatically change the password of an initialized PostgreSQL volume.

The Node build uses PostgreSQL. The optional local Cloudflare preview uses a separate SQLite/D1 database; local records are not copied into production. Identity hashes retain the original `fanfare:instagram:v1:` namespace for compatibility; the name change never reroutes a vault.

## Validate the complete stack locally

With Docker running, set `APP_ORIGIN=http://127.0.0.1:8080` and a disposable `POSTGRES_PASSWORD`, then run:

```sh
docker network create dokploy-network
docker compose -p instara-ci -f compose.dokploy.yaml -f compose.ci.yaml config --quiet
docker compose -p instara-ci -f compose.dokploy.yaml -f compose.ci.yaml up -d --build --wait --wait-timeout 180
node scripts/smoke-dokploy.mjs
docker compose -p instara-ci -f compose.dokploy.yaml -f compose.ci.yaml down
```

Skip network creation if it already exists. The CI override exposes only `127.0.0.1:8080`. The smoke test uses an unfunded disposable wallet, checks persistence/authentication/CSRF/replay rejection, and verifies live transaction endpoints fail closed. It does not send funds or contact the paid profile reader. GitHub Actions runs these checks on Linux.

## Main token and payout deduction

The locked launcher is `https://instara.xyz/admin`. Set `DEV_WALLET_ADDRESS` to the authorized public wallet address. Follow [main-token and buyback setup](MAIN-TOKEN.md) before enabling either main-token operations or community payouts. Store `INSTARA_MINT`, optional `INSTARA_BUYBACK_POOL`, `BUYBACK_SLIPPAGE_BPS`, and `SOLANA_LOOKUP_TABLES` in Dokploy Environment. The Compose file passes these only to the backend.
