This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### Run PostgreSQL + Migration with Docker Compose (without running app container)

1. Start only the database service:

```bash
docker compose up -d db
```

2. Run migration as a one-off container:

```bash
docker compose run --rm migration
```

Docker Compose reads `.env` automatically. If you also want overrides from `.env.local`, pass both files explicitly so `.env.local` can override `.env` values:

```bash
docker compose --env-file .env --env-file .env.local run --rm migration
```

Schema changes now use committed SQL migrations in [`docker/migration/drizzle`](docker/migration/drizzle). After editing [`src/lib/db/schema.ts`](src/lib/db/schema.ts), generate a new migration locally with:

```bash
npm run db:generate
```

3. (Optional) Seed a default admin user for local testing:

```bash
# set DEFAULT_ADMIN_EMAIL in .env first
docker compose run --rm seed_admin
```

If `DEFAULT_ADMIN_EMAIL` is only set in `.env.local`, run:

```bash
docker compose --env-file .env --env-file .env.local run --rm seed_admin
```

4. Verify database is running:

```bash
docker compose ps
```

At this point, DB + schema are ready, and the `app` service has not been started in Docker.

### Run the app locally (outside Docker) against Docker DB

1. Install dependencies locally:

```bash
npm install
```

2. Ensure local app uses `localhost` for DB host (not `db`):

```bash
# .env.local (recommended for local overrides)
DATABASE_URL=postgresql://user:password@localhost:5432/epic_docs_rag
```

Keep your other env vars (for example `GEMINI_API_KEY`, model names, and quota settings) in `.env` or `.env.local`.
For Docker Compose commands, prefer `.env` for shared values and pass both `.env` and `.env.local` explicitly when you want local overrides.

3. Start the app locally:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Run unit tests

```bash
npm test
```

### Admin Ingestion Rollout Workflows

Admin-only ingestion supports explicit reindexing and internal metadata/debug inspection.

Start a normal ingestion run:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "x-csrf-token: <csrf-token>" \
  -b "csrf_token=<csrf-cookie>; auth_session=<session-cookie>"
```

Start an explicit reindex/backfill run for already-ingested content:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <csrf-token>" \
  -b "csrf_token=<csrf-cookie>; auth_session=<session-cookie>" \
  -d '{"limit":10,"productFilter":"unreal-engine","forceReindex":true}'
```

Inspect recent internal chunk enrichment/debug metadata:

```bash
curl "http://localhost:3000/api/ingest?limit=20" \
  -b "auth_session=<session-cookie>"
```

The admin debug response includes recent chunk-level enrichment status, embedding input version, and embedding input preview. This endpoint is intended for rollout diagnostics and does not change the public retrieval API.

## Metadata Enrichment Model Configuration

Set these environment variables to control chunk-metadata enrichment during ingestion:

- `ENRICH_MODEL_API_KEY` (optional; falls back to `GEMINI_API_KEY`)
- `ENRICH_MODEL_NAME` (default: `gemini-2.5-flash`)
- `ENRICH_MODEL_API_VERSION` (default: `v1beta`)
- `ENRICH_EXECUTION_MODE` (`sequential` or `bounded_parallel`, default: `sequential`)
- `ENRICH_MAX_CONCURRENCY` (default: `1`; must be at least `2` when `ENRICH_EXECUTION_MODE=bounded_parallel`)
- `ENRICH_TIMEOUT_MS` (default: `15000`)
- `ENRICH_MAX_RETRIES` (default: `2`; may be `0` to disable retries)
- `ENRICH_METADATA_CONTENT_KINDS` (default: `prose,table,code`)
- `ENRICH_METADATA_MIN_CHARS` (default: `300`)

How the current codebase uses these settings:

- `ENRICH_MODEL_API_KEY` lets enrichment use a dedicated Gemini API key; when unset, enrichment falls back to `GEMINI_API_KEY`.
- `ENRICH_MODEL_NAME` and `ENRICH_MODEL_API_VERSION` choose the Gemini model used for chunk enrichment requests during ingestion.
- `ENRICH_EXECUTION_MODE`, `ENRICH_MAX_CONCURRENCY`, `ENRICH_TIMEOUT_MS`, and `ENRICH_MAX_RETRIES` control the enrichment worker behavior in `src/lib/ingest/enrichment.ts`.
- `ENRICH_METADATA_CONTENT_KINDS` controls which chunk kinds are eligible for enrichment.
- `ENRICH_METADATA_MIN_CHARS` skips short non-table chunks; table chunks stay eligible even when they are below the normal minimum size threshold.

