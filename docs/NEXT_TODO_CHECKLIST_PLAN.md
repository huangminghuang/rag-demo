# Next TODO Checklist Plan

## 1. Identity, Auth, and Conversation Lifecycle
- [x] Define user identity strategy (local auth stub, OAuth, or external provider).
- [x] Add authentication middleware for protected routes.
- [x] Define authorization rules for ingest/admin vs chat usage.
- [x] Add conversation/session schema (conversation, message, user linkage).
- [x] Persist chat history per conversation.
- [x] Add APIs to create/list/load conversation sessions.

## 2. Context Management and Chat Quality
- [ ] Add conversation windowing policy (max turns or token budget).
- [ ] Add summarization for long sessions.
- [ ] Add stricter citation mapping checks before returning sources.
- [ ] Capture retrieval diagnostics (top-k chunks, similarity scores).
- [ ] Add debug mode to inspect retrieval context per chat turn.

## 3. Reliability and API Hardening
- [ ] Add request validation schemas for all routes.
- [ ] Enforce message length and payload size limits.
- [ ] Standardize API error payload format.
- [ ] Move rate-limiting state to shared storage (e.g., Redis) for multi-instance safety.
- [ ] Add retry/backoff policy documentation for provider 429/5xx errors.

## 4. Ingestion Operations and Data Freshness
- [ ] Move ingestion to a background job runner/queue.
- [ ] Track ingestion job status and progress.
- [ ] Add retry and dead-letter behavior for failed ingestion steps.
- [ ] Define recrawl schedule (daily/weekly) and run cadence.
- [ ] Add changed-page reporting after each crawl run.

## 5. Observability and Evaluation
- [ ] Add request IDs and structured logs for all API routes.
- [ ] Track latency/error metrics for ingest, retrieve, and chat.
- [ ] Automate test-set evaluation from `docs/TEST_QUESTION_SET.md`.
- [ ] Define scorecard output format for each evaluation run.
- [ ] Save run configuration snapshot (models, thresholds, quotas) with results.
