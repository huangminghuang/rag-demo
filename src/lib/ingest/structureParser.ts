import crypto from "crypto";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import {
  BOILERPLATE_SELECTORS,
  MAIN_CONTENT_SELECTORS,
} from "./structureConfig";
import type {
  BlockQuoteElement,
  CodeBlockElement,
  HeadingElement,
  ListElement,
  ParagraphElement,
  StructuredDocument,
  StructuredElement,
  TableElement,
} from "./structureTypes";

interface ParseContext {
  title: string;
  currentHeadings: string[];
  currentHeadingAnchor?: string;
  order: number;
  elements: StructuredElement[];
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const CONTAINER_TAGS = new Set([
  "article",
  "main",
  "section",
  "div",
  "body",
  "aside",
  "details",
  "summary",
]);

// Collapse repeated whitespace so extracted text stays consistent across DOM nodes.
function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Keep intentional line breaks while trimming noisy whitespace from multiline content like code.
function normalizeMultilineText(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

// Derive language and product from the URL path so parsed documents keep source context.
function getProductAndLang(url: string): Pick<StructuredDocument, "lang" | "product"> {
  const urlParts = new URL(url).pathname.split("/").filter(Boolean);
  return {
    lang: urlParts[1] || "en-us",
    product: urlParts[2] || "general",
  };
}

// Try to find the first meaningful main-content container on the page, and if none exists, parse the whole body.
function selectMainContentRoot($: cheerio.CheerioAPI): cheerio.Cheerio<Element> {
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const candidates = $(selector).toArray();
    for (const candidate of candidates) {
      const node = $(candidate);
      if (normalizeWhitespace(node.text())) {
        return node;
      }
    }
  }

  return $("body").first();
}

// Build a stable DOM path string for debugging where a parsed element came from.
function buildDomPath(node: Element): string {
  const parts: string[] = [];
  let current: AnyNode | null = node;

  while (current && current.type !== "root") {
    if (current.type !== "tag") {
      current = current.parent ?? null;
      continue;
    }

    const el = current as Element;
    const siblings = (el.parent?.children ?? []).filter(
      (child): child is Element => child.type === "tag" && child.tagName === el.tagName
    );
    const index = siblings.findIndex((child) => child === el) + 1;
    const id = el.attribs?.id ? `#${el.attribs.id}` : "";
    parts.push(`${el.tagName}${id}:nth-of-type(${index})`);
    current = el.parent ?? null;
  }

  return parts.reverse().join(" > ");
}

// Assemble the shared fields that every structured element carries.
function createBaseElement(
  context: ParseContext,
  node: Element,
  text: string,
  anchor?: string
) {
  const headingPath = [context.title, ...context.currentHeadings];
  return {
    order: context.order++,
    text,
    anchor,
    headingPath,
    primaryHeading: context.currentHeadings.at(-1) || context.title,
    domPath: buildDomPath(node),
  };
}

// Prefer an element's own anchor, and otherwise reuse the nearest heading anchor as context.
function getAnchorForNode($: cheerio.CheerioAPI, node: Element, fallback?: string): string | undefined {
  return $(node).attr("id") || fallback;
}

// Infer a code language from CSS classes when the markup exposes one.
function getCodeLanguage($: cheerio.CheerioAPI, node: Element): string | undefined {
  const classes = [$(node).attr("class"), $(node).find("code").first().attr("class")]
    .filter(Boolean)
    .join(" ");
  const match = classes.match(/(?:language-|lang-)([a-z0-9_+-]+)/i);
  return match?.[1]?.toLowerCase();
}

// Turn a heading node into a structured heading element and update the active heading stack.
function createHeadingElement(
  $: cheerio.CheerioAPI,
  node: Element,
  context: ParseContext
): HeadingElement | null {
  const text = normalizeWhitespace($(node).text());
  if (!text) return null;

  const level = Number.parseInt(node.tagName.slice(1), 10) as HeadingElement["level"];
  context.currentHeadings = context.currentHeadings.slice(0, level - 1);
  context.currentHeadings[level - 1] = text;

  const anchor = getAnchorForNode($, node);
  context.currentHeadingAnchor = anchor;

  return {
    type: "heading",
    level,
    ...createBaseElement(context, node, text, anchor),
  };
}

// Turn a paragraph node into a structured paragraph element when it has meaningful text.
function createParagraphElement(
  $: cheerio.CheerioAPI,
  node: Element,
  context: ParseContext
): ParagraphElement | null {
  const text = normalizeWhitespace($(node).text());
  if (!text) return null;

  return {
    type: "paragraph",
    ...createBaseElement(context, node, text, getAnchorForNode($, node, context.currentHeadingAnchor)),
  };
}

// Turn an ordered or unordered list into one structured list element with normalized item text.
function createListElement(
  $: cheerio.CheerioAPI,
  node: Element,
  context: ParseContext
): ListElement | null {
  const items = $(node)
    .children("li")
    .map((_, child) => normalizeWhitespace($(child).text()))
    .get()
    .filter(Boolean);

  if (items.length === 0) return null;

  return {
    type: "list",
    listKind: node.tagName === "ol" ? "ordered" : "unordered",
    items,
    ...createBaseElement(
      context,
      node,
      items.map((item, index) => `${index + 1}. ${item}`).join("\n"),
      getAnchorForNode($, node, context.currentHeadingAnchor)
    ),
  };
}

// Turn a standalone code block into a structured code element and preserve inferred language when possible.
function createCodeElement(
  $: cheerio.CheerioAPI,
  node: Element,
  context: ParseContext
): CodeBlockElement | null {
  const text = normalizeMultilineText($(node).text());
  if (!text) return null;

  return {
    type: "code",
    codeLanguage: getCodeLanguage($, node),
    ...createBaseElement(context, node, text, getAnchorForNode($, node, context.currentHeadingAnchor)),
  };
}

// Turn a table into structured rows plus a preserved HTML copy for later chunking and debugging.
function createTableElement(
  $: cheerio.CheerioAPI,
  node: Element,
  context: ParseContext
): TableElement | null {
  const rows = $(node)
    .find("tr")
    .toArray()
    .map((row) =>
      $(row)
        .find("th, td")
        .toArray()
        .map((cell) => normalizeWhitespace($(cell).text()))
        .filter(Boolean)
    )
    .filter((row) => row.length > 0);

  if (rows.length === 0) return null;

  const text = rows.map((row) => row.join(" | ")).join("\n");
  const html = $.html(node);

  return {
    type: "table",
    html,
    rows,
    ...createBaseElement(context, node, text, getAnchorForNode($, node, context.currentHeadingAnchor)),
  };
}

// Turn a block quote into a structured quote element while preserving the current heading context.
function createBlockQuoteElement(
  $: cheerio.CheerioAPI,
  node: Element,
  context: ParseContext
): BlockQuoteElement | null {
  const text = normalizeWhitespace($(node).text());
  if (!text) return null;

  return {
    type: "blockquote",
    ...createBaseElement(context, node, text, getAnchorForNode($, node, context.currentHeadingAnchor)),
  };
}

// Decide whether a node should be treated as a real code block instead of inline code.
function shouldTreatAsStandaloneCode($: cheerio.CheerioAPI, node: Element): boolean {
  if (node.tagName === "pre") {
    return true;
  }

  if (node.tagName !== "code") {
    return false;
  }

  if ($(node).parent().is("pre")) {
    return false;
  }

  const text = $(node).text();
  return text.includes("\n") || Boolean(getCodeLanguage($, node));
}

// Walk the DOM tree in source order and emit only the structured elements that matter for chunking.
function walkNode($: cheerio.CheerioAPI, node: AnyNode, context: ParseContext): void {
  if (node.type !== "tag") {
    return;
  }

  const element = node as Element;

  if (HEADING_TAGS.has(element.tagName)) {
    const heading = createHeadingElement($, element, context);
    if (heading) context.elements.push(heading);
    return;
  }

  if (element.tagName === "p") {
    const paragraph = createParagraphElement($, element, context);
    if (paragraph) context.elements.push(paragraph);
    return;
  }

  if (element.tagName === "ul" || element.tagName === "ol") {
    const list = createListElement($, element, context);
    if (list) context.elements.push(list);
    return;
  }

  if (shouldTreatAsStandaloneCode($, element)) {
    const code = createCodeElement($, element, context);
    if (code) context.elements.push(code);
    return;
  }

  if (element.tagName === "table") {
    const table = createTableElement($, element, context);
    if (table) context.elements.push(table);
    return;
  }

  if (element.tagName === "blockquote") {
    const blockquote = createBlockQuoteElement($, element, context);
    if (blockquote) context.elements.push(blockquote);
    return;
  }

  if (!CONTAINER_TAGS.has(element.tagName)) {
    return;
  }

  for (const child of element.children) {
    walkNode($, child, context);
  }
}

// Hash the normalized structured output so document change detection follows parsed content instead of raw HTML.
function computeStructuredHash(elements: StructuredElement[]): string {
  const payload = elements
    .map((element) => {
      if (element.type === "table") {
        return `${element.type}:${element.text}\n${element.html}`;
      }

      return `${element.type}:${element.text}`;
    })
    .join("\n\n");

  return crypto.createHash("md5").update(payload).digest("hex");
}

// Parse raw HTML into a structured document that preserves element types, order, anchors, and heading paths.
export function parseHTMLToStructuredDocument(html: string, url: string): StructuredDocument {
  const $ = cheerio.load(html);
  $(BOILERPLATE_SELECTORS.join(", ")).remove();

  const mainRoot = selectMainContentRoot($);
  const title =
    normalizeWhitespace($("title").first().text()) ||
    normalizeWhitespace(mainRoot.find("h1").first().text()) ||
    normalizeWhitespace($("body").find("h1").first().text()) ||
    "Untitled Document";

  const context: ParseContext = {
    title,
    currentHeadings: [],
    order: 0,
    elements: [],
  };

  const rootNode = mainRoot.get(0);
  if (rootNode) {
    walkNode($, rootNode, context);
  }

  const { product, lang } = getProductAndLang(url);

  return {
    url,
    title,
    product,
    lang,
    hash: computeStructuredHash(context.elements),
    elements: context.elements,
  };
}