Current enrichment coverage:

- `prose` chunks require `summary`, `keywords`, and `hypothetical_questions`
- `table` chunks also require `table_summary`
- `code` chunks also require either `code_summary` or `api_symbols`

Operational notes:

- Changing enrichment config changes the derived document processing hash, so existing documents can be reprocessed even when the parsed HTML content has not changed.
- Use `forceReindex: true` with `POST /api/ingest` when you want an explicit backfill run instead of waiting for hash-driven reprocessing.
- Internal debug inspection for stored enrichment status and embedding input previews is available through `GET /api/ingest` for admin users.

### Optional cleanup

```bash
docker compose stop db
```

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Query Model and Quota Configuration

Set these environment variables to control query model selection and quota enforcement:

- `QUERY_MODEL_NAME` (default: `gemini-3.1-flash-lite-preview`)
- `QUERY_MODEL_FALLBACKS` (default: `gemini-2.5-flash`, comma-separated)
- `QUERY_MODEL_API_VERSION` (default: `v1beta`)
- `QUERY_QUOTA_RPM` (default: `15`)
- `QUERY_QUOTA_TPM` (default: `250000`)
- `QUERY_QUOTA_RPD` (default: `500`)
- `QUERY_QUOTA_OUTPUT_TOKEN_RESERVE` (default: `1024`)

Quota is enforced in `POST /api/chat`. When a limit is exceeded, the API returns `429` with a `reason` and `Retry-After` header.
If the configured query model is unavailable, the app automatically tries fallback models in order.

## Query Rewrite Configuration

Query rewrite is an optional retrieval-layer feature that runs inside `retrieveRelevantChunks(...)`. It affects both `POST /api/retrieve` and `POST /api/chat`, but expanded rewrite/fusion diagnostics are only exposed through `POST /api/retrieve` when you explicitly request debug mode.

Set these environment variables to control query rewrite:

- `QUERY_REWRITE_ENABLED` (default: `false`)
- `QUERY_REWRITE_API_KEY` (optional; falls back to `GEMINI_API_KEY`)
- `QUERY_REWRITE_MODEL_NAME` (default: `gemini-2.5-flash`)
- `QUERY_REWRITE_MODEL_API_VERSION` (default: `v1beta`)
- `QUERY_REWRITE_TIMEOUT_MS` (default: `3000`)
- `QUERY_REWRITE_MAX_RETRIES` (default: `1`; may be `0` to disable retries)
- `QUERY_REWRITE_DEBUG` (default: `false`; enables server-side rewrite debug logging)

How the current codebase uses these settings:

- `QUERY_REWRITE_ENABLED` is the rollout master switch. Query rewrite is disabled by default for rollout safety.
- `QUERY_REWRITE_API_KEY` lets rewrite traffic use a dedicated Gemini API key; when unset, rewrite falls back to `GEMINI_API_KEY`.
- `QUERY_REWRITE_MODEL_NAME` and `QUERY_REWRITE_MODEL_API_VERSION` choose the Gemini model used for rewrite requests.
- `QUERY_REWRITE_TIMEOUT_MS` and `QUERY_REWRITE_MAX_RETRIES` bound rewrite latency and retry behavior separately from answer generation.
- `QUERY_REWRITE_DEBUG` controls internal rewrite decision logging. It does not change API response shapes by itself.

Debug workflow for `POST /api/retrieve`:

```bash
curl -X POST http://localhost:3000/api/retrieve \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <csrf-token>" \
  -b "csrf_token=<csrf-cookie>; auth_session=<session-cookie>" \
  -d '{"query":"How do environment variables work in Vite, and what is the VITE_ prefix for?","limit":5,"debug":true}'
```

When `debug` is `true`, the response includes:

- `originalQuery`
- `rewrittenQuery`
- `rewriteApplied`
- `rewriteReason`
- `originalBranchCount`
- `rewrittenBranchCount`
- `fusedCount`
- per-result `matchedBy`

Manual verification guidance:

