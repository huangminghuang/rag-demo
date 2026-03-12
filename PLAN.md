# Next.js + Vite Documentation RAG Plan (Repo-Aligned)

## Goal
Build a demo-grade Next.js application with a chat UI that answers questions using indexed Vite documentation content, backed by PostgreSQL + pgvector and Gemini models.

## Current Baseline (already in repo)

### 1. App and API surface
- Next.js App Router project is in place.
- Implemented API routes:
  - `POST /api/ingest`
  - `POST /api/retrieve`
  - `POST /api/chat`
- Chat UI exists in `src/components/ChatBox.tsx` and calls `/api/chat`.

### 2. Data layer
- Drizzle ORM schema includes:
  - `documents`
  - `chunks`
- `chunks.embedding` is `halfvec(3072)`.
- Vector index is configured as HNSW with cosine ops on `chunks.embedding`.
- Migration helper ensures `CREATE EXTENSION IF NOT EXISTS vector;` before `drizzle-kit push`.

### 3. Ingestion pipeline
- Sitemap crawling is implemented, including sitemap-index recursion.
- HTML fetching + parsing is implemented with boilerplate stripping and heading extraction.
- Incremental behavior exists via `content_hash` check (skip unchanged pages).
- Document upsert + chunk replacement runs inside a DB transaction per URL.
- Embedding batch size is configurable through `EMBED_BATCH_SIZE` (with fallback).

### 4. Embeddings and retrieval
- Embeddings use Gemini `gemini-embedding-001`.
- Retrieval path:
  - embeds user query
  - computes cosine similarity in SQL
  - filters by threshold
  - orders by nearest distance
- Retrieval currently returns chunk content + source URL/title/anchor.

### 5. Chat path
- Chat uses Gemini `gemini-3.1-flash`.
- `/api/chat` retrieves top chunks and injects them into a grounding prompt.
- API returns generated answer plus source list.
- UI displays source links per assistant message.

## Known Gaps / Inconsistencies to Address
- Source scope is mixed in comments/defaults (Vite vs Epic wording in a few places).
- `/api/chat` is non-streaming; UI waits for full response.
- Ingestion is fire-and-forget from Route Handler and may hit runtime limits for larger crawls.
- No explicit robots.txt allow/deny enforcement.
- No auth/rate-limiting/observability pipeline yet.
- No evaluation harness or benchmark set committed.

## Revised Implementation Plan (change plan, not code)

## Phase 1 - Consistency and demo reliability
- Normalize project language and defaults around Vite documentation scope.
- Document environment knobs used by ingestion/retrieval/chat.
- Add a concise runbook for:
  - DB startup and migration
  - starting ingestion
  - validating retrieval/chat manually

Checkpoint:
- A new contributor can run locally and produce first answers with citations.

## Phase 2 - Retrieval quality tuning
- Tune chunking and retrieval params for better answer grounding:
  - chunk max length/overlap
  - retrieval `limit`
  - retrieval `threshold`
- Create a fixed test question set (20-30 questions) for repeatable quality checks.
- Define baseline metrics:
  - citation presence rate
  - groundedness pass rate
  - fallback correctness

Checkpoint:
- Measured before/after tuning results captured in docs.

## Phase 3 - Demo UX hardening
- Improve chat UX for demo execution:
  - clearer loading and failure states
  - better source rendering/readability
- Add a deterministic demo script:
  - 5-8 “happy path” questions
  - 3-5 out-of-scope/fallback questions

Checkpoint:
- End-to-end demo can be run consistently in one session without manual fixes.

## Phase 4 - Post-demo backlog (explicitly not required now)
- Background job worker for ingestion/embedding.
- Optional streaming responses.
- Auth and rate limiting.
- Observability for crawl/retrieval/chat latency and failures.
- Optional hybrid retrieval (vector + lexical).

## Acceptance Criteria (Demo)
- Answers are based on retrieved context and include source links when context exists.
- Unknown/unsupported questions return a clear fallback response.
- Ingestion can process a bounded sitemap subset successfully.
- Retrieval and chat endpoints work end-to-end from the UI in local environment.
