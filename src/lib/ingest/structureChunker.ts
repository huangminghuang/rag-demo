import { STRUCTURE_CHUNK_CONFIG } from "./structureConfig";
import type {
  BlockQuoteElement,
  CodeBlockElement,
  ListElement,
  ParagraphElement,
  StructuredDocument,
  StructureAwareChunk,
  StructureAwareChunkMetadata,
  TableElement,
} from "./structureTypes";

type MergeableElement = ParagraphElement | ListElement | BlockQuoteElement;

interface BufferedChunk {
  elements: MergeableElement[];
}

const DEFAULT_CHUNK_VERSION: StructureAwareChunkMetadata["chunk_version"] = "structure-v1";

// Turn a heading path array into the display string used in formatted chunk content.
function formatPath(headingPath: string[]): string {
  return headingPath.join(" > ");
}

// Estimate token count with the same rough character-based heuristic used elsewhere in ingestion.
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// Count words for chunk metadata so stored chunks carry lightweight size diagnostics.
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Format the final chunk body with document and path context before embedding and persistence.
function getFormattedContent(
  documentTitle: string,
  headingPath: string[],
  body: string,
  contentKind: StructureAwareChunkMetadata["content_kind"]
): string {
  const lines = [
    `Document: ${documentTitle}`,
    `Path: ${formatPath(headingPath)}`,
  ];

  if (contentKind === "table") {
    lines.push("Type: Table");
  } else if (contentKind === "code") {
    lines.push("Type: Code");
  }

  lines.push("", body);
  return lines.join("\n").trim();
}

// Collect the distinct element types that contributed to a chunk for metadata and debugging.
function getElementKinds(elements: Array<MergeableElement | CodeBlockElement | TableElement>) {
  return Array.from(new Set(elements.map((element) => element.type)));
}

// Decide the chunk content kind from mergeable elements that were grouped together.
function getContentKindFromMergeable(elements: MergeableElement[]): StructureAwareChunkMetadata["content_kind"] {
  const kinds = new Set(elements.map((element) => element.type));
  if (kinds.size === 1) {
    if (kinds.has("paragraph")) return "prose";
    if (kinds.has("list")) return "list";
    if (kinds.has("blockquote")) return "blockquote";
  }

  return "mixed";
}

// Pick the first available anchor from the elements that contributed to a chunk.
function getChunkAnchor(elements: Array<{ anchor?: string }>): string | undefined {
  return elements.find((element) => element.anchor)?.anchor;
}

// Collect unique DOM paths from contributing elements so chunk metadata stays debuggable.
function getDomPaths(elements: Array<{ domPath?: string }>): string[] | undefined {
  const paths = elements.map((element) => element.domPath).filter(Boolean) as string[];
  return paths.length > 0 ? Array.from(new Set(paths)) : undefined;
}

// Build a fully formatted structure-aware chunk with consistent metadata.
function createChunk(
  chunkIndex: number,
  document: StructuredDocument,
  headingPath: string[],
  body: string,
  contentKind: StructureAwareChunkMetadata["content_kind"],
  elements: Array<MergeableElement | CodeBlockElement | TableElement>,
  extraMetadata: Partial<StructureAwareChunkMetadata> = {}
): StructureAwareChunk {
  const content = getFormattedContent(document.title, headingPath, body, contentKind);

  return {
    chunkIndex,
    content,
    anchor: getChunkAnchor(elements),
    metadata: {
      chunk_version: DEFAULT_CHUNK_VERSION,
      source_title: document.title,
      heading_path: headingPath,
      primary_heading: headingPath.at(-1) || document.title,
      element_types: getElementKinds(elements),
      content_kind: contentKind,
      word_count: countWords(body),
      token_estimate: estimateTokenCount(content),
      dom_paths: getDomPaths(elements),
      ...extraMetadata,
    },
  };
}

// Split oversized text using progressively weaker boundaries before falling back to hard cuts.
function splitByBoundaries(
  text: string,
  maxChars: number,
  boundaries: RegExp[],
): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  for (const boundary of boundaries) {
    const parts = normalized
      .split(boundary)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length > 1 && parts.every((part) => part.length <= maxChars)) {
      return parts;
    }
  }

  const result: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    result.push(normalized.slice(start, start + maxChars).trim());
    start += maxChars;
  }
  return result.filter(Boolean);
}

// Split large prose on paragraph, newline, sentence, and then hard-length boundaries.
function splitParagraphText(text: string): string[] {
  return splitByBoundaries(text, STRUCTURE_CHUNK_CONFIG.maxChars, [/\n\s*\n/g, /\n/g, /(?<=[.!?])\s+/g]);
}

// Split large code blocks on logical blank lines, then line boundaries, then hard-length fallback.
function splitCodeText(text: string): string[] {
  return splitByBoundaries(text, STRUCTURE_CHUNK_CONFIG.maxChars, [/\n{2,}/g, /\n/g]);
}

// Reuse the first row as the table header when a large table must be split into row groups.
function detectTableHeader(rows: string[][]): string[] | undefined {
  if (rows.length <= 1) return rows[0];
  return rows[0];
}

// Turn table rows into a readable plain-text form for chunk content and size checks.
function getNormalizedTableText(rows: string[][]): string {
  return rows.map((row) => row.join(" | ")).join("\n");
}