- Use rewrite-applied conversational queries and confirm `rewriteApplied: true` with reasonable `rewrittenQuery` output.
- Use heuristic skip queries such as exact identifiers or quoted terms and confirm `rewriteApplied: false` with the expected `rewriteReason`.
- Check for rewritten-only fused hits by inspecting per-result `matchedBy` values in debug mode.
- Simulate or force rewrite failure and confirm retrieval still returns original-query results with `rewriteReason: "model_failed"` in debug mode.

Local references:

- query rewrite PRD: `docs/features/query-rewrite/PRD.md`
- checklist plan: `docs/features/query-rewrite/CHECKLIST_PLAN.md`
- test queries: `docs/features/query-rewrite/TEST_QUERIES.md`

## Embedding Model and Quota Configuration

Set these environment variables to control embedding model selection and embedding quota enforcement:

- `EMBED_MODEL_NAME` (default: `gemini-embedding-001`)
- `EMBED_QUOTA_RPM` (default: `100`)
- `EMBED_QUOTA_TPM` (default: `30000`)
- `EMBED_QUOTA_RPD` (default: `1000`)

Embedding quota is enforced in embedding generation paths used by retrieval and ingestion. When exceeded, API routes return `429` and ingestion stops the current run.

## Retrieval Threshold Configuration

Set these environment variables to tune retrieval precision/recall:

- `RETRIEVE_THRESHOLD_DEFAULT` (default: `0.55`) for `POST /api/retrieve`
- `CHAT_RETRIEVE_THRESHOLD` (default: `0.6`) for chat context retrieval in `POST /api/chat`

Valid range is `0.0` to `1.0`. Invalid values fall back to defaults.

For troubleshooting and tuning workflow, see `docs/RETRIEVAL_THRESHOLD_TUNING.md`.

## Google OAuth Credentials (Env + Fallback)

Google OAuth credentials are loaded with this order:
1. `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` from env.
2. Fallback JSON file path from `GOOGLE_OAUTH_JSON_PATH` (default: `.secrets/google_oauth.json`).

Required/related variables:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_JSON_PATH` (optional fallback file path)
- `AUTH_SESSION_SECRET` (session/cookie signing secret for auth integration)
- `AUTH_SESSION_MAX_AGE_SECONDS` (optional, default 7 days)
- `APP_BASE_URL` (optional, default `http://localhost:3000`)
- `GOOGLE_REDIRECT_URI` (optional, default callback under `APP_BASE_URL`)

Current auth endpoints:
- `GET /api/auth/signin/google` (start Google OAuth)
- `GET /api/auth/callback/google` (OAuth callback)
- `POST /api/auth/signout` (clear session)
- `GET /api/auth/me` (protected user endpoint)

CSRF protection:
- Mutating authenticated routes require `x-csrf-token` header to match `csrf_token` cookie.
- The `csrf_token` cookie is set after sign-in/callback (and ensured on `GET /api/auth/me`).

## Default Admin Setup (Local Testing)

Use Docker Compose seed service to provision or promote one email as admin.

1. Set in `.env`:

```bash
DEFAULT_ADMIN_EMAIL=you@example.com
DEFAULT_ADMIN_NAME=Local Admin
```

2. Run DB + migration + seed:

```bash
docker compose up -d db
docker compose run --rm migration
docker compose run --rm seed_admin
```

If `DEFAULT_ADMIN_EMAIL` or other Docker-consumed variables are stored in `.env.local`, use:

```bash
docker compose --env-file .env --env-file .env.local up -d db
docker compose --env-file .env --env-file .env.local run --rm migration
docker compose --env-file .env --env-file .env.local run --rm seed_admin
```

3. Sign in with Google using the same email as `DEFAULT_ADMIN_EMAIL`.

Notes:
- Seeding is an upsert by email and enforces `role='admin'`.
- Docker Compose does not merge `.env` and `.env.local` automatically; pass both with `--env-file .env --env-file .env.local` when you want local overrides.
- The `seed_admin` container runs [`docker/seed-admin/seed-default-admin.sh`](docker/seed-admin/seed-default-admin.sh) with `psql`.
- The `migration` container runs [`docker/migration/run-migrations.sh`](docker/migration/run-migrations.sh) and applies committed SQL files from [`docker/migration/drizzle`](docker/migration/drizzle).
- `migration` and `seed_admin` use dedicated minimal Docker build contexts under `docker/`, which also serve as the source of truth for their scripts and migration assets.
- `docker compose up app` now runs `seed_admin` before app startup.
