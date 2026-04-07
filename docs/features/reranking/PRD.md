# LLM Reranking on Fused Top-N PRD

## Problem Statement

The current retrieval pipeline already combines vector retrieval, query rewrite, and hybrid lexical retrieval, but its final ranking still depends on fusion heuristics rather than a query-aware judgment over the final candidate set.

This creates a predictable gap:

- fused retrieval can surface the right candidates, but not always in the best top-1 or top-3 order for the user’s actual question
- conversational questions can benefit from a second-pass ranking step that judges answer usefulness across the final candidates rather than relying only on retrieval scores
- exact technical lookups can regress if a later ranking step overvalues broad semantic prose and undervalues exact identifiers, file names, config paths, commands, or anchors
- chat and direct retrieval currently share one retrieval boundary, so any ranking improvement or regression affects both routes and must remain consistent across them
- retrieval quality is difficult to improve safely without a bounded, inspectable reranking layer and explicit evaluation coverage

The user wants an LLM reranker that refines the fused top-N candidate set inside the shared retrieval boundary, improves top-1 and top-3 relevance, preserves exact-match wins when they are directly relevant, and keeps public response shapes unchanged by default.

## Solution

Add an optional LLM reranking layer after retrieval fusion and before results are consumed by direct retrieval or chat.

The system will:

- gate reranking behind an environment-backed master switch
- keep the reranking boundary shared so both direct retrieval and chat use the same final ranked results
- rerank a fused top-N candidate set where `N` is greater than the final returned limit
- skip reranking when the fused candidate count is already less than or equal to the final limit
- pass the original query to the reranker and include rewritten-query context when query rewrite applies
- pass candidate content, title, URL, anchor, and retrieval provenance to the reranker
- truncate candidate content before reranking to keep latency and token usage bounded
- ask the reranker to rank candidates by answer usefulness while preserving exact technical matches when they are directly relevant
- allow the reranker to prefer diversity when near-duplicate candidates would otherwise occupy multiple top slots
- preserve the fused order as the stable fallback and tiebreak baseline
- fail open to the fused order when reranking times out, errors, or returns invalid structured output
- expose reranking diagnostics only through explicit debug mode on direct retrieval
- keep normal direct retrieval and chat response shapes unchanged

The initial rollout will:

- reorder only and not drop otherwise valid fused candidates for quality reasons
- use a pluggable reranker interface with the existing Gemini stack as the first implementation
- run as a single-shot reranking call with no retry policy in phase 1
- keep all reranking telemetry request-scoped rather than persisted
- require no schema or ingestion changes in phase 1

## User Stories

