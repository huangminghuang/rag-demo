# Next TODO Items (Condensed)

1. Identity, auth, and conversation lifecycle
- Add user identification and access control.
- Introduce session/conversation model with ownership rules.
- Persist messages and conversation metadata in DB.

2. Context management and chat quality
- Add history windowing/summarization to avoid unbounded prompt growth.
- Strengthen citation/source guardrails.
- Add retrieval diagnostics (top-k scores/chunks) for failed responses.

3. Reliability and API hardening
- Add stricter input validation and request limits.
- Improve rate-limiting architecture (shared store for multi-instance safety).
- Add robust error handling contracts across routes.

4. Ingestion operations and data freshness
- Move ingestion to background jobs with retry/progress tracking.
- Define scheduled recrawl strategy and changed-page reporting.

5. Observability and evaluation
- Add structured logs, request IDs, latency/error metrics.
- Automate evaluation runs using fixed test set.
- Track config/version snapshots per run (models, thresholds, quotas).
