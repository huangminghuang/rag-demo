# LLM Reranking on Fused Top-N Checklist Plan

## 1. Config and Rollout Controls
- [x] Add reranking config resolution for enablement, candidate count, timeout budget, and debug-related behavior.
- [x] Add a master switch to enable or disable reranking globally.
- [x] Keep reranking disabled by default for rollout safety.
- [x] Add tests covering config defaults and validation.

## 2. Deep Reranker Module
- [x] Add a dedicated reranker module that encapsulates prompt construction, provider invocation, output parsing, validation, and fail-open behavior.
- [x] Define a pluggable reranker interface so retrieval orchestration stays provider-agnostic.
- [x] Add a Gemini-backed phase-1 reranker implementation behind that interface.
- [x] Pass reranker inputs including:
- [x] original query
- [x] rewritten query when rewrite applies
- [x] candidate title, URL, anchor, truncated content, and matched-branch provenance
- [x] Require structured ordered candidate IDs as the executable reranker output.
- [x] Treat optional scores and short reasons as diagnostics only.
- [x] Add tests covering valid reorder behavior, skip behavior, and deterministic fallback behavior.

## 3. Validation and Failure Handling
- [ ] Strictly reject invalid reranker permutations with missing, duplicate, or unknown IDs.
- [ ] Fail open to the fused order when reranking times out, errors, or returns malformed structured output.
- [ ] Preserve fused order as the stable tiebreak and fallback baseline.
- [ ] Keep reranking single-shot in phase 1 with no retry policy.
- [ ] Add tests covering timeout, model failure, malformed output, and invalid permutation fallback cases.

## 4. Shared Retrieval Integration
- [ ] Integrate reranking into `retrieveRelevantChunks(...)` after fusion and before final result consumption.
- [ ] Rerank a fused top-N candidate set where N is greater than the final returned limit.
- [ ] Skip reranking when the fused candidate set is already less than or equal to the final limit.
- [ ] Ensure both `POST /api/retrieve` and `POST /api/chat` use the same reranked retrieval boundary.
- [ ] Keep normal retrieve and chat response shapes unchanged.
- [ ] Add tests proving reranking affects both retrieval entry points through the shared retrieval boundary.

## 5. Ranking Policy and Query Behavior
- [ ] Instruct the reranker to optimize for answer usefulness to the user’s question.
- [ ] Explicitly preserve exact technical matches when they are directly relevant.
- [ ] Allow URL and anchor text to contribute as docs-specific ranking evidence.
- [ ] Encourage diversity when near-duplicate candidates would otherwise occupy multiple top slots.
- [ ] Add tests covering:
- [ ] exact identifiers
- [ ] file names
- [ ] config paths
- [ ] CLI commands
- [ ] conversational questions
- [ ] near-duplicate candidate sets

## 6. Route-Specific Consumption Details
- [ ] Keep direct retrieval single-query while allowing chat reranking to consume the same retained conversation history already prepared for answer generation.
- [ ] Ensure chat source numbering reflects the final reranked order.
- [ ] Ensure citation mapping remains aligned with the final reranked source order.
- [ ] Add tests covering chat source ordering and citation stability after reranking.

## 7. Explicit Retrieve Debug Mode
- [ ] Extend explicit debug mode on `POST /api/retrieve` with reranking visibility.
- [ ] Return reranking metadata including applied/skipped/fallback status.
- [ ] Return candidate counts and before/after candidate order in debug mode.
- [ ] Return optional per-candidate scores and short reasons when available.
- [ ] Return fallback reason when reranking does not apply successfully.
- [ ] Keep the normal retrieve response shape unchanged when debug mode is not requested.
- [ ] Do not expose reranking debug payload from `POST /api/chat` in phase 1.
- [ ] Add tests covering debug and non-debug response shapes.

## 8. Documentation and Verification
- [ ] Document all reranking-related environment variables in `README.md`.
- [ ] Document how reranking composes with vector retrieval, query rewrite, and hybrid retrieval.
- [ ] Document the reranking debug workflow for `POST /api/retrieve`.
- [ ] Add a reranking test query set in `docs/features/reranking`.
- [ ] Add manual verification guidance for:
- [ ] exact lexical lookups remaining stable
- [ ] conversational reranking improvements
- [ ] duplicate-sensitive ranking behavior
- [ ] reranking skip and fallback behavior

## 9. Evaluation and Acceptance
- [ ] Add automated reranking coverage for top-1/top-3 quality improvements.
- [ ] Confirm exact identifier-style queries do not regress under reranking.
- [ ] Confirm file names, config paths, and commands remain strong after reranking.
- [ ] Confirm conversational questions improve or remain stable in top-ranked context.
- [ ] Confirm near-duplicate candidate sets prefer distinct useful evidence when appropriate.
- [ ] Confirm reranking debug metadata is visible only in retrieve debug mode.
- [ ] Confirm chat uses the same reranked retrieval pipeline without exposing debug internals.
- [ ] Confirm the public retrieval and chat APIs remain stable unless debug mode is explicitly requested on retrieve.
