export type StructuredElement =
  | HeadingElement
  | ParagraphElement
  | ListElement
  | ListItemElement
  | CodeBlockElement
  | TableElement
  | BlockQuoteElement;

export interface StructuredDocument {
  url: string;
  title: string;
  product: string;
  lang: string;
  hash: string;
  elements: StructuredElement[];
}

export interface BaseElement {
  type: string;
  order: number;
  text: string;
  anchor?: string;
  headingPath: string[];
  primaryHeading: string;
  domPath?: string;
}

export interface HeadingElement extends BaseElement {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface ParagraphElement extends BaseElement {
  type: "paragraph";
}

export interface ListElement extends BaseElement {
  type: "list";
  listKind: "ordered" | "unordered";
  items: string[];
}

export interface ListItemElement extends BaseElement {
  type: "list_item";
  listKind: "ordered" | "unordered";
  itemIndex: number;
}

export interface CodeBlockElement extends BaseElement {
  type: "code";
  codeLanguage?: string;
}

export interface TableElement extends BaseElement {
  type: "table";
  html: string;
  rows: string[][];
}

export interface BlockQuoteElement extends BaseElement {
  type: "blockquote";
}

export interface StructureAwareChunkMetadata {
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
}

export interface StructureAwareChunk {
  content: string;
  chunkIndex: number;
  anchor?: string;
  metadata: StructureAwareChunkMetadata;
}
