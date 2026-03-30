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
- [ ] Generalize retrieval branch provenance to support:
- [ ] `vector_original`
- [ ] `lexical_original`
- [ ] `vector_rewritten`
- [ ] `lexical_rewritten`
- [ ] Replace current fusion with weighted reciprocal rank fusion across active branches.
- [ ] Keep original-query branches weighted above rewritten-query branches.
- [ ] Dedupe by stable chunk identity.
- [ ] Aggregate per-result matched branches.
- [ ] Add tests for weighted RRF behavior, provenance aggregation, deduping, and deterministic ordering.

## 4. Shared Retrieval Integration
- [ ] Integrate hybrid retrieval into `retrieveRelevantChunks(...)`.
- [ ] Ensure both `POST /api/retrieve` and `POST /api/chat` use the same hybrid-enabled retrieval path.
- [ ] Preserve vector-only behavior when hybrid retrieval is disabled.
- [ ] Ensure query rewrite and hybrid retrieval compose correctly.
- [ ] Keep chat response shape unchanged.
- [ ] Add tests proving hybrid retrieval affects both retrieval entry points through the shared retrieval boundary.

## 5. Explicit Retrieve Debug Mode
- [ ] Extend explicit debug mode on `POST /api/retrieve` with hybrid branch visibility.
- [ ] Return debug metadata including active branch counts.
- [ ] Return per-result branch provenance as a list of matched branches.
- [ ] Keep the normal retrieve response shape unchanged when debug mode is not requested.
- [ ] Do not expose hybrid debug payload from `POST /api/chat` in phase 1.
- [ ] Add tests covering debug and non-debug response shapes.

## 6. Documentation and Verification
- [ ] Document all `HYBRID_*` environment variables in `README.md`.
- [ ] Document how hybrid retrieval composes with query rewrite.
- [ ] Document the hybrid retrieve debug workflow for `POST /api/retrieve`.
- [ ] Add a hybrid retrieval test query set in `docs/features/hybrid-retrieval`.
- [ ] Add manual verification guidance for:
- [ ] exact identifier queries
- [ ] file names and config paths
- [ ] CLI command queries
- [ ] conversational rewritten queries
- [ ] hybrid disabled fallback behavior

## 7. Verification and Acceptance
- [ ] Confirm exact identifier-style queries improve or remain stable under hybrid retrieval.
- [ ] Confirm file names, config paths, and commands benefit from lexical matching.
- [ ] Confirm conversational questions still benefit from vector retrieval under hybrid mode.
- [ ] Confirm query rewrite and hybrid retrieval work together without degrading exact lookups.
- [ ] Confirm branch counts and matched-branch provenance are visible in retrieve debug mode.
- [ ] Confirm chat uses the same hybrid retrieval pipeline without exposing debug internals.
- [ ] Confirm the public retrieval API remains stable unless debug mode is explicitly requested.