1. As a developer using direct retrieval, I want the best candidate to move into the top slot when the fused result set already contains the right chunk, so that I can inspect ranking quality more accurately.
2. As a developer using chat, I want the same reranked retrieval order that direct retrieval would show, so that chat and retrieval stay behaviorally aligned.
3. As a developer asking conversational questions, I want the final candidate ranking to reflect answer usefulness rather than only fusion heuristics, so that the most helpful context appears first.
4. As a developer asking about an exact identifier, I want reranking to preserve exact technical matches when they are directly relevant, so that broad prose does not outrank the precise answer.
5. As a developer asking about a file name, I want the reranker to recognize path and anchor evidence, so that the most specific documentation chunk ranks highly.
6. As a developer asking about a CLI command, I want exact command references to remain strong after reranking, so that command lookups do not regress.
7. As a developer asking a compound question, I want the top-ranked context to cover distinct useful evidence rather than repeated near-duplicates, so that the answer model sees broader support.
8. As a maintainer of retrieval quality, I want reranking to run inside the shared retrieval boundary, so that ranking behavior does not split between retrieve and chat.
9. As a maintainer of retrieval quality, I want reranking to operate on fused candidates rather than raw branch results, so that fusion remains the source of candidate selection and deduplication.
10. As a maintainer of retrieval quality, I want reranking to see both the original user question and rewritten-query context when rewrite applies, so that it can balance user intent with retrieval expansion.
11. As a maintainer of retrieval quality, I want reranking to be disabled by default, so that rollout remains controlled and reversible.
12. As a maintainer of system stability, I want reranking failures to fall back to the fused order unchanged, so that a ranking-quality feature does not become an availability dependency.
13. As a maintainer of system stability, I want invalid reranker output to be rejected strictly, so that malformed model responses cannot partially corrupt ordering.
14. As a maintainer of observability, I want retrieve debug mode to show before/after candidate order and reranking status, so that I can inspect why the final order changed.
15. As a maintainer of observability, I want fallback reasons to be visible in retrieve debug mode, so that reranking failures are concrete instead of silent.
16. As a maintainer of routing consistency, I want chat source numbering to follow the final reranked order, so that citations correspond to the actual context shown to the model.
17. As a maintainer of performance, I want reranking candidate count and timeout to be configurable, so that I can tune latency and cost without code changes.
18. As a maintainer of prompt reliability, I want the reranker contract to require structured ordered IDs, so that runtime behavior depends on a machine-readable result rather than prompt-parsed prose.
19. As a maintainer of architecture, I want reranking logic to live in a deep module with a simple interface, so that prompt shaping, model invocation, parsing, and validation remain encapsulated.
20. As a test author, I want reranker contract behavior tested independently of route plumbing, so that malformed output, timeout fallback, and deterministic ordering are easy to validate.
21. As a test author, I want integration tests around the shared retrieval boundary, so that reranking is proven to affect both direct retrieval and chat consistently.
22. As a test author, I want exact identifier, file name, config path, and command queries covered by acceptance tests, so that reranking does not erase hybrid retrieval gains.
23. As a product owner, I want no public API shape changes outside direct-retrieve debug mode, so that clients are not forced to adapt to an internal ranking improvement.
24. As a product owner, I want phase 1 success to be measured primarily at the retrieval boundary, so that ranking improvements can be validated with less noise than answer-only evaluation.
25. As a product owner, I want automated and manual evaluation guidance for reranking, so that the feature can be tuned based on evidence rather than anecdotes.

## Implementation Decisions

- Implement reranking inside the shared retrieval boundary after fusion and before final result consumption.
- Keep reranking route-shared for direct retrieval and chat, but allow chat to pass the same retained conversation history already prepared for answer generation while direct retrieval remains single-query.
- Introduce a dedicated reranker module that owns prompt construction, provider invocation, structured output parsing, validation, and fail-open fallback handling behind one stable interface.
- Use a pluggable reranker interface so provider-specific implementation details stay separate from retrieval orchestration.
- Use the existing Gemini stack as the first reranker implementation in phase 1.
- Add reranking config with an environment-backed master enable flag, candidate-count control, and timeout budget.
- Treat reranking as a refinement stage over fused top-N candidates rather than a replacement for fusion or branch retrieval.
- Build the reranker candidate set from the fused results, using a configured N greater than the final returned limit.
- Skip reranking when the fused candidate set is already smaller than or equal to the final limit.
- Pass the original query to the reranker for every request.
- Pass rewritten-query context to the reranker when query rewrite applies.
- Pass candidate title, URL, anchor, truncated content, and retrieval provenance to the reranker for each candidate.
- Allow the reranker to use URL and anchor text as ranking evidence because docs paths often carry meaningful technical signal.
- Instruct the reranker to optimize for answer usefulness to the user’s question while preserving exact technical matches when they are directly relevant.
- Instruct the reranker to consider diversity among near-duplicate candidates so multiple top slots are not wasted on redundant evidence when another candidate adds distinct answer value.
- Keep candidate truncation deterministic and bounded so token usage and latency remain predictable.
- Require the reranker to return a structured ranking over the provided candidate IDs.
- Treat optional scores and short reasons as debug-only diagnostics rather than executable control signals.
- Reject reranker output if it is not a valid ordering over the supplied candidate IDs.
- On timeout, provider failure, malformed output, or invalid candidate ordering, return the fused order unchanged.
- Preserve fused order as the stable fallback and tiebreak baseline.
- Do not let reranking drop or filter out valid candidates in phase 1 beyond selecting the top results after reordering.
- Keep reranking diagnostics internal to explicit direct-retrieve debug mode.
- Extend direct-retrieve debug mode with reranking status, candidate counts, before/after ordered IDs, optional scores/reasons, and fallback reason when applicable.
- Keep normal direct retrieval and chat response shapes unchanged.
- Ensure chat source numbering and citation mapping reflect the final reranked order.
- Keep reranking request-scoped and do not add persisted reranking telemetry in phase 1.
- Require no schema changes or ingestion changes in phase 1.

