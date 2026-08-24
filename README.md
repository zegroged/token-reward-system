# Token Reward System

A view-based token reward platform. Content creators connect their Instagram and
TikTok accounts; a background bot measures the real view counts of their reels/videos
through the official platform APIs, scores each post for authenticity, and awards
tokens proportional to genuine reach. Approved balances are paid out as **USDT (TRC20)**
on the Tron network.

The system is split into a Python worker (data collection, scoring, payouts) and a
Next.js web app (user dashboard + admin panel), backed by PostgreSQL and Redis, and
fronted by Nginx. Everything runs under Docker Compose with **Docker secrets** for all
credentials.

> **Status:** This was a startup attempt that has since been shut down. It has **0 real
> users** and is no longer operated. The code and architecture are published here for
> **portfolio / reference purposes**. It has not been independently security-audited;
> if you run it, do so at your own risk.

---

## How the reward works

1. A user registers and connects Instagram and/or TikTok via OAuth. Access tokens are
   encrypted before they ever touch the database.
2. The bot collects view/like/comment counts in **multiple snapshots** (roughly T+0,
   T+2h, and a final read around T+24h) so it can look at the growth curve rather than a
   single number.
3. Each post is scored for authenticity by a chain of analyzers (rule-based, statistical,
   an XGBoost ML model, and an optional OpenAI-based check). This is an anti-fraud /
   anti-bot signal, not a quality judgement.
4. Tokens are calculated as:

   ```
   tokens = views × base_rate × authenticity_multiplier
   ```

   The authenticity multiplier scales the payout down (1.0 → 0.9 → 0.7 → 0.0) as the
   score drops, and posts below the threshold earn nothing. A per-day cap limits abuse.
5. When a user requests a withdrawal and an admin approves it, the bot sends the
   corresponding USDT to the user's wallet and records the transaction hash.

---

## Architecture

```
                        ┌───────────────┐
        Internet  ───▶  │     nginx     │  TLS termination, rate limiting,
                        │ (reverse proxy)│  security headers
                        └──────┬────────┘
                               │
                        ┌──────▼────────┐
                        │   web (Next)  │  Dashboard + Admin panel + API routes
                        └──┬────────┬───┘
                           │        │
              ┌────────────▼──┐  ┌──▼───────────┐
              │  PostgreSQL   │  │    Redis     │  sessions, rate limits,
              │   (postgres)  │  │   (redis)    │  bot heartbeat
              └──────▲────────┘  └──▲───────────┘
                     │              │
                        ┌───────────┴─────┐
                        │   bot (Python)  │  APScheduler jobs:
                        │                 │   • daily collection + payout (04:00)
                        │                 │   • snapshot collector (every 2h)
                        │                 │   • withdrawal processor (every 5m)
                        │                 │   • heartbeat (every 5m)
                        └──────┬──────────┘
                               │
                     Instagram / TikTok APIs · OpenAI · Tron (USDT TRC20)
```

- **db** and **redis** live on an `internal` Docker network with no exposed ports.
  Only **nginx** is reachable from outside.
- The database schema is created once from [`db/init.sql`](db/init.sql) via
  `docker-entrypoint-initdb.d` (fresh installs only). Later schema changes are applied
  manually from [`db/migrations/`](db/migrations/) — see that folder's README.

---

## Tech stack

**Bot (`bot/`, Python 3.12)**
- APScheduler with a **PostgreSQL job store** (SQLAlchemy) — missed jobs are recovered
  automatically after downtime instead of being silently skipped
