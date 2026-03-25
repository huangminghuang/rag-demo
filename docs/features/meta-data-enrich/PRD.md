# Metadata Enrichment PRD

## Problem Statement

The current ingestion pipeline produces structure-aware chunks, but the embeddings are still generated from chunk content alone. That means retrieval quality depends mostly on the exact words present in each chunk, even when a chunk clearly implies broader intent, likely user questions, named entities, API symbols, or table-level meaning that are not expressed directly in the text.

This creates predictable retrieval gaps:

- chunks that are semantically relevant but do not share enough vocabulary with the user query can be missed
- table chunks preserve structure, but often do not express their key comparisons or conclusions in a retrievable way
- code chunks preserve syntax, but often do not describe their purpose, usage, or the likely developer questions they answer
- retrieval quality is constrained by literal chunk phrasing rather than the deeper meaning of the content

The user wants the system to follow the general method of generating deeper metadata for every chunk, similar to the referenced `agentic-rag` approach, while fitting the current ingestion architecture and operating safely at ingestion time.

## Solution

Add a metadata enrichment stage to ingestion that runs after chunking and before embedding. For eligible chunks, the system will call a configured LLM to generate concise semantic metadata such as a summary, keywords, hypothetical user questions, entities, topics, and type-specific summaries for tables or code.

The system will:

- store enrichment results alongside existing structure-aware metadata
- keep the stored chunk content human-readable and source-grounded
- build embedding input from structural context, enrichment metadata, and chunk content rather than from chunk content alone
- gate enrichment by policy so rollout can be controlled by chunk type, chunk size, and model configuration
- allow the enrichment execution mode to be configured per model profile, including sequential and bounded-parallel operation
- treat enrichment version and embedding-text format changes as reindex-relevant so vectors stay aligned with the active enrichment behavior

The initial rollout will enrich `prose`, `table`, and `code` chunks, skip chunks below a configurable minimum text length except for tables, and degrade gracefully when enrichment fails by falling back to structural metadata plus raw chunk content.

## User Stories

1. As a developer asking questions against ingested documentation, I want semantically relevant chunks to be retrieved even when my query does not use the exact words in the source chunk, so that I get better grounded answers.
2. As a developer asking about configuration steps, I want chunks to encode likely user questions, so that retrieval can match intent rather than only literal wording.
3. As a developer asking about rate limits or comparison tables, I want table chunks to carry table-level summaries, so that tabular information is discoverable through natural-language search.
4. As a developer asking about code examples, I want code chunks to carry purpose and symbol metadata, so that syntax-heavy chunks can still match conceptual questions.
5. As a developer asking broad product questions, I want chunks to include entities and topics, so that retrieval can bridge between exact terms and higher-level concepts.
6. As a maintainer of the ingestion pipeline, I want enrichment to be policy-gated, so that rollout can be controlled without reworking the core chunking system.
7. As a maintainer of ingestion, I want enrichment eligibility to depend on content kind and chunk size, so that we do not spend model capacity on low-value chunks.
8. As a maintainer of ingestion, I want tables to remain high-priority enrichment candidates regardless of size, so that structured reference data gets semantic lift.
9. As a maintainer of ingestion, I want trivial chunks to be skipped intentionally, so that ingestion cost stays proportional to retrieval benefit.
10. As a maintainer of ingestion, I want failed enrichment on one chunk to fall back cleanly, so that a single model error does not fail the whole document.
11. As a maintainer of ingestion, I want enrichment status recorded per chunk, so that I can distinguish success, failure, and policy-based skips.
12. As a maintainer of ingestion, I want a versioned enrichment contract, so that changes to prompts or schema can be tracked and reindexed safely.
13. As a maintainer of ingestion, I want enrichment output validated and normalized, so that malformed model responses do not silently pollute stored metadata or vectors.
14. As a maintainer of ingestion, I want sequential versus bounded-parallel execution to be model-configurable, so that concurrency can be tuned to the selected model’s behavior.
15. As a maintainer of ingestion, I want timeouts and retry policy attached to the enrichment model profile, so that operational behavior is explicit and configurable.
16. As a maintainer of ingestion, I want the embedding input to be assembled from a stable template, so that retrieval behavior is inspectable and versionable.
17. As a maintainer of retrieval quality, I want the system to keep persisted chunk content unchanged in spirit, so that retrieval responses remain human-readable and directly grounded in source material.
18. As a maintainer of debugging workflows, I want a preview of the embedding input available in metadata or logs, so that I can inspect what was actually sent for vectorization.
19. As a maintainer of incremental ingestion, I want enrichment configuration to influence skip/reprocess decisions, so that unchanged HTML is still reindexed when enrichment semantics change.
20. As a maintainer of deployment safety, I want the initial release to avoid forcing immediate backfill during rollout, so that operational adoption is controlled.
21. As an administrator planning a reindex, I want the system to support explicit backfill later, so that existing content can benefit from the new metadata once the rollout is validated.
22. As a maintainer of the product surface, I want enrichment data to remain internal during phase 1, so that the public retrieval API does not expand before quality is proven.
23. As a future maintainer, I want list and blockquote enrichment to remain a clear phase-2 option, so that the initial implementation does not prematurely over-generalize.
24. As a test author, I want enrichment behavior isolated behind deep modules, so that policy, prompting, validation, and embedding input generation can be tested independently.
25. As a product owner, I want the enrichment system to improve retrieval without requiring schema changes to the chunk storage table, so that rollout remains operationally simpler.