## Testing Decisions

- A good reranking test should validate externally visible ranking behavior, fallback behavior, and debug metadata rather than prompt wording or SDK call internals.
- Reranker config should be tested for deterministic defaults and validation behavior.
- The reranker module should be tested for:
- successful valid reordering over fused candidates
- skip behavior when candidate count is already less than or equal to the final limit
- strict rejection of invalid permutations
- fail-open behavior on timeout, provider failure, and malformed structured output
- stable fallback to fused order when reranking cannot be applied
- preservation of exact identifier, file name, config path, and command matches when directly relevant
- diversity-sensitive ordering when near-duplicate candidates compete for top slots
- Retrieval integration should be tested to confirm:
- reranking runs after fusion inside the shared retrieval boundary
- direct retrieval and chat both receive reranked results from the same boundary
- query rewrite and reranking compose correctly
- reranking does not regress exact-lookups that hybrid retrieval was designed to improve
- Debug mode should be tested to confirm:
- normal response shape stays unchanged outside explicit debug mode
- reranking status and fallback reason are visible in direct-retrieve debug mode
- before/after order and optional diagnostics appear only when debug mode is requested
- Chat integration should be tested to confirm source numbering and citation mapping use the final reranked order.
- Acceptance coverage should include exact identifiers, file names, config paths, commands, conversational questions, rewritten-query cases, and unsupported questions.
- Prior art should follow the current codebase pattern of deep retrieval-module tests, targeted route integration tests for API-shape stability, and acceptance-style retrieval checks for query-family regressions.

## Out of Scope

- Cross-encoder reranking or a separate dedicated reranking service in phase 1.
- Provider-agnostic multi-provider orchestration in phase 1 beyond the pluggable interface boundary.
- Persisting per-query reranking traces or long-term reranking telemetry.
- Schema changes or ingestion changes to support reranking.
- Public API shape changes outside explicit direct-retrieve debug mode.
- Route-specific ranking behavior that intentionally diverges between direct retrieval and chat, other than allowing chat to include the same conversation history already used by answer generation.
- Retry policies for malformed or failed reranker responses in phase 1.
- Confidence-based dropping, hard-fail retrieval gating, or answer refusal driven by reranker scores.
- A separate answer-sufficiency or grounding-verification gate as part of this feature.
- Additional metadata corpora beyond the currently available retrieval result fields in phase 1.

## Further Notes

- The primary acceptance target for phase 1 is improved top-1 and top-3 retrieval quality without meaningful regression on exact technical lookups.
- The main product risk is an LLM reranker demoting precise lexical matches in favor of broader semantic prose, so prompt policy and evaluation should explicitly guard against that failure mode.
- Reranking should remain an augmentation layer over the existing retrieval stack, not a replacement for vector retrieval, query rewrite, hybrid lexical retrieval, or fusion.
- If phase 1 proves useful, later work can explore richer candidate context, persisted observability, confidence-aware trimming, or downstream sufficiency and grounding gates.
