# Query Rewrite PRD

## Problem Statement

The current retrieval pipeline embeds the user’s raw query and performs a single-stage vector search over stored chunks. This works well for exact technical lookups, but it can miss relevant documentation when the user asks a vague, conversational, or terminology-mismatched question.

This creates predictable retrieval gaps:

- short natural-language questions may not use the same terms as the indexed documentation
- conversational phrasing can underperform compared to keyword-rich technical phrasing
- users may ask broad questions whose intent is clear but whose wording is not retrieval-friendly
- exact identifier-style queries and conversational questions are treated the same even though they need different retrieval behavior

The user wants to add query rewriting so retrieval can preserve exact intent while increasing recall, without replacing the existing vector-search architecture or making retrieval brittle.

## Solution

Add a query rewrite stage inside the shared retrieval path so both `POST /api/retrieve` and `POST /api/chat` can benefit from the same behavior.

The system will:

- gate query rewriting behind an environment-backed master switch
- apply a heuristic gate inside the rewrite module so not every query is rewritten
- generate one keyword-rich rewritten query when rewriting is appropriate
- run dual retrieval fusion using both the original query and the rewritten query
- dedupe and fuse branch results with internal provenance markers
- fall back cleanly to original-query retrieval when rewrite is skipped or fails
- expose optional rewrite/fusion debug output only through an explicit debug flag on `POST /api/retrieve`

The initial rollout will:

- apply query rewriting to both chat retrieval and direct retrieval through `retrieveRelevantChunks(...)`
- keep debug response support limited to `POST /api/retrieve`
- keep route behavior stable by default when debug mode is not requested

## User Stories

1. As a developer using chat, I want conversational questions to retrieve relevant documentation even when I do not use the exact wording from the docs, so that grounded answers are more likely to cite the right sources.
2. As a developer using direct retrieval, I want vague or natural-language questions to be rewritten into better search queries, so that retrieval recall improves.
3. As a developer using exact API or config names, I want retrieval to preserve exact-match behavior, so that query rewriting does not degrade precise technical lookups.
4. As a maintainer of retrieval quality, I want the system to fuse original-query and rewritten-query retrieval results, so that rewriting augments retrieval instead of replacing the original signal.
5. As a maintainer of retrieval quality, I want the system to skip rewriting when a query is identifier-like, quoted, too long, too short, or clearly context-dependent, so that rewrite drift is minimized.
6. As a maintainer of retrieval quality, I want rewrite failures to fall back to original-query retrieval, so that retrieval remains available when the rewrite model fails.
7. As a maintainer of retrieval quality, I want rewrite behavior to be enabled or disabled through a master switch, so that rollout is controllable.
8. As a maintainer of retrieval quality, I want original and rewritten branch results to be deduped by stable chunk identity, so that fusion is deterministic and inspectable.
9. As a maintainer of retrieval quality, I want fused results to preserve branch provenance, so that I can tell whether a hit came from the original query, rewritten query, or both.
10. As a maintainer of retrieval quality, I want original-query hits to win ties over rewritten-query-only hits, so that exact user phrasing remains the primary signal.
11. As a maintainer of retrieval quality, I want rewritten-only hits to remain eligible for the final top-N, so that rewrite can actually improve recall.
12. As a maintainer of observability, I want rewrite skip and failure reasons to be explicit, so that heuristic tuning is possible.
13. As a maintainer of observability, I want an explicit debug mode on `POST /api/retrieve`, so that I can inspect rewrite and fusion behavior without changing public defaults.
14. As a maintainer of observability, I want debug responses to include the original query, rewritten query, rewrite reason, branch counts, and per-result provenance, so that retrieval tuning is concrete.
15. As a maintainer of system stability, I want rewrite timeouts and retries to be configured separately from answer generation, so that retrieval latency remains bounded.
16. As a maintainer of system stability, I want query rewrite to support a separate API key with fallback to the shared Gemini key, so that auxiliary model traffic can be isolated operationally.
17. As a maintainer of architecture, I want query rewrite to live inside the retrieval boundary rather than in individual routes, so that chat and direct retrieval stay behaviorally consistent.
18. As a test author, I want query rewrite policy, prompt generation, normalization, and fusion logic to be testable as separate deep modules, so that retrieval behavior can be verified at the boundary instead of through route-only tests.
19. As a product owner, I want retrieval debug behavior to remain opt-in and internal, so that the public retrieval and chat APIs do not expand accidentally.

