# Embedding Storage Design Choices and Tradeoffs

## Context
This project uses Gemini embeddings for RAG retrieval with PostgreSQL + pgvector and HNSW indexing.

During implementation, we hit a pgvector constraint:
- HNSW index on `vector` columns does not support dimensions above 2000.
- `gemini-embedding-001` outputs 3072 dimensions.

## Options Considered

## Option A: Keep `vector` and trim dimensions
Approach:
- Keep column type as `vector`.
- Truncate embeddings (for example 3072 -> 2000) before storage and query.

Pros:
- Minimal schema/query changes.
- Works with existing HNSW setup.
- Fastest immediate unblock.

Cons:
- Drops part of the embedding signal completely.
- Can reduce retrieval quality/recall.
- Adds hidden coupling: all pipelines must remember to trim identically.

## Option B: Switch to `halfvec` and keep full dimensions (Chosen)
Approach:
- Use `halfvec(3072)` for embedding column.
- Keep full model output dimensions.
- Use HNSW with `halfvec_cosine_ops`.

Pros:
- Preserves full embedding dimensionality.
- Works with HNSW indexing limits for high-dimension embeddings.
- Usually better quality than hard dimension truncation.

Cons:
- Lower numeric precision (16-bit floats vs 32-bit).
- Requires schema/index/operator changes.
- Existing data/indexes may need rebuild during migration.

## Option C: Move vectors to a dedicated vector database
Approach:
- Keep app and relational metadata in Postgres.
- Store/search vectors in systems like Qdrant, Milvus, or Weaviate.

Pros:
- Strong ANN capabilities and scaling.
- Avoid pgvector-specific index constraints.

Cons:
- More infrastructure complexity.
- Cross-store consistency and operational overhead.
- Not ideal for minimal local demo setup.

## Decision
For this repository, we selected **Option B (`halfvec`)** because it balances:
- local developer simplicity (still one database),
- ability to use HNSW at 3072 dimensions,
- better semantic retention than truncation.

## Implementation Notes in This Repo
- Embedding column: `halfvec(3072)`.
- Index opclass: `halfvec_cosine_ops` with HNSW.
- Query-side cast for similarity: `::halfvec`.
- Embedding generation now stores full `gemini-embedding-001` output (no trim).

## Migration and Data Considerations
- Schema/type change requires DB migration.
- Existing indexed vectors should be reingested/reindexed after type change.
- If migration on existing data fails, recreate dev DB and rerun ingest for a clean state.

## Quality Validation
Use `docs/TEST_QUESTION_SET.md` to compare:
- citation presence,
- grounding quality,
- fallback correctness,
- latency before/after the storage change.