- `asyncpg`, `httpx`, `redis` for async DB / HTTP / cache access
- `xgboost` + `scikit-learn` for the ML authenticity model (with a graceful fallback if
  the model isn't present)
- `openai` for the optional AI analyzer
- `tronpy` for USDT (TRC20) transfers
- `cryptography` for token encryption; `structlog` for structured logging

**Web (`web/`, Next.js 14 / React 18)**
- App Router, built with `output: 'standalone'` for a small runtime image
- Prisma (client only — see the schema note below) over PostgreSQL
- JWT-based auth, `ioredis` for sessions and rate limiting
- Resend (email) and Netgsm (SMS/OTP) for notifications
- TypeScript + Tailwind CSS, optional Sentry instrumentation

**Infrastructure**
- PostgreSQL 16, Redis 7, Nginx (Alpine images)
- Docker Compose with Docker secrets; hardened bot container
  (`read_only` root filesystem, `no-new-privileges`, non-root user, `tmpfs` for `/tmp`)

> **Note on Prisma:** the schema is managed by hand-written SQL (`db/init.sql` +
> `db/migrations/`). Prisma is used only as a typed client (`prisma generate`); this
> project does **not** use `prisma migrate`.

---

## Getting started

### Prerequisites
- Docker + Docker Compose
- Instagram/Meta, TikTok, Resend, Netgsm and (optionally) OpenAI API credentials
- A funded Tron wallet if you intend to make real USDT payouts

### 1. Create the secret files

All credentials are provided as Docker secrets — plain text files under `secrets/`,
one value per file. These files are git-ignored and never committed.

```bash
mkdir -p secrets

# Generated random secrets
openssl rand -hex 32 > secrets/db_password.txt
openssl rand -hex 32 > secrets/redis_password.txt
openssl rand -hex 32 > secrets/jwt_secret.txt
openssl rand -hex 32 > secrets/encryption_key.txt
openssl rand -hex 16 > secrets/internal_api_key.txt

# Third-party credentials — paste your real values into each file
: > secrets/meta_app_secret.txt
: > secrets/tiktok_client_key.txt
: > secrets/tiktok_client_secret.txt
: > secrets/openai_api_key.txt        # optional; AI analyzer falls back if empty
: > secrets/resend_api_key.txt
: > secrets/netgsm_password.txt
: > secrets/tron_private_key.txt       # wallet that funds USDT payouts — keep offline
: > secrets/tron_api_key.txt           # TronGrid API key
```

> ⚠️ `secrets/` is git-ignored on purpose. Never commit real secret files.

### 2. Create a root `.env`

A few non-secret runtime values are read from the environment:

```env
APP_DOMAIN=https://localhost
NETGSM_USER=your_netgsm_username
NETGSM_HEADER=1923
```

The per-service `.env.example` files ([`bot/.env.example`](bot/.env.example),
[`web/.env.example`](web/.env.example)) document the full set of configuration options.

### 3. TLS certificates for nginx

Nginx expects `nginx/ssl/fullchain.pem` and `nginx/ssl/privkey.pem`. Use Let's Encrypt
in production, or generate a self-signed pair for local testing.

### 4. Bring the stack up

```bash
# Development — bot runs in DRY_RUN, nginx disabled, ports exposed
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Production — nginx active, no debug, real payouts
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

On first boot, PostgreSQL initializes the schema from `db/init.sql`. To apply later
schema changes to an existing database, run the migration files in `db/migrations/`
manually (instructions are in that folder's README).

---

## Security notes

Money moves in this system, so a few things are worth calling out explicitly:

- **Docker secrets everywhere.** No credential is baked into an image, a compose file, or
  the repository. Secrets are read at runtime from `/run/secrets/…`; the bot even wipes
  them from process memory after use (`gc.collect()`).
- **Encrypted platform tokens.** Instagram/TikTok OAuth tokens are stored encrypted with
  **AES-256-GCM** using an HKDF-derived key. The Python and Node sides use identical
  parameters so either can decrypt.
- **Encryption key rotation.** Keys are versioned (`encryption_key_v1`, `_v2`, …). The
  rotator ([`bot/security/key_rotator.py`](bot/security/key_rotator.py)) re-encrypts every
  token field in a single atomic transaction, and each user row tracks which key version
  it was encrypted with, so a partial/mixed state can't corrupt data. Rotate the key
  after any suspected exposure.
- **`DRY_RUN` mode.** With `DRY_RUN=true` (the dev default) the bot performs **no real
  platform API calls and no real USDT transfers** — it uses the Tron **Nile testnet**
  instead of mainnet. Always verify behavior in `DRY_RUN` before switching to
  production, where `DRY_RUN=false` selects mainnet. Guard your `tron_private_key` and
  keep the funding wallet balance minimal.
- **Payout safety.** USDT transfers always return a transaction hash; a timeout is
  treated as *"unknown"* (state `unconfirmed`, pending manual verification), never as an
  automatic retry — this avoids accidental double-spends.
- Additional hardening: per-route rate limiting (Nginx + Redis), an audit log,
  anti-sybil / anomaly detection, optional TOTP 2FA for admin accounts, and a locked-down
  bot container.

---

## Repository layout

```
bot/                 Python worker (collectors, analyzers, processors, security)
web/                 Next.js app (dashboard, admin panel, API routes)
db/init.sql          Full database schema (fresh install)
db/migrations/       Incremental, idempotent SQL migrations
nginx/               Reverse-proxy config (TLS, rate limiting, headers)
docker-compose*.yml  Base + dev + prod compose files
```

---

## License

MIT — see [LICENSE](LICENSE).
