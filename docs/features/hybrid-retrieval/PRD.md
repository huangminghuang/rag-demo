# Hybrid Lexical + Vector Retrieval PRD

## Problem Statement

The current retrieval pipeline uses query embeddings and vector similarity over stored chunks. Query rewrite improves recall for conversational questions, but retrieval still underperforms on exact technical strings where lexical matching matters more than semantic similarity.

This creates predictable retrieval gaps:

- exact identifiers such as `import.meta.env`, `defineConfig`, or `optimizeDeps` may not rank as strongly as they should in vector-only retrieval
- file names, config paths, and CLI commands such as `vite.config.ts`, `server.proxy`, or `vite build` depend heavily on exact term overlap
- conversational questions and exact lookups currently share the same vector backend even though they benefit from different matching signals
- query rewrite can improve keyword coverage, but it does not replace the need for literal term matching

The user wants a hybrid retrieval pipeline that combines lexical and vector signals inside the shared retrieval boundary, without replacing the current pgvector architecture or changing public response shapes by default.

## Solution

Add a PostgreSQL lexical retrieval branch alongside the existing vector retrieval branch inside `retrieveRelevantChunks(...)` so both `POST /api/retrieve` and `POST /api/chat` use the same hybrid retrieval behavior.

The system will:

- gate hybrid retrieval behind an environment-backed master switch
- keep query rewrite behavior unchanged and allow hybrid retrieval to consume the existing rewrite decision
- run vector retrieval and lexical retrieval for the original query
- run vector retrieval and lexical retrieval for the rewritten query when rewrite applies
- use PostgreSQL full-text search for natural-language lexical matching
- use PostgreSQL trigram similarity to improve identifier, filename, path, and command matching
- fuse all active retrieval branches with weighted reciprocal rank fusion
- dedupe results by stable chunk identity
- keep chat and normal retrieve response shapes unchanged
- expose hybrid branch visibility only through explicit debug mode on `POST /api/retrieve`

The initial rollout will:

- apply hybrid retrieval inside the shared retrieval boundary used by both chat and direct retrieval
- keep hybrid retrieval disabled by default for rollout safety
- keep debug response support limited to `POST /api/retrieve`
- avoid cross-encoder reranking in phase 1

## User Stories

1. As a developer using direct retrieval, I want exact technical queries to benefit from lexical matching, so that identifiers and config keys rank strongly.
2. As a developer using chat, I want conversational questions to benefit from semantic retrieval and exact lexical grounding at the same time, so that retrieved context is both broad and precise.
3. As a developer querying file names and commands, I want retrieval to preserve literal string matches, so that exact docs for those terms are not under-ranked.
4. As a maintainer of retrieval quality, I want hybrid retrieval to augment rather than replace vector search, so that conversational semantic matching remains intact.
5. As a maintainer of retrieval quality, I want query rewrite and hybrid retrieval to compose inside one retrieval boundary, so that retrieval behavior stays consistent across routes.
6. As a maintainer of retrieval quality, I want results from vector and lexical branches to be fused deterministically, so that tuning is inspectable and stable.
7. As a maintainer of observability, I want explicit debug output for hybrid branch counts and per-result branch provenance, so that retrieval tuning is concrete.
8. As a maintainer of system stability, I want hybrid retrieval to be enabled by a master switch, so that rollout can be controlled safely.
9. As a test author, I want lexical search, hybrid fusion, and shared-boundary behavior to be testable as deep modules, so that retrieval quality can be validated without route-only tests.
10. As a product owner, I want public API shapes to remain unchanged unless debug mode is explicitly requested, so that rollout does not break clients.

## Implementation Decisions

- Implement hybrid retrieval inside `retrieveRelevantChunks(...)` so both chat and direct retrieval share the same retrieval behavior.
- Keep query rewrite as an independent retrieval augmentation layer and feed its result into both vector and lexical retrieval branches.
- Add a hybrid retrieval config module with:
- `HYBRID_RETRIEVAL_ENABLED` default `false`
- `HYBRID_LEXICAL_TRIGRAM_THRESHOLD` default `0.18`
- `HYBRID_PRE_FUSION_LIMIT` default `12`
- Run these branches in phase 1:
- `vector_original`
- `lexical_original`
- `vector_rewritten` when rewrite applies
- `lexical_rewritten` when rewrite applies
- Use PostgreSQL full-text search on `chunks.content` with `to_tsvector('english', chunks.content)` and `websearch_to_tsquery('english', query)`.
- Use PostgreSQL trigram similarity on `chunks.content` to supplement FTS for exact technical strings.
- Treat lexical retrieval as one ranked branch per query family even if it internally combines FTS and trigram scoring.
- Match lexical candidates when either the FTS predicate matches or trigram similarity clears the configured threshold.
- Fuse active branches with weighted reciprocal rank fusion using an RRF constant of `60`.
- Weight original-query branches at `1.0` and rewritten-query branches at `0.75`.
- Use equal weight between lexical and vector branches within the same query family in phase 1.
- Over-fetch candidates per branch using `max(limit * 3, HYBRID_PRE_FUSION_LIMIT)`.
- Dedupe by stable chunk identity using the database chunk ID.
- Aggregate branch provenance per result as a list of internal branch-source values rather than a single `matchedBy` string.
- Keep the normal retrieve and chat response shapes unchanged.
- Extend explicit retrieve debug output with per-branch counts and per-result branch provenance.
- Keep debug output hybrid-specific and internal to `POST /api/retrieve`.
- Do not add a separate search service or cross-encoder reranker in phase 1.

## Testing Decisions

- A good test should verify hybrid retrieval behavior through stable retrieval boundaries rather than route-only behavior.
- Hybrid config should be tested for defaults and validation.
- Lexical retrieval should be tested for:
- natural-language FTS matches
- exact identifier matches through trigram support
- combined FTS and trigram hits
- no-match threshold behavior
- Hybrid fusion should be tested for:
- deduping by stable chunk identity
- weighted RRF aggregation
- branch provenance aggregation
- deterministic tie-break ordering
- original-query preference over rewritten-query-only evidence when overall evidence is otherwise similar
- Retrieval integration should be tested to confirm:
- vector-only behavior is preserved when hybrid retrieval is disabled
- hybrid retrieval affects both `POST /api/retrieve` and `POST /api/chat` through the shared retrieval boundary
- query rewrite and hybrid retrieval compose correctly
- exact identifier-style queries improve or remain stable under hybrid retrieval
- Debug mode should be tested to confirm:
- normal response shape stays unchanged
- debug output includes branch counts and per-result branch provenance
- model-facing tests should use mocks rather than live database fixtures where feasible
- a documented hybrid query matrix should be added for repeatable verification of identifier, command, filename, config-path, and conversational queries

## Out of Scope

- Adding cross-encoder reranking in phase 1.
- Replacing PostgreSQL or pgvector.
- Adding a separate retrieval service.
- Returning hybrid debug payload from `POST /api/chat`.
- Searching metadata-derived lexical corpora beyond `chunks.content` in phase 1.
- Adding multilingual stemming or locale-specific lexical retrieval policy.
- Exposing chunk database IDs in public retrieval responses.

## Further Notes

- Hybrid retrieval is an augmentation layer, not a replacement for vector search or query rewrite.
- PostgreSQL full-text search alone is not sufficient for exact technical identifiers, which is why trigram support is included in phase 1.
- The first rollout should optimize for controllable rollout, inspectability, and exact-match improvements over aggressive ranking complexity.
- If hybrid retrieval proves useful, later phases can explore reranking, richer lexical corpora, or route-level policy overrides.