## Implementation Decisions

- Introduce a dedicated enrichment stage between structure-aware chunk creation and embedding generation.
- Preserve the current structure-aware chunk contract as the source-grounded representation of stored content.
- Extend chunk metadata with a nested enrichment object rather than mixing LLM-derived fields directly into the structural metadata namespace.
- Use a versioned enrichment schema, starting with `meta-v1`, separate from the structure-aware chunk version.
- Use a single shared enrichment schema with optional type-specific fields rather than separate storage contracts per chunk type.
- Require successful enrichment to produce a concise summary, keywords, and hypothetical user questions for eligible chunks.
- Allow optional enrichment fields for entities and topics across all eligible chunk types.
- Require a table-specific summary for successfully enriched table chunks.
- Require either a code-specific summary or extracted code symbols for successfully enriched code chunks.
- Keep prompts strict and minimal rather than analytical and open-ended.
- Pass document title, heading path, content kind, and chunk text into enrichment prompts so the model has enough context to disambiguate the chunk.
- Use separate prompt variants for prose, table, and code chunks rather than one generic prompt for all chunk types.
- Permit mild inference about likely user intent, but do not allow unsupported facts or speculative content in enrichment output.
- Use normalized text rather than raw JSON as the basis for embedding input assembly.
- Build embedding input from structural context, selected enrichment fields, and chunk content, with a stable template and a configurable content-length cap.
- Keep persisted chunk content as the retrieval/display body rather than replacing it with synthetic metadata text.
- Record both structural/body size diagnostics and embedding-input size diagnostics so quota usage remains explainable.
- Treat enrichment eligibility as policy-driven, with phase-1 defaults targeting `prose`, `table`, and `code`.
- Skip enrichment for short chunks by configurable minimum body length, except for tables which remain eligible by default.
- Record enrichment status as `success`, `failed`, or `skipped_by_policy`.
- Fall back to structural metadata plus raw chunk content when enrichment fails or is skipped, and continue processing the document.
- Validate and normalize all enrichment output before persistence or embedding.
- Deduplicate and trim list-like enrichment fields, enforce maximum list sizes, and drop empty values.
- Treat enrichment prompt/schema changes, eligibility policy changes, and embedding-template changes as reindex-relevant inputs.
- Extend incremental ingestion logic so documents can be reprocessed when enrichment configuration changes even if HTML content is unchanged.
- Support an explicit backfill/reindex workflow, but do not require automatic full backfill as part of the first release.
- Keep enriched metadata internal in phase 1 and do not expand public retrieval responses by default.
- Treat list and blockquote enrichment as explicit follow-on scope rather than initial rollout scope.
- Introduce a dedicated enrichment model profile abstraction that includes model name, API version, execution mode, concurrency, timeout, and retry policy.
- Make enrichment execution mode configurable per model profile, supporting both `sequential` and `bounded_parallel`.
- In sequential mode, force a single in-flight enrichment task.
- In bounded-parallel mode, use a small promise pool with explicit concurrency limits and per-chunk retry handling.
- Resolve a single active enrichment model profile in phase 1 rather than implementing full multi-profile fallback immediately.
- Favor named configuration presets with environment overrides so operational behavior remains predictable.
- Structure the implementation around deep modules with stable interfaces for eligibility policy, prompt construction, model invocation, output validation, embedding input assembly, and ingestion orchestration.

