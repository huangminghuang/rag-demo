# Hybrid Lexical + Vector Retrieval Checklist Plan

## 1. Config and Rollout Controls
- [x] Add hybrid retrieval config resolution for enablement, trigram threshold, pre-fusion limit, and debug-related behavior.
- [x] Add a master switch to enable or disable hybrid retrieval globally.
- [x] Keep hybrid retrieval disabled by default for rollout safety.
- [x] Add tests covering config defaults and validation.

## 2. PostgreSQL Lexical Search Foundation
- [x] Add database support for PostgreSQL trigram search.
- [x] Add a lexical search path using PostgreSQL full-text search on `chunks.content`.
- [x] Add trigram similarity support for identifier-heavy exact queries.
- [x] Combine FTS and trigram matching into one ranked lexical branch per query family.
- [x] Add indexing support for:
- [x] FTS on `chunks.content`
- [x] trigram similarity on `chunks.content`
- [x] Add tests covering lexical match behavior for natural-language and exact technical queries.

## 3. Hybrid Fusion and Provenance
- [x] Generalize retrieval branch provenance to support:
- [x] `vector_original`
- [x] `lexical_original`
- [x] `vector_rewritten`
- [x] `lexical_rewritten`
- [x] Replace current fusion with weighted reciprocal rank fusion across active branches.
- [x] Keep original-query branches weighted above rewritten-query branches.
- [x] Dedupe by stable chunk identity.
- [x] Aggregate per-result matched branches.
- [x] Add tests for weighted RRF behavior, provenance aggregation, deduping, and deterministic ordering.

## 4. Shared Retrieval Integration
- [x] Integrate hybrid retrieval into `retrieveRelevantChunks(...)`.
- [x] Ensure both `POST /api/retrieve` and `POST /api/chat` use the same hybrid-enabled retrieval path.
- [x] Preserve vector-only behavior when hybrid retrieval is disabled.
- [x] Ensure query rewrite and hybrid retrieval compose correctly.
- [x] Keep chat response shape unchanged.
- [x] Add tests proving hybrid retrieval affects both retrieval entry points through the shared retrieval boundary.

## 5. Explicit Retrieve Debug Mode
- [x] Extend explicit debug mode on `POST /api/retrieve` with hybrid branch visibility.
- [x] Return debug metadata including active branch counts.
- [x] Return per-result branch provenance as a list of matched branches.
- [x] Keep the normal retrieve response shape unchanged when debug mode is not requested.
- [x] Do not expose hybrid debug payload from `POST /api/chat` in phase 1.
- [x] Add tests covering debug and non-debug response shapes.

## 6. Documentation and Verification
- [x] Document all `HYBRID_*` environment variables in `README.md`.
- [x] Document how hybrid retrieval composes with query rewrite.
- [x] Document the hybrid retrieve debug workflow for `POST /api/retrieve`.
- [x] Add a hybrid retrieval test query set in `docs/features/hybrid-retrieval`.
- [x] Add manual verification guidance for:
- [x] exact identifier queries
- [x] file names and config paths
- [x] CLI command queries
- [x] conversational rewritten queries
- [x] hybrid disabled fallback behavior

## 7. Verification and Acceptance
- [x] Confirm exact identifier-style queries improve or remain stable under hybrid retrieval.
- [x] Confirm file names, config paths, and commands benefit from lexical matching.
- [x] Confirm conversational questions still benefit from vector retrieval under hybrid mode.
- [x] Confirm query rewrite and hybrid retrieval work together without degrading exact lookups.
- [x] Confirm branch counts and matched-branch provenance are visible in retrieve debug mode.
- [x] Confirm chat uses the same hybrid retrieval pipeline without exposing debug internals.
- [x] Confirm the public retrieval API remains stable unless debug mode is explicitly requested.
