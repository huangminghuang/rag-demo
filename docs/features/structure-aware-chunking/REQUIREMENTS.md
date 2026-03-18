# Structure-Aware Chunking Requirements

## Context

This repository currently ingests pages by:

- fetching HTML in `src/lib/ingest/parser.ts`
- extracting a flattened text body plus heading list
- splitting text in `src/lib/ingest/chunker.ts` by heading positions and character windows

That approach is simple, but it loses important document structure:

- tables are flattened into plain text
- lists and code blocks lose boundaries
- sections are inferred by string search instead of DOM structure
- chunks can mix unrelated content when large sections are window-split

The requested direction is similar to the structure-aware approach described here:

- https://github.com/FareedKhan-dev/agentic-rag?tab=readme-ov-file#transforming-raw-html-to-structured-elements

That approach parses raw HTML into structured element types first, then forms chunks from those structure-aware units instead of treating the page as one long text blob.

## Problem Statement

The current chunking pipeline reduces retrieval quality for documentation pages with rich layout. Important content such as section hierarchy, table rows, code examples, and ordered steps can be broken apart or flattened in ways that make retrieved context less precise and less readable.

We need a chunking system that preserves document structure well enough to improve retrieval quality without making ingestion significantly harder to operate.

## Goals

- Preserve meaningful HTML structure during parsing and chunking.
- Improve chunk semantic coherence for retrieval.
- Preserve section hierarchy and anchors so retrieved chunks can point users to the right place in the source page.
- Keep ingestion compatible with the current Postgres + pgvector storage model.
- Keep the implementation maintainable and deterministic.

## Non-Goals

- Building a generic browser-grade HTML renderer.
- Using an LLM to rewrite or summarize chunks during ingestion.
- Changing the retrieval algorithm itself in this phase.
- Replacing PostgreSQL or the current embedding model.

## Functional Requirements

### 1. Structured Parsing Layer

The ingestion pipeline must introduce an intermediate representation between raw HTML and final chunks.

The parser must emit ordered structured elements for the main content area, at minimum supporting:

- document title
- heading elements with level and anchor
- paragraph/text blocks
- unordered and ordered list blocks
- list items
- code/preformatted blocks
- tables
- table rows and cells, or an equivalent table representation
- block quotes
- section/container boundaries where available

Each structured element should preserve enough metadata to support chunking and debugging, including:

- source URL
- local anchor if present
- section heading path, if known
- element type
- source order index

### 2. Main Content Extraction

The parser must continue removing boilerplate such as navigation, footer, scripts, and styles.

It must prefer the main article/document content and avoid mixing in unrelated page chrome. If multiple candidate containers exist, selection rules must be deterministic and documented.

### 3. Structure-Aware Chunking

Chunking must operate on structured elements, not on one flattened string.

The chunker must:

- keep heading boundaries meaningful
- avoid splitting inside a table unless the table is too large to fit limits
- avoid splitting inside a code block unless the block is too large to fit limits
- keep list items grouped when possible
- preserve heading context for every chunk
- support bounded chunk size for embedding

The chunker must merge adjacent compatible elements into a chunk until a configurable size budget is reached.

The chunker must start a new chunk when:

- a heading starts a new logical section
- a table or code block should remain isolated
- the current chunk would exceed size limits
- content type changes in a way that harms coherence

### 4. Large Element Handling

If a single element exceeds the size budget:

- large paragraphs may be split on sentence or newline boundaries
- large code blocks may be split on line boundaries
- large tables may be split by row groups

Such splits must preserve enough metadata for reconstruction of context, including:

- original element type
- part index within the split element
- repeated heading path

### 5. Metadata Requirements

Chunk metadata must be richer than the current `source_title` and `section_title` fields.

At minimum, each chunk should support:

- `source_title`
- `heading_path`
- `primary_heading`
- `element_types`
- `anchor`
- `content_kind`
- `chunk_version`

Optional but recommended metadata:

- `table_name` or nearest heading for table chunks
- `code_language` if it can be inferred
- `word_count` or token estimate
- `dom_path` or parser trace for debugging

### 6. Backward Compatibility

The ingestion flow in `src/lib/ingest/index.ts` must remain operational.

The new parser/chunker may change the shape of intermediate types, but the final persisted chunk records must remain compatible with the current `chunks` table unless a separate schema change is explicitly approved.

If schema changes become necessary, they must be introduced as a follow-up migration with a separate decision.

### 7. Configurability

The implementation should support configurable size limits and chunking behavior, ideally through named constants or environment-backed config.

At minimum, the following should be configurable:

- target chunk size
- hard maximum chunk size
- overlap behavior, if any
- whether tables are isolated as standalone chunks
- whether code blocks are isolated as standalone chunks

## Quality Requirements

### Retrieval Quality

The new chunking strategy should improve or at least not regress:

- citation relevance
- answer grounding
- section-level precision
- retrieval readability for table and code content

Validation should use representative docs pages and the existing question set in `docs/TEST_QUESTION_SET.md`, expanded with table-heavy and code-heavy cases.

### Determinism

Given the same HTML input, the parser and chunker must produce stable output order and stable chunk boundaries unless configuration changes.

### Observability

The pipeline should support debugging by making it easy to inspect:

- extracted structured elements
- generated chunks
- chunk metadata

This can be implemented with logs, fixtures, or test helpers.

## Implementation Constraints

