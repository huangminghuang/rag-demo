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

3. Verify database is running:

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

3. Start the app locally:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Run unit tests

```bash
npm test
```

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
