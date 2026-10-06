# Deploy Instara with Dokploy

This follows Grailshot's deployment pattern: a standalone Node web server behind Nginx, PostgreSQL on a private network, and a persistent database volume. Only the gateway joins `dokploy-network`. The application includes its API, so it does not need Grailshot's separate game service.

## Dokploy settings

1. Create a project and a **Compose** service named `instara`.
2. Select the GitHub repository `haiderlikesrust/insta`, branch `main`. For Git URL source, use `https://github.com/haiderlikesrust/insta.git`.
3. Set Compose path to `compose.dokploy.yaml` and build context to the repository root. Do not use the CI override on the public server.
4. Copy `deploy/dokploy.env.example` into Dokploy's environment settings. Keep `APP_ORIGIN=https://instara.xyz`. Replace `POSTGRES_PASSWORD` with a unique long alphanumeric password; this is interpolated into a database URL.
5. Add domain **instara.xyz** to service **gateway**, container port **80**, path `/`. Enable HTTPS and Let's Encrypt. Point the domain's DNS at your Dokploy server.
6. Deploy. `/api/health` must return HTTP 200 with `database: "postgres"`. Migrations run automatically under a PostgreSQL advisory lock before database requests are served.

Keep both launch flags false until end-to-end testing is complete. Configure the dedicated BACKEND_WALLET_SECRET_KEY, mainnet RPC and profile-reader token. Create the Meteora configuration, main coin and lookup table through /admin; their addresses are saved automatically. No custom program or verifier keys are used. Store secrets only in Dokploy.

The session cookie uses `APP_ORIGIN` to select Secure mode. `TRUST_PROXY_HOPS=2` assumes Dokploy's reverse proxy → Nginx → Node. Keep Node private; adjust the hop count if your proxy topology changes.

## Persistence and updates

The named `instara-postgres` volume stores sessions, tokens, profile ownership and verification state. Keep the same Compose project when updating. Back up PostgreSQL before updates; do not remove its volume when redeploying. Changing the environment password does not automatically change the password of an initialized PostgreSQL volume.

The Node build uses PostgreSQL. The optional local Cloudflare preview uses a separate SQLite/D1 database; local records are not copied into production. Permanent Instagram account IDs remain unchanged across rebrands and handle changes.

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

The locked launcher is `https://instara.xyz/admin`. Set `DEV_WALLET_ADDRESS` to the authorized public wallet address. Follow [main-token and buyback setup](MAIN-TOKEN.md) before enabling either main-token operations or community payouts. The app saves generated addresses in PostgreSQL. Existing environment overrides are optional; remove old placeholder addresses.

## Settlement worker

The settlement-worker service shares the private app network and authenticates to the Node API using a short-lived HMAC derived from the backend key. It resumes authorized claims every 15 seconds; it cannot create claims or choose recipients. Preserve PostgreSQL records and the original backend key across deployments. Keep the backend wallet funded with SOL for network fees and rent. Failed payout attempts retain their funds and signed transaction history for retry.