- Use the existing TypeScript ingestion stack.
- Prefer extending the current Cheerio-based parser before introducing heavier HTML tooling.
- Avoid LLM-based parsing in the ingestion hot path.
- Keep runtime reasonable for local Docker-based development.
- Maintain compatibility with current embedding quota controls and batch embedding flow.

## Proposed Architecture

### Parser Phase

Add a structure extraction phase that converts the main document DOM into a normalized element stream.

Possible new module:

- `src/lib/ingest/structureParser.ts`

Suggested output types:

- `StructuredDocument`
- `StructuredElement`
- `HeadingElement`
- `ParagraphElement`
- `ListElement`
- `CodeBlockElement`
- `TableElement`

### Chunker Phase

Replace or heavily refactor the current chunker to consume structured elements instead of `(content, title, headings)`.

Possible new module:

- `src/lib/ingest/structureChunker.ts`

### Ingestion Integration

`src/lib/ingest/index.ts` should move from:

- `parseHTML(...) -> content/headings`
- `chunkDocument(content, title, headings)`

to something closer to:

- `parseHTML(...) -> structured document`
- `chunkStructuredDocument(structured document)`

## Acceptance Criteria

The feature is complete when all of the following are true:

1. A parsed documentation page produces a stable ordered list of typed structured elements.
2. Tables, code blocks, and lists are preserved as first-class units through chunk generation.
3. Conversation retrieval returns chunks whose content remains readable and structurally coherent for section, list, code, and table queries.
4. Chunks continue to store successfully in the existing DB pipeline and can be embedded without special-case handling downstream.
5. Existing ingest runs still complete successfully on representative sitemap samples.
6. Tests cover parser behavior and chunk boundary rules for at least:
   - heading transitions
   - large paragraphs
   - code blocks
   - tables
   - mixed-content sections

## Risks and Tradeoffs

- More structure usually means more parser complexity and more edge cases across documentation sites.
- Better chunk fidelity may reduce average chunk size and increase total chunk count, which can increase storage and embedding cost.
- Table preservation improves precision for reference content but may require careful handling to avoid oversized chunks.
- Main-content selection remains site-specific and may need tuning per documentation source.

## Open Questions

- Should chunk overlap remain enabled for prose sections, or should structure boundaries replace overlap entirely?
- Should tables be embedded as one textual serialization format or with a custom normalized representation?
- Should code blocks include surrounding explanatory paragraphs in the same chunk or remain isolated by default?
- Do we want to store richer chunk metadata in `metadata` only, or promote some fields to first-class DB columns later?
- Should heading path include the document title as the root node?

## Decisions

The following decisions are adopted for the initial implementation of structure-aware chunking.

### 1. Chunk Overlap

Decision:

- Use no overlap by default when chunk boundaries are real structural boundaries such as headings, tables, and code blocks.

Rationale:

- The reference implementation emphasizes structure-aware grouping over sliding-window overlap.
- Overlap across true structural boundaries tends to duplicate context without improving coherence.
- This keeps chunk boundaries easier to reason about and debug.

Implementation guidance:

- Structure boundaries replace overlap for normal chunk formation.
- If oversized prose splitting is later needed, that should be treated as a separate follow-up decision.

### 2. Table Representation for Embedding

Decision:

- Store raw table HTML in metadata for fidelity and debugging.

Rationale:

- The reference implementation preserves table HTML using `text_as_html`, which keeps tabular structure intact.
- This avoids losing row/column relationships during ingestion.
- It provides a reliable source representation for later normalization or summarization if needed.

Implementation guidance:

- Preserve the raw HTML form of table chunks in metadata.
- Keep table chunks as atomic units where possible.

### 3. Code Block Handling

Decision:

- Keep code blocks separate by default when they are large or self-contained.

Rationale:

- Code blocks often form a distinct semantic unit and become less usable if mixed with unrelated prose.
- Separate code chunks make retrieval behavior easier to interpret and tune.
- This is the safest default while the implementation is still being stabilized.

Implementation guidance:

- Treat code blocks as first-class structured elements.
- Start a new chunk for large or clearly standalone code blocks.

### 4. Richer Metadata Storage

Decision:

- Keep new structure-aware fields in `chunks.metadata` first.

Rationale:

- This minimizes schema churn while the metadata model is still evolving.
- It allows rapid iteration on fields like `heading_path`, `content_kind`, and parser diagnostics.
- We can promote fields to first-class columns later if query patterns justify it.

Implementation guidance:

- Do not require a schema migration for the first structure-aware chunking implementation.
- Add metadata keys in a versioned and documented way.

### 5. Heading Path Root

Decision:

- Include the document title as the root of `heading_path`.

Rationale:

- This makes the hierarchy self-contained and easier to interpret outside the context of a single page object.
- It improves debugging and gives retrieval consumers a stable top-level context.
- It aligns with the overall goal of preserving document structure rather than just local section labels.

Implementation guidance:

- Build `heading_path` as a hierarchy rooted at the document title.
- Continue storing a simpler `primary_heading` value separately for convenience.

## Suggested Next Steps

1. Add parser fixtures for a few representative docs pages with headings, tables, and code samples.
2. Define the structured element TypeScript types.
3. Implement main-content extraction plus DOM-to-element normalization.
4. Implement a structure-aware chunker with explicit rules for prose, code, lists, and tables.
5. Add regression tests comparing old and new chunk outputs on representative pages.
6. Run an ingestion/retrieval quality check on the existing test question set plus new structure-sensitive questions.
