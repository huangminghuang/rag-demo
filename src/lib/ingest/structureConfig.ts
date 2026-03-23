export const MAIN_CONTENT_SELECTORS = [
  "article",
  "main",
  '[role="main"]',
  ".content",
  "#main-content",
  "body",
] as const;

export const BOILERPLATE_SELECTORS = [
  "header",
  "footer",
  "nav",
  "script",
  "style",
  ".nav-container",
  ".footer-container",
] as const;

export const STRUCTURE_CHUNK_CONFIG = {
  targetChars: 2200,
  maxChars: 3200,
  minMergeChars: 200,
  isolateTables: true,
  isolateCodeBlocks: true,
  overlapChars: 0,
} as const;
