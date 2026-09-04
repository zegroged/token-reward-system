# Token Reward System

> Creators connect their Instagram/TikTok accounts; a Python worker reads real view counts from the official platform APIs, scores each post for authenticity, and pays the earned balance out as USDT on Tron.

[![syntax](https://github.com/zegroged/token-reward-system/actions/workflows/syntax.yml/badge.svg)](https://github.com/zegroged/token-reward-system/actions/workflows/syntax.yml)
![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Next.js 14](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)
![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis 7](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![License MIT](https://img.shields.io/badge/License-MIT-green)

**Turkish README:** [README.tr.md](README.tr.md)

**How this was built:** the code was written with AI assistance and reviewed by the author.

## Overview

When a brand pays a creator per post, nobody can prove what the post actually earned. Screenshots
are trivially edited, and SMM panels sell 10,000 views for the price of a coffee. The premise here
was to remove the screenshot from the loop entirely: the creator authorizes the platform over OAuth,
and the system reads the numbers from Instagram's and TikTok's own APIs instead of trusting anything
the creator sends.

Reading the numbers is only half the problem — purchased views are real numbers too. So every post is
sampled several times over its first day, and the shape of its growth curve, its engagement ratios and
its history feed an authenticity score. That score does not just gate the payout, it scales it: a
clean post pays in full, a borderline post pays partially, a post below the threshold pays nothing.
Tokens accrue to a balance, the creator requests a withdrawal, an admin approves it, and a background
worker sends the corresponding USDT (TRC20) and records the transaction hash.

The system is two deployables sharing one PostgreSQL database: a **Python worker** (collection,
scoring, payouts) and a **Next.js app** (creator dashboard, admin panel, 37 API routes), fronted by
Nginx, with Redis for sessions and rate limits. Everything runs under Docker Compose with 13 Docker
secrets. The role model — `employee`, `registrar`, `admin`, `super_admin` — reflects the intended
operator: a company running a roster of creators, with a registration desk that onboards them in
person. It never got that far; see [Status](#status).

## Tech stack

| Layer | Choice |
|---|---|
| Worker | Python 3.12, APScheduler (PostgreSQL job store), asyncpg, httpx, structlog |
| Scoring | rule + statistical analyzers, OpenAI (`gpt-4o-mini`) as an optional layer, XGBoost/scikit-learn trainer (see limitations) |
| Payments | tronpy — USDT TRC20, Nile testnet or mainnet |
| Web | Next.js 14 App Router (`output: 'standalone'`), React 18, TypeScript, Tailwind CSS |
| Data | PostgreSQL 16 (16 tables, hand-written SQL), Prisma 5 as a typed client only, Redis 7 |
| Auth | Hand-rolled JWT + Redis session registry, bcrypt (cost 12) |
| Crypto | AES-256-GCM with HKDF-SHA256 key derivation, mirrored in Python and Node |
| Infra | Docker Compose, Docker secrets, Nginx (TLS, CSP, `limit_req`), hardened worker container |

Roughly 4,000 lines of Python across five packages, 20 pages and 37 API routes on the web side, 12
Prisma models over a 16-table schema, and 2 SQL migrations.

## Features

**Creators (`employee`)**
- Registration with email code + SMS OTP (Resend / Netgsm), KVKK consent recorded at signup
- Instagram and TikTok connected over OAuth; access tokens encrypted before they reach the database; TikTok tokens auto-refreshed when they expire
- Dashboard: available / pending / lifetime balance, weekly earnings, total verified views, analyzed reel count, connection health and token expiry
- Transaction history and in-app notifications
- Withdrawal requests against a saved TRC20 wallet — minimum 100 tokens, one open request at a time, balance moved `available → pending` under a row lock

**Registration desk (`registrar`)**
- Creates creator accounts for walk-ins and lists the accounts it created; new accounts are forced to change their password on first login

**Admins (`admin` / `super_admin`)**
- User management: bulk import (max 100 per request), activate / deactivate / role change, with a **per-user random temporary password** returned once to the operator rather than a shared default
- Withdrawal queue: approve or reject; approval is what releases a payout to the worker
- Reel review, token pool monitoring with a low-balance warning, and editable payout parameters (`base_rate`, daily cap, minimum authenticity) stored as versioned formulas
- Labeling queue for flagged reels (training data collection), audit log viewer, TikTok connection overview

**Worker (`bot/`)** — four scheduled jobs
| Job | Schedule | What it does |
|---|---|---|
| `daily_run` | 04:00 | Collect, analyze, score, calculate tokens, credit balances, notify |
| `snapshot_collector` | every 2h | Second and third view snapshots for the growth curve |
| `withdrawal_processor` | every 5 min | Approved withdrawals → USDT transfer → tx hash |
| `heartbeat` | every 5 min | Writes a Redis key the container healthcheck reads |

## Architecture

```
                     ┌────────────────┐
     Internet  ─────▶│     nginx      │  TLS 1.2/1.3, HSTS, CSP,
                     │ reverse proxy  │  per-zone rate limits
                     └───────┬────────┘
                             │
                     ┌───────▼────────┐
                     │  web (Next.js) │  20 pages · 37 API routes
                     └──┬──────────┬──┘
                        │          │
            ┌───────────▼──┐   ┌───▼──────────┐
            │  PostgreSQL  │   │    Redis     │  sessions, rate limits,
            │  16 tables   │   │              │  bot heartbeat
            └───────▲──────┘   └───▲──────────┘
                    │              │
                 ┌──┴──────────────┴──┐
                 │    bot (Python)    │  APScheduler, 4 jobs
                 └─────────┬──────────┘
                           │
        Instagram · TikTok · OpenAI · Tron (USDT TRC20)
```

`db` and `redis` sit on an `internal` Docker network with no published ports; only `nginx` is
reachable from outside.

```
bot/          collectors · analyzers · processors · security · notifications
web/          Next.js app — src/app (pages + API routes), src/lib (business logic)
db/           init.sql (full schema) + numbered, idempotent migrations
nginx/        TLS, rate-limit zones, security headers
docker-compose{,.dev,.prod}.yml
```

## Design notes

**One wire format across two languages.** The worker decrypts platform tokens in Python; the web app
encrypts them in Node during the OAuth callback. Rather than route everything through one service,
both sides implement the same primitive with identical parameters — HKDF-SHA256, `info =
"token-encryption-v1"`, 32-byte key, 12-byte random IV, stored as `base64(ciphertext‖authTag)` plus a
hex IV ([`bot/security/token_encryption.py`](bot/security/token_encryption.py),
[`web/src/lib/crypto.ts`](web/src/lib/crypto.ts)). The parameters are the contract, and both files say
so in their header comments.

**A broadcast is one-way, so a timeout is not a failure.** The payout worker
([`bot/processors/withdrawal_processor.py`](bot/processors/withdrawal_processor.py)) claims rows with
`UPDATE … WHERE status='approved' … FOR UPDATE SKIP LOCKED RETURNING`, so two processes can never take
the same withdrawal. Each withdrawal gets a deterministic idempotency key derived from its id and
approval timestamp, and `tx_hash` is `UNIQUE` at the database level. The important rule is the third
one: once a transaction has been broadcast, the code **never retries**. A network timeout after
broadcast means "unknown", not "failed", so the row moves to an `unconfirmed` state that a later run
verifies against the chain. Automatic retry is reserved for failures that provably never reached the
network.

**Money doesn't leave a balance without a lock.** Requesting a withdrawal opens a transaction, takes
`SELECT … FOR UPDATE` on the balance row, re-checks both the available amount and the absence of an
open request under that same lock, then moves the amount from `available` to `pending`
([`web/src/app/api/withdrawals/route.ts`](web/src/app/api/withdrawals/route.ts)).

**Several samples beat one number.** A single view count says nothing about how it was obtained.
Snapshot 1 is taken during the daily run; the two-hourly collector fills in snapshots 2 and 3 by
elapsed time. [`bot/analyzers/view_tracker.py`](bot/analyzers/view_tracker.py) then reads the shape:
organic reach front-loads and decays, so a post past 2,000 views whose 8→24h growth exceeds its 2→8h
growth threefold is flagged as a likely purchased spike rather than a viral hit.

**Graded consequences, not a binary ban.** The analyzer scores combine by weight — rule 40%, AI 35%,
growth curve 25% — and when a component is unavailable (no OpenAI key, not enough snapshots) the sum
is renormalized over the weights that actually contributed instead of silently scoring zero. The
statistical layer applies a z-score adjustment in points, clamped to 0–100. The payout then steps
down rather than falling off a cliff: ≥90 pays 1.0×, ≥80 pays 0.9×, ≥70 pays 0.7×, below 70 pays
nothing ([`bot/processors/token_calculator.py`](bot/processors/token_calculator.py)). A false positive
costs a creator 10% of one post, not their account.

**Tuning parameters live in the database.** `base_rate`, daily cap and minimum authenticity are read
at pipeline startup from `system_settings` and the currently effective row of `formula_versions`, with
the hard-coded defaults as a fallback if that read fails. Payout rules change from the admin panel,
and every calculation stores the formula version it used.

**Missed jobs come back.** APScheduler runs on a SQLAlchemy/PostgreSQL job store with `coalesce=True`,
`max_instances=1` and a one-hour misfire grace period, so a worker that is down at 04:00 still runs
the daily job when it returns instead of skipping a day of payouts — and can't run two of them at
once. If the job store can't be reached, it degrades to in-memory and logs the downgrade.

**Secrets are files, and keys are versioned.** Thirteen Docker secrets are read from
`/run/secrets/{name}` at runtime with an env fallback for development
([`bot/config.py`](bot/config.py)); nothing is baked into an image or a compose file. Key rotation
([`bot/security/key_rotator.py`](bot/security/key_rotator.py)) is version-aware: `encryption_keys`
tracks each version's SHA-256 and each user row records which version encrypted it, so a mixed-version
table decrypts correctly. Before rotating, it verifies every on-disk key file against the stored hash
— a wrong or missing old key aborts the run instead of corrupting data — and the re-encryption happens
in a single transaction. Re-running with the same key is a no-op.

**`DRY_RUN` picks the network and holds back the money — but it is not the default.** With
`DRY_RUN=true` the worker points tronpy at the Tron **Nile testnet**, skips the USDT transfer and
skips crediting balances; `DRY_RUN=false` selects mainnet and does both for real. Two caveats, and
both are mine. The flag is narrower than the name suggests: nothing in `bot/collectors/` or
`bot/analyzers/` reads it, so Instagram, TikTok and OpenAI are called either way. And the default is
the unsafe one — [`bot/config.py`](bot/config.py) falls back to `false` and the base compose file sets
nothing, so dry-run is on only when `docker-compose.dev.yml` is layered in. Safety depends on
remembering the dev overlay rather than on the default, which is the wrong way round for a money path.

**Defense in depth on the edges.** Nginx applies TLS, HSTS, CSP and separate `limit_req` zones for
login (5 r/m), API (30 r/s) and general traffic; Next.js middleware adds security headers, blocks
known scanner user-agents and applies a second Redis-backed per-IP limit. Registration is guarded by
five anti-sybil layers ([`web/src/lib/anti-sybil.ts`](web/src/lib/anti-sybil.ts)): unique Instagram
user id, virtual/VoIP number rejection, SHA-256 device fingerprint, per-IP registration caps, and
optional admin approval. The worker container runs as a non-root user with a `read_only` root
filesystem, `no-new-privileges`, and `tmpfs` for `/tmp`.

## Getting started

**Prerequisites** — Docker and Docker Compose; Meta, TikTok, Resend and Netgsm credentials (OpenAI
optional); a funded Tron wallet only if you intend to make real payouts.

**1. Create the secret files.** Every credential is a Docker secret — one plain-text file per value
under `secrets/`, which is git-ignored.

```bash
mkdir -p secrets

openssl rand -hex 32 > secrets/db_password.txt
openssl rand -hex 32 > secrets/redis_password.txt
openssl rand -hex 32 > secrets/jwt_secret.txt
openssl rand -hex 32 > secrets/encryption_key.txt
openssl rand -hex 16 > secrets/internal_api_key.txt

# Third-party credentials — paste real values into each file
: > secrets/meta_app_secret.txt
: > secrets/tiktok_client_key.txt
: > secrets/tiktok_client_secret.txt
: > secrets/openai_api_key.txt      # optional — the AI layer is skipped if empty
: > secrets/resend_api_key.txt
: > secrets/netgsm_password.txt
: > secrets/tron_private_key.txt    # funds payouts — keep the balance minimal
: > secrets/tron_api_key.txt        # TronGrid
```

**2. Create a root `.env`** for the few non-secret values compose interpolates:

```env
APP_DOMAIN=https://localhost
NETGSM_USER=your_netgsm_username
NETGSM_HEADER=your_sms_sender_header
```

[`bot/.env.example`](bot/.env.example) and [`web/.env.example`](web/.env.example) document the full
set of options, including where to obtain each API credential.

**3. TLS certificates.** Nginx expects `nginx/ssl/fullchain.pem` and `nginx/ssl/privkey.pem` — Let's
Encrypt in production, a self-signed pair locally.

**4. Start the stack.**

```bash
# Development — DRY_RUN on, nginx disabled, ports exposed
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Production — nginx active, real payouts
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

Always pass one of the two overlays. `docker-compose.yml` on its own sets no `DRY_RUN`, and the
fallback in `bot/config.py` is `false` — so the bare base file targets Tron mainnet.

PostgreSQL initializes the schema from [`db/init.sql`](db/init.sql) on first boot only. Later changes
are applied by running the files in [`db/migrations/`](db/migrations/) by hand; see that folder's
README. Prisma is used purely as a typed client (`prisma generate`) — this project does not use
`prisma migrate`.

## Known limitations

Written down because an interviewer will find them anyway.

- **No automated tests.** Not a single test file. Correctness rests on `DRY_RUN`, structured logs and
  manual verification, which is exactly the wrong answer for code that moves money.
- **The build ignores its own type and lint errors.** `web/next.config.js` sets
  `typescript.ignoreBuildErrors` and `eslint.ignoreDuringBuilds` to `true`, so `next build` succeeds
  over TypeScript and ESLint failures. With no tests either, nothing automated stands between a
  broken change and a running container.
- **`DRY_RUN` defaults to off and does less than its name implies.** The safe mode has to be opted
  into via the dev overlay, and it does not stop the collectors from calling the live Instagram,
  TikTok and OpenAI APIs — see [Design notes](#design-notes).
- **The XGBoost layer is not live.** [`bot/analyzers/ml_analyzer.py`](bot/analyzers/ml_analyzer.py)
  implements training and inference, and the admin labeling queue collects the training data, but no
  trained model ships and the pipeline never instantiates the analyzer. Scoring today is rule +
  statistics + growth curve + optional OpenAI. The trainer wants ≥200 labeled samples; the labeling
  queue never got that far.
- **Instagram scope mismatch.** The OAuth URL requests Basic Display scopes (`user_profile`,
  `user_media`) while the collector reads `/insights`, which requires a Business/Creator account and
  permissions granted through app review. That gap was never closed, so the Instagram path was only
  exercised against test accounts.
- **Written but not wired.** `bot/security/anomaly_detector.py` (earning spikes, pool depletion,
  velocity) and `bot/notifications/notifier.py` (Telegram/Discord) are complete modules that nothing
  currently calls; admin alerting goes through the in-app `notifications` table instead. The key
  rotator is a manual CLI script, not a scheduled job. `web/src/app/api/_internal/rate-check` is a
  leftover from before middleware talked to Redis directly.
- **Two-factor auth is schema-only.** `totp_secret_enc` / `totp_enabled` exist in the database and the
  key rotator re-encrypts them, but there is no enrollment or verification code in the web app.
- **Sentry is configured but not installed.** `sentry.client.config.ts` / `sentry.server.config.ts`
  exist and strip PII in `beforeSend`, but `@sentry/nextjs` is not in `package.json` and nothing
  imports them. Error tracking is effectively logs only.
- **Unused dependencies.** `next-auth`, `csv-parse` and `nodemailer` are declared but never imported —
  auth is hand-rolled JWT, CSV is parsed in the browser, and mail goes through Resend.
- **The rate limiter is a fixed window,** not a sliding one (`INCR` + TTL), and it fails **open** when
  Redis is unreachable — availability was chosen over strictness. Nginx's `limit_req` is the backstop.
- **Prisma covers 12 of the 16 tables.** `campaigns`, `campaign_payments`, `encryption_keys` and
  `system_settings` are reachable only through raw SQL, so the schema has two sources of truth.
- **Dev-mode mock data.** `/api/dashboard` returns hard-coded sample figures if the database query
  throws while `NODE_ENV !== 'production'`. Convenient locally, easy to mistake for real data.
- **Single node, single process.** One worker, one nightly batch, one Compose file. Snapshot
  collection is capped at 100 reels per run with a 0.5s pause between calls, so a few thousand active
  creators would need queues and workers rather than a cron loop.
- **Turkish-language UI, comments and validation.** The phone rules only accept Turkish mobile
  numbers; nothing is internationalized.
- **Never security-audited.** Treat the payout path in particular as unreviewed.

## Status

Shut down. **Zero users** — this never launched publicly, so there are no usage numbers to report,
good or bad.

Two things killed it. The first was access: the whole model depends on reading view counts from the
Instagram and TikTok APIs, and neither app review was approved for the permissions the collectors
need. Without that the product cannot exist, and no amount of code fixes it. The second was the
market: it is a two-sided marketplace, and the cold start was never solved — brands want creators with
proven reach, creators want brands with budgets, and there was no credible plan to seed either side
first. Both problems were knowable earlier than they were admitted, which was the more useful lesson.

This repository was also the Python and web layer of a larger advertising platform; the Go API, Go bot
and Flutter client for that effort live in a separate repository and are not part of this codebase.

**It was left half-finished, and it is shelved.** The gaps in
[Known limitations](#known-limitations) are not oversights waiting on time — they are the work that
would have to be done before this could serve anyone: no tests at all on a money path, `DRY_RUN`
defaulting to the unsafe side, the XGBoost layer written but never trained or wired in, the anomaly
detector and notifier complete but called by nothing, two-factor auth existing only as columns, and
the Instagram scope mismatch that blocked the product in the first place. None of that is planned.
The repository is a snapshot of where it stopped, not a base someone should build on without redoing
those parts themselves.

It is published as a reference implementation and portfolio piece: the interesting parts are the
payout safety model, the cross-language encryption seam, the versioned key rotation and the graded
authenticity scoring. It is not maintained and has not been audited — running it against real money is
your own risk.

## License

MIT — see [LICENSE](LICENSE).
