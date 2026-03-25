# Query Rewrite Checklist Plan

## 1. Config and Heuristic Gate
- [x] Add query rewrite config resolution for model name, API version, API key fallback, execution settings, and debug logging.
- [x] Add a master switch to enable or disable query rewrite globally.
- [x] Add heuristic gating inside the rewrite module.
- [x] Skip rewrite for quoted queries.
- [x] Skip rewrite for identifier-like queries.
- [x] Skip rewrite for context-dependent follow-up queries.
- [x] Skip rewrite for very short or very long queries based on the agreed heuristic.
- [x] Return explicit structured skip reasons from the rewrite decision layer.
- [x] Add tests covering config defaults, validation, API-key fallback, and heuristic skip decisions.

## 2. Rewrite Prompt and Decision Layer
- [x] Add a Vite-aware query rewrite prompt builder.
- [x] Ensure the prompt asks for one keyword-rich rewritten query rather than multiple variants.
- [x] Ensure the prompt preserves user intent and never answers the question.
- [x] Add rewrite output normalization for trimming, whitespace collapse, and empty-output rejection.
- [x] Add equivalence detection between rewritten and original queries.
- [x] Return `model_failed` when rewrite generation fails.
- [x] Add debug logging of original query, rewritten query, and rewrite reason only when rewrite debug logging is enabled.
- [x] Add tests for successful rewrite, normalization, equivalence detection, and model-failure fallback.

## 3. Fusion and Provenance
- [x] Add dual retrieval fusion using both original-query and rewritten-query retrieval branches.
- [x] Over-fetch from each branch before fusion so the final top-N has room for rewritten-only hits.
- [x] Dedupe by stable chunk identity.
- [x] Track internal per-result provenance as `original`, `rewritten`, or `both`.
- [x] Preserve the maximum similarity score when a chunk appears in both branches.
- [x] Apply deterministic tie-break ordering preferring `both`, then `original`, then `rewritten` when scores tie.
- [x] Add tests for deduping, provenance assignment, score retention, and tie-break behavior.

## 4. Shared Retrieval Integration
- [x] Integrate query rewrite into `retrieveRelevantChunks(...)`.
- [x] Ensure both `POST /api/retrieve` and `POST /api/chat` use the same rewrite-enabled retrieval path.
- [x] Keep original-only retrieval behavior when rewrite is skipped or fails.
- [x] Keep chat response shape unchanged.
- [x] Add tests proving rewrite affects both retrieval entry points through the shared retrieval boundary.

## 5. Explicit Retrieve Debug Mode
- [x] Add an explicit `debug` flag to `POST /api/retrieve`.
- [x] Restrict expanded rewrite/fusion debug output to explicit debug requests only.
- [x] Return debug metadata including:
- [x] `originalQuery`
- [x] `rewrittenQuery`
- [x] `rewriteApplied`
- [x] `rewriteReason`
- [x] `originalBranchCount`
- [x] `rewrittenBranchCount`
- [x] `fusedCount`
- [x] per-result `matchedBy`
- [x] Keep the normal retrieve response shape unchanged when debug mode is not requested.
- [x] Do not expose rewrite debug payload from `POST /api/chat` in phase 1.
- [x] Add tests covering debug and non-debug response shapes.

## 6. Rollout and Documentation
- [x] Document all `QUERY_REWRITE_*` environment variables in `README.md`.
- [x] Document the rewrite debug workflow for `POST /api/retrieve`.
- [x] Document the relationship between `QUERY_REWRITE_API_KEY` and `GEMINI_API_KEY`.
- [x] Document that query rewrite is disabled by default for rollout safety.
- [x] Link or reference the rewrite test query set in local docs.
- [x] Add manual verification guidance for:
- [x] rewrite-applied queries
- [x] heuristic skip queries
- [x] rewritten-only fused hits
- [x] fallback behavior on rewrite failure

## 7. Verification and Acceptance
- [ ] Confirm exact identifier-style queries are not degraded by rewrite.
- [ ] Confirm natural-language Vite questions can benefit from rewritten-query branch hits.
- [ ] Confirm rewritten-query failures do not break retrieval.
- [ ] Confirm provenance and branch counts are visible in retrieve debug mode.
- [ ] Confirm chat uses the same rewrite-enabled retrieval pipeline without exposing debug internals.
- [ ] Confirm the public retrieval API remains stable unless debug mode is explicitly requested.