// Split oversized tables into row groups while repeating the detected header row when present.
function splitTableRows(rows: string[][]): string[][][] {
  const normalizedText = getNormalizedTableText(rows);
  if (normalizedText.length <= STRUCTURE_CHUNK_CONFIG.maxChars) {
    return [rows];
  }

  const header = detectTableHeader(rows);
  const dataRows = header ? rows.slice(1) : rows;
  const groups: string[][][] = [];
  let current: string[][] = header ? [header] : [];

  for (const row of dataRows) {
    const nextGroup = [...current, row];
    const nextText = getNormalizedTableText(nextGroup);

    if (current.length > (header ? 1 : 0) && nextText.length > STRUCTURE_CHUNK_CONFIG.maxChars) {
      groups.push(current);
      current = header ? [header, row] : [row];
      continue;
    }

    current = nextGroup;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

// Get the text used for merge decisions and formatted output from mergeable element types.
function getMergeableText(element: MergeableElement): string {
  if (element.type === "list") {
    return element.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
  }
  return element.text;
}

// Decide whether another mergeable element still fits cleanly into the current buffered chunk.
function canMerge(buffer: BufferedChunk, candidate: MergeableElement): boolean {
  if (buffer.elements.length === 0) return true;

  const first = buffer.elements[0];
  if (first.headingPath.join("\u0000") !== candidate.headingPath.join("\u0000")) {
    return false;
  }

  const nextText = [...buffer.elements, candidate]
    .map((element) => getMergeableText(element))
    .join("\n\n");

  return nextText.length <= STRUCTURE_CHUNK_CONFIG.targetChars;
}

// Flush the buffered prose/list/blockquote elements into a finalized chunk.
function flushBufferedChunk(
  buffer: BufferedChunk,
  document: StructuredDocument,
  chunks: StructureAwareChunk[],
): void {
  if (buffer.elements.length === 0) return;

  const elements = [...buffer.elements];
  buffer.elements = [];
  const body = elements.map((element) => getMergeableText(element)).join("\n\n");
  chunks.push(
    createChunk(
      chunks.length,
      document,
      elements[0].headingPath,
      body,
      getContentKindFromMergeable(elements),
      elements,
    ),
  );
}

// Build chunk records for split paragraph/code/table parts while preserving split metadata.
function buildSplitChunks(
  document: StructuredDocument,
  element: ParagraphElement | CodeBlockElement | TableElement,
  parts: string[],
  contentKind: StructureAwareChunkMetadata["content_kind"],
  extraMetadata: Partial<StructureAwareChunkMetadata> = {},
  tableHtml?: string,
): StructureAwareChunk[] {
  return parts.map((part, index) =>
    createChunk(
      index,
      document,
      element.headingPath,
      part,
      contentKind,
      [element],
      {
        ...extraMetadata,
        ...(tableHtml ? { table_html: tableHtml } : {}),
        split_part: {
          index: index + 1,
          total: parts.length,
          original_type: contentKind === "prose" ? "paragraph" : contentKind,
        },
      },
    ),
  );
}

// Create one or more prose chunks from a paragraph, splitting only when it exceeds the size budget.
function createParagraphChunks(document: StructuredDocument, element: ParagraphElement): StructureAwareChunk[] {
  const parts = splitParagraphText(element.text);
  if (parts.length === 1) {
    return [createChunk(0, document, element.headingPath, parts[0], "prose", [element])];
  }

  return buildSplitChunks(document, element, parts, "prose");
}

// Create one or more code chunks from a code block, preserving inferred language metadata.
function createCodeChunks(document: StructuredDocument, element: CodeBlockElement): StructureAwareChunk[] {
  const parts = splitCodeText(element.text);
  if (parts.length === 1) {
    return [
      createChunk(0, document, element.headingPath, parts[0], "code", [element], {
        code_language: element.codeLanguage,
      }),
    ];
  }

  return buildSplitChunks(
    document,
    element,
    parts,
    "code",
    { code_language: element.codeLanguage },
  );
}

// Create one or more table chunks from a table while preserving the original table HTML in metadata.
function createTableChunks(document: StructuredDocument, element: TableElement): StructureAwareChunk[] {
  const rowGroups = splitTableRows(element.rows);
  if (rowGroups.length === 1) {
    const body = getNormalizedTableText(rowGroups[0]);
    return [
      createChunk(0, document, element.headingPath, body, "table", [element], {
        table_html: element.html,
      }),
    ];
  }

  const total = rowGroups.length;
  return rowGroups.map((rows, index) =>
    createChunk(
      index,
      document,
      element.headingPath,
      getNormalizedTableText(rows),
      "table",
      [element],
      {
        table_html: element.html,
        split_part: {
          index: index + 1,
          total,
          original_type: "table",
        },
      },
    ),
  );
}

// Build chunks from structured elements while preserving structure boundaries for tables, code, and headings.
export function chunkStructuredDocument(document: StructuredDocument): StructureAwareChunk[] {
  const chunks: StructureAwareChunk[] = [];
  const buffer: BufferedChunk = { elements: [] };

  for (const element of document.elements) {
    if (element.type === "heading") {
      flushBufferedChunk(buffer, document, chunks);
      continue;
    }

    if (element.type === "table") {
      flushBufferedChunk(buffer, document, chunks);
      for (const chunk of createTableChunks(document, element)) {
        chunks.push({ ...chunk, chunkIndex: chunks.length });
      }
      continue;
    }

    if (element.type === "code") {
      flushBufferedChunk(buffer, document, chunks);
      for (const chunk of createCodeChunks(document, element)) {
        chunks.push({ ...chunk, chunkIndex: chunks.length });
      }
      continue;
    }

    if (element.type === "paragraph" && element.text.length > STRUCTURE_CHUNK_CONFIG.maxChars) {
      flushBufferedChunk(buffer, document, chunks);
      for (const chunk of createParagraphChunks(document, element)) {
        chunks.push({ ...chunk, chunkIndex: chunks.length });
      }
      continue;
    }

    if (!canMerge(buffer, element)) {
      flushBufferedChunk(buffer, document, chunks);
    }

    buffer.elements.push(element);
  }

  flushBufferedChunk(buffer, document, chunks);
  return chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index }));
}
