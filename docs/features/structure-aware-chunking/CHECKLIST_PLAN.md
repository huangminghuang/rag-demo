# Structure-Aware Chunking Checklist Plan

## 1. Parser and Types
- [x] Add shared structure-aware ingestion types in `src/lib/ingest/structureTypes.ts`.
- [x] Define `StructuredDocument` with `url`, `title`, `product`, `lang`, `hash`, and ordered `elements`.
- [x] Define typed structured elements for headings, paragraphs, lists, code blocks, tables, and block quotes.
- [x] Define versioned chunk metadata shape for `structure-v1`.
- [x] Add parser config/constants in `src/lib/ingest/structureConfig.ts`.
- [x] Implement a structure-aware parser in `src/lib/ingest/structureParser.ts`.
- [x] Remove boilerplate nodes before extracting content.
- [x] Implement deterministic main-content selection with fallback order: `article`, `main`, `[role="main"]`, `.content`, `#main-content`, `body`.
- [x] Traverse the selected DOM root in source order and emit normalized structured elements.
- [x] Build heading paths rooted at the document title.
- [x] Preserve anchor context on elements when available.
- [x] Compute document hash from normalized extracted content rather than raw HTML.

## 2. Chunker and Chunk Formatting
- [x] Add `src/lib/ingest/structureChunker.ts`.
- [x] Implement chunk assembly over structured elements instead of flattened page text.
- [x] Enforce no overlap across structural boundaries.
- [x] Flush chunks on heading transitions when appropriate.
- [x] Preserve tables as standalone chunks by default.
- [x] Preserve large or self-contained code blocks as standalone chunks by default.
- [x] Keep lists grouped when possible within the current heading path.
- [x] Prevent tables and code blocks from being merged into mixed chunks in `structure-v1`.
- [x] Add paragraph splitting rules using paragraph/newline/sentence/hard-limit fallback.
- [x] Add code splitting rules using block/newline/hard-limit fallback.
- [x] Add table splitting rules by row groups when a table exceeds max size.
- [x] Preserve split metadata for oversized paragraph/code/table elements.
- [x] Format final chunk text with document title and heading path context.
- [x] Add normalized table text for embedding-friendly chunk content while preserving raw table HTML in metadata.
- [x] Assign `content_kind` consistently across prose, list, code, table, blockquote, and mixed chunks.

## 3. Ingestion Integration
- [ ] Keep `fetchPage()` as the HTML download entrypoint.
- [ ] Add a new structured parse function alongside or in place of the current flattened parse flow.
- [ ] Update `src/lib/ingest/index.ts` to use the structured parser and structure-aware chunker.
- [ ] Keep the existing embedding batch flow unchanged apart from the chunk source.
- [ ] Keep `chunks` insertion compatible with the existing DB schema.
- [ ] Continue using incremental crawl skip logic based on document hash.
- [ ] Preserve chunk anchor selection for downstream retrieval/citation behavior.

## 4. Metadata and Persistence
- [x] Store richer structure-aware fields in `chunks.metadata` without schema changes.
- [x] Include required metadata keys: `chunk_version`, `source_title`, `heading_path`, `primary_heading`, `element_types`, `content_kind`, `word_count`, `token_estimate`.
- [x] Include optional metadata keys when relevant: `table_html`, `code_language`, `split_part`, `dom_paths`.
- [x] Set `chunk_version` to `structure-v1` for all new chunks.
- [ ] Keep `chunks.content`, `chunks.anchor`, and `chunks.tokenCount` compatible with the current persistence flow.
- [ ] Ensure metadata format is documented and stable enough for debugging and later evolution.

## 5. Testing Subsection

### 5.1 Unit Tests (Automatable)
- [x] Add parser tests for main-content root selection.
- [x] Add parser tests for heading-path construction rooted at the document title.
- [ ] Add parser tests for paragraph extraction.
- [ ] Add parser tests for list extraction.
- [x] Add parser tests for code block extraction.
- [x] Add parser tests for table extraction and raw HTML preservation.
- [x] Add chunker tests for heading-boundary chunk flushing.
- [x] Add chunker tests verifying no overlap across structural boundaries.
- [x] Add chunker tests for code block isolation.
- [x] Add chunker tests for table isolation.
- [x] Add chunker tests for oversized paragraph splitting.
- [x] Add chunker tests for oversized code splitting.
- [x] Add chunker tests for oversized table splitting.
- [x] Add chunker tests for metadata population and `chunk_version`.

### 5.2 Integration / Regression Tests (Automatable)
- [ ] Add representative HTML fixtures under `src/lib/ingest/__fixtures__/`.
- [ ] Add an ingestion-level test covering structured parse -> chunk -> persistence-ready records.
- [ ] Add regression tests comparing current and structure-aware chunk outputs on sample docs.
- [ ] Verify end-to-end ingest compatibility with the existing batch embedding flow.
- [ ] Verify stored chunk metadata remains JSON-serializable and DB-safe.
- [ ] Add retrieval-oriented regression checks for table-heavy documents.
- [ ] Add retrieval-oriented regression checks for code-heavy documents.
- [ ] Add retrieval-oriented regression checks for mixed-content documents.

### 5.3 Manual Verification
- [ ] Run ingestion on a small sitemap sample and inspect emitted chunks manually.
- [ ] Verify tables remain readable and structurally coherent in stored chunk content and metadata.
- [ ] Verify code blocks remain readable and are not merged into unrelated prose chunks.
- [ ] Verify heading paths reflect the document title and section hierarchy correctly.
- [ ] Verify chunk anchors point to the expected document sections.
- [ ] Validate retrieval quality against `docs/TEST_QUESTION_SET.md`.
- [ ] Add and run table-specific questions against the ingested dataset.
- [ ] Add and run code/config-specific questions against the ingested dataset.

## 6. Verification and Acceptance
- [ ] Confirm the parser emits stable typed elements in source order for the same HTML input.
- [ ] Confirm structure-aware chunking preserves tables, code blocks, and lists as first-class units.
- [ ] Confirm no overlap is used across structural boundaries in `structure-v1`.
- [ ] Confirm chunks stay within configured size limits except where explicit split logic applies.
- [ ] Confirm `runIngestion()` works end-to-end with the new parser/chunker path.
- [ ] Confirm new chunks embed successfully without downstream special casing.
- [ ] Confirm retrieval readability and grounding improve or do not regress on representative docs pages.
- [ ] Confirm the implementation matches `REQUIREMENTS.md` and `SPEC.md` without introducing conflicting behavior.
