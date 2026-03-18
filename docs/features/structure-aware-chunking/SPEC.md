# Structure-Aware Chunking Spec

## Purpose

This document defines the implementation design for structure-aware chunking in this repository. It translates the requirements in [REQUIREMENTS.md](REQUIREMENTS.md) into concrete code structure, data contracts, processing rules, and rollout steps.

## Scope

This spec covers:

- HTML-to-structured-element parsing
- structure-aware chunk generation
- ingestion pipeline integration
- metadata format for persisted chunks
- test and rollout expectations

This spec does not cover:

- retrieval algorithm changes
- LLM metadata enrichment
- schema migrations beyond existing `chunks.metadata`

## Current State

The current ingestion flow is:

1. `fetchPage(url)` downloads HTML.
2. `parseHTML(html, url)` returns flattened page text plus heading list.
3. `chunkDocument(content, title, headings)` splits the flattened text into chunks.
4. `runIngestion()` embeds and stores chunks.

Relevant files:

- `src/lib/ingest/parser.ts`
- `src/lib/ingest/chunker.ts`
- `src/lib/ingest/index.ts`

The main limitation is that the parser throws away DOM structure too early, which prevents the chunker from treating tables, code, lists, and section boundaries differently.

## Design Summary

The new pipeline will:

1. Extract the main content container from HTML.
2. Traverse the DOM in source order and emit typed structured elements.
3. Build heading hierarchy as elements are encountered.
4. Chunk the element stream using structure-aware rules.
5. Persist final chunks using the existing `chunks` table and `metadata` JSON field.

## Target Architecture

### Modules

Add the following modules:

- `src/lib/ingest/structureTypes.ts`
- `src/lib/ingest/structureParser.ts`
- `src/lib/ingest/structureChunker.ts`
- `src/lib/ingest/structureConfig.ts`

Existing modules to update:

- `src/lib/ingest/parser.ts`
- `src/lib/ingest/index.ts`

### Responsibilities

`structureTypes.ts`

- shared type definitions for parsed documents, structured elements, and final chunk metadata

`structureParser.ts`

- choose main content root
- remove boilerplate nodes
- walk DOM and emit normalized structured elements
- build heading path and anchor context
- return `StructuredDocument`

`structureChunker.ts`

- merge element stream into chunks
- isolate tables and code blocks by default
- split oversized prose/code/table elements according to type-specific rules
- emit final chunks compatible with current persistence flow

`structureConfig.ts`

- centralize chunk sizing and behavior flags

## Data Model

### StructuredDocument

```ts
export interface StructuredDocument {
  url: string;
  title: string;
  product: string;
  lang: string;
  hash: string;
  elements: StructuredElement[];
}
```

### StructuredElement

```ts
export type StructuredElement =
  | HeadingElement
  | ParagraphElement
  | ListElement
  | ListItemElement
  | CodeBlockElement
  | TableElement
  | BlockQuoteElement;
```

Shared base fields:

```ts
interface BaseElement {
  type: string;
  order: number;
  text: string;
  anchor?: string;
  headingPath: string[];
  primaryHeading: string;
  domPath?: string;
}
```

Specific element shapes:

```ts
interface HeadingElement extends BaseElement {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

interface ParagraphElement extends BaseElement {
  type: "paragraph";
}

interface ListElement extends BaseElement {
  type: "list";
  listKind: "ordered" | "unordered";
  items: string[];
}

interface ListItemElement extends BaseElement {
  type: "list_item";
  listKind: "ordered" | "unordered";
  itemIndex: number;
}

interface CodeBlockElement extends BaseElement {
  type: "code";
  codeLanguage?: string;
}

interface TableElement extends BaseElement {
  type: "table";
  html: string;
  rows: string[][];
}

interface BlockQuoteElement extends BaseElement {
  type: "blockquote";
}
```

### Persisted Chunk Shape

The existing `Chunk` interface can remain, but metadata will become structured and versioned.

```ts
export interface StructureAwareChunk {
  content: string;
  chunkIndex: number;
  anchor?: string;
  metadata: {
    chunk_version: "structure-v1";
    source_title: string;
    heading_path: string[];
    primary_heading: string;
    element_types: string[];
    content_kind: "prose" | "table" | "code" | "mixed" | "list" | "blockquote";
    word_count: number;
    token_estimate: number;
    table_html?: string;
    code_language?: string;
    split_part?: {
      index: number;
      total?: number;
      original_type: "paragraph" | "code" | "table";
    };
    dom_paths?: string[];
  };
}
```

## Parser Specification

### Main Content Selection

The parser must remove obvious boilerplate first:

- `header`
- `footer`
- `nav`
- `script`
- `style`
- known site chrome classes already removed today

Candidate main-content selectors, in order:

1. `article`
2. `main`
3. `[role="main"]`
4. `.content`
5. `#main-content`
6. `body`

The first non-empty candidate becomes the root container.

### DOM Traversal Rules

The parser must walk the selected root in document order and emit normalized elements.

Emit rules:

- `h1`..`h6` -> `HeadingElement`
- `p` -> `ParagraphElement`
- `ul`/`ol` -> `ListElement`
- `li` -> only emit separately if list flattening is needed later; otherwise preserve inside `ListElement`
- `pre` and `code` blocks -> `CodeBlockElement`
- `table` -> `TableElement`
- `blockquote` -> `BlockQuoteElement`

Do not emit empty or whitespace-only elements.

### Heading Path Construction

Heading path must include the document title as the root.

Example:

```ts
["Vite Guide", "Configuring Vite", "Build Options"]
```

Rules:

- initialize stack with `[documentTitle]`
- when a heading at level `n` is encountered, truncate any deeper heading levels and append the new heading
- non-heading elements inherit the current heading path

### Anchor Selection

Element anchor resolution order:

1. node `id`
2. nearest heading ancestor/current heading anchor
3. undefined

Final chunk anchor should prefer:

1. first heading anchor in the chunk
2. otherwise first non-empty element anchor

### Hashing

`StructuredDocument.hash` should be based on normalized extracted content, not raw HTML, so boilerplate-only HTML changes do not force reingestion.

For `structure-v1`, hash input should concatenate emitted element text in order, plus table HTML for table elements.

## Chunker Specification

### Config

Initial config defaults:

```ts
export const STRUCTURE_CHUNK_CONFIG = {
  targetChars: 2200,
  maxChars: 3200,
  minMergeChars: 200,
  isolateTables: true,
  isolateCodeBlocks: true,
  overlapChars: 0,
} as const;
```

### Chunk Assembly Rules

Start with an empty active chunk buffer.

For each element in order:

1. If element is a heading:
   - flush current chunk if non-empty
   - do not emit the heading alone unless it has immediate content merged under it
   - store heading context for following elements

2. If element is a table and `isolateTables` is true:
   - flush current chunk
   - emit table as its own chunk unless oversized

3. If element is a code block and `isolateCodeBlocks` is true:
   - flush current chunk
   - emit code as its own chunk unless oversized

4. If element is prose/list/blockquote:
   - merge into current chunk if:
     - same heading path
     - merged size stays within `targetChars`
     - content kind remains compatible
   - otherwise flush and start a new chunk

5. If adding an element would exceed `maxChars`:
   - flush current chunk
   - split the new element if needed

### Content Kind Rules

Chunk `content_kind` assignment:

- only paragraphs -> `prose`
- only list/list items -> `list`
- only code -> `code`
- only table -> `table`
- only blockquote -> `blockquote`
- mixed prose/list/blockquote -> `mixed`

Tables and code blocks should not be merged into a `mixed` chunk in `structure-v1`.

### Formatting of Chunk Content

Final chunk text should remain embedding-friendly and readable.

Formatting rules:

- include document title and heading context as plain text headers
- do not include raw JSON in chunk text
- preserve table HTML only in metadata, not as the main chunk content unless needed for table chunks

Recommended format:

```text
Document: {title}
Path: {headingPath.join(" > ")}

{chunkBody}
```

For table chunks:

```text
Document: {title}
Path: {headingPath.join(" > ")}
Type: Table

{normalizedTableText}
```

For code chunks:

```text
Document: {title}
Path: {headingPath.join(" > ")}
Type: Code

{codeText}
```

## Oversized Element Handling

### Paragraph Splitting

Split order:

1. double newline
2. single newline
3. sentence boundary
4. hard character fallback

No overlap in `structure-v1`.

Each split part must carry:

- same heading path
- same anchor
- `split_part.original_type = "paragraph"`

### Code Splitting

Split order:

1. fenced/logical block boundaries if present
2. newline boundaries
3. hard character fallback

Each split part must:

- preserve original line order
- keep code language if known
- set `split_part.original_type = "code"`

### Table Splitting

Default behavior is not to split unless the table exceeds `maxChars`.

If split is required:

- keep header rows repeated in each split part if detectable
- split by row groups
- preserve raw full table HTML in metadata if practical
- optionally store split HTML fragment per chunk if full HTML is too large

Each split part must:

- set `split_part.original_type = "table"`
- retain nearest heading context

## Metadata Rules

### Required Metadata

Every persisted chunk must include:

- `chunk_version`
- `source_title`
- `heading_path`
- `primary_heading`
- `element_types`
- `content_kind`
- `word_count`
- `token_estimate`

### Optional Metadata

Included only when relevant:

- `anchor`
- `table_html`
- `code_language`
- `split_part`
- `dom_paths`

### Versioning

Set:

```ts
chunk_version: "structure-v1"
```

This enables later reingest migrations or mixed-version debugging.

## Ingestion Integration

### `parseHTML` Contract

Replace the current flattened parser return with a structured-document contract, or add a new function:

```ts
export function parseHTMLToStructuredDocument(html: string, url: string): StructuredDocument
```

Recommended compatibility path:

- keep `fetchPage()` where it is
- add `parseHTMLToStructuredDocument()`
- deprecate old `parseHTML()` after new ingest path is stable

### `runIngestion` Changes

`runIngestion()` should change from:

```ts
const parsed = parseHTML(html, url);
const docChunks = chunkDocument(parsed.content, parsed.title, parsed.headings);
```

to:

```ts
const parsed = parseHTMLToStructuredDocument(html, url);
const docChunks = chunkStructuredDocument(parsed);
```

All downstream embedding and insert logic can remain mostly unchanged.

### DB Persistence

No schema change in `structure-v1`.

Persist as today:

- `chunks.content` -> formatted chunk text
- `chunks.anchor` -> chosen chunk anchor
- `chunks.metadata` -> richer structure-aware metadata
- `chunks.tokenCount` -> estimate from chunk text

## Error Handling

Parser failures:

- log the URL and failure reason
- skip the document, same as current ingestion behavior

Element-level parsing issues:

- drop malformed elements if necessary
- continue processing remaining elements

Unsupported tags:

- ignore by default unless they contain meaningful text that should be normalized into paragraph text

## Open Implementation Choices

These are intentionally left as implementation details rather than product decisions:

- exact `domPath` encoding format
- exact normalized table-text rendering
- exact heuristics for detecting code language
- exact threshold for when a code block is “self-contained”

They should be resolved during implementation with tests, not by changing the requirements.