## Testing Decisions

- A good test verifies externally visible behavior and stable contracts, not incidental implementation details such as internal helper ordering or prompt-string formatting minutiae unless those strings are part of a versioned interface.
- The enrichment eligibility policy should be tested to confirm that chunk type, chunk size, and policy configuration drive the correct `success` versus `skipped_by_policy` paths.
- The enrichment prompt/input builder should be tested to confirm that document title, heading path, content kind, and chunk content are provided correctly for each eligible chunk type.
- The enrichment output validator and normalizer should be tested to confirm successful parsing, trimming, deduplication, required-field enforcement, and failure behavior for malformed outputs.
- The embedding input builder should be tested to confirm that structural context, enrichment fields, and content are assembled into the correct normalized text and that truncation/caps are applied consistently.
- The ingestion integration path should be tested for successful enrichment, skipped enrichment, failed enrichment fallback, and persistence-ready records.
- The ingestion integration path should also be tested to confirm that changed enrichment version or policy configuration causes reprocessing even when the source HTML hash is unchanged.
- Table and code fixtures should be used to verify that table-specific and code-specific enrichment rules produce the expected stored metadata shape and embedding input behavior.
- Existing structure-aware ingestion tests should serve as prior art for end-to-end parse -> chunk -> persist-ready behavior.
- Existing Gemini and quota-related tests should serve as prior art for configuration-driven behavior, debug behavior, and failure handling around model invocation paths.
- Model-facing tests should prefer mocks and deterministic structured outputs rather than live network calls.
- Integration tests should assert observable outcomes such as metadata status, persisted content, embedding input construction, and skip/retry behavior rather than internal task scheduling details.

## Out of Scope

- Exposing enriched metadata in the public retrieval API or end-user UI during phase 1.
- Automatic full-dataset backfill during the initial rollout.
- Enrichment of `list`, `blockquote`, or other currently excluded chunk kinds in phase 1.
- Replacing the existing retrieval algorithm with a new reranking or hybrid-search architecture.
- Introducing a schema migration solely for enrichment storage.
- Batch prompting multiple chunks in one enrichment request during phase 1.
- Multi-profile fallback chains for enrichment models during phase 1.
- Using enrichment to rewrite, summarize, or replace stored chunk content shown to users.
- LLM-based restructuring of HTML or chunk boundaries.

## Further Notes

- The initial success criteria should focus on improved retrieval recall and relevance for prose, tables, and code without degrading grounding or readability.
- Because enrichment affects vector semantics, prompt changes, schema changes, eligibility changes, and embedding-input-template changes should all be treated as operationally significant version changes.
- The system should remain usable when enrichment is disabled, skipped by policy, or temporarily failing, with deterministic fallback behavior.
- A later phase can expand scope to list-like chunks, expose enrichment data for debugging or admin workflows, and introduce richer evaluation against representative retrieval question sets.