## Implementation Decisions

- Implement query rewrite inside `retrieveRelevantChunks(...)` so both chat and direct retrieval use the same retrieval pipeline.
- Add a query rewrite module that returns a structured decision rather than only a rewritten string.
- Gate query rewrite with both a master switch and an internal heuristic gate.
- Heuristic skip reasons should include at least: `disabled`, `query_too_short`, `query_too_long`, `identifier_like`, `quoted_query`, `context_dependent`, `equivalent_to_original`, and `model_failed`.
- Query rewrite should return one keyword-rich rewritten query, not multiple variants.
- Query rewrite should preserve intent exactly and must never answer the question.
- Query rewrite should not use chat conversation history in phase 1; it should operate only on the latest user query.
- Query rewrite failures should silently fall back to original retrieval behavior while surfacing `model_failed` in debug mode.
- Run retrieval on both the original query and the rewritten query when rewrite is applied.
- Retrieve more candidates from each branch than the final returned limit so fusion has room to help.
- Use the same retrieval threshold for both branches in phase 1.
- Dedupe branch results by stable chunk identity, preferring the database chunk ID internally.
- Fuse duplicate branch hits by keeping the maximum similarity score.
- Use provenance values `original`, `rewritten`, and `both`.
- Use provenance only internally and in explicit debug mode; do not expand default public response shapes.
- Sort fused results by similarity first, then by provenance tie-breaker preferring `both`, then `original`, then `rewritten`.
- Prefer original-query hits over rewritten-query-only hits when scores are tied.
- Keep rewritten-only hits eligible for the final top-N.
- Keep query rewrite config separate from answer-generation config.
- Support `QUERY_REWRITE_API_KEY` with fallback to `GEMINI_API_KEY`.
- Add separate config for rewrite model name, API version, timeout, retries, and debug logging.
- Keep query rewrite disabled by default for rollout safety.
- Expose explicit debug output only on `POST /api/retrieve`, not on `POST /api/chat`.
- Keep chat behavior stable by consuming the shared retrieval pipeline without returning rewrite internals.
- Structure the implementation around separate modules for rewrite config, rewrite prompt generation, rewrite orchestration, and result fusion.

## Testing Decisions

- A good test should verify retrieval behavior through stable boundaries rather than internal prompt assembly details unless those prompt strings are themselves part of the contract.
- The rewrite heuristic gate should be tested for identifier-like queries, conversational queries, quoted queries, long queries, short queries, and context-dependent follow-ups.
- The rewrite normalization layer should be tested to confirm trimming, whitespace collapse, empty-output rejection, and equivalence detection against the original query.
- The rewrite decision module should be tested to confirm skip reasons, successful rewrites, and `model_failed` fallback behavior.
- The fusion module should be tested to confirm deduping by stable chunk identity, maximum-score retention, provenance assignment, and tie-break ordering.
- The retrieval integration path should be tested to confirm dual retrieval fusion changes behavior only when rewrite is applied.
- The retrieval integration path should be tested to confirm rewrite failures fall back to original-query retrieval without breaking the request.
- The retrieval integration path should be tested to confirm debug mode adds rewrite/fusion metadata without changing normal response shape.
- Query rewrite configuration should be tested for defaults, validation rules, and API-key fallback behavior.
- Model-facing rewrite tests should use mocks rather than live network calls.

## Out of Scope

- Adding reranking or a cross-encoder stage.
- Using conversation history in the rewrite decision or rewrite prompt.
- Returning rewrite debug output from `POST /api/chat`.
- Multi-variant rewrite generation in phase 1.
- Route-specific rewrite enablement separate from the shared retrieval boundary.
- Replacing vector search with a different retrieval backend.
- Exposing chunk database IDs in public retrieval responses.

## Further Notes

- Query rewrite is an augmentation layer, not a replacement for exact-match retrieval.
- Debug visibility is essential because rewrite quality cannot be evaluated reliably from final answers alone.
- The first rollout should optimize for safe fallback and inspectability over aggressive rewrite coverage.
- If rewrite proves useful, later phases can explore reranking, history-aware rewrite, or route-level policy overrides.
