import { describe, expect, it } from "vitest";
import { chunkStructuredDocument } from "./structureChunker";
import type { StructuredDocument } from "./structureTypes";

function createDocument(elements: StructuredDocument["elements"]): StructuredDocument {
  return {
    url: "https://example.com/docs/en-us/guide/start",
    title: "Guide",
    product: "guide",
    lang: "en-us",
    hash: "hash",
    elements,
  };
}

describe("chunkStructuredDocument", () => {
  it("flushes on heading boundaries and preserves heading context", () => {
    const document = createDocument([
      {
        type: "heading",
        level: 1,
        order: 0,
        text: "Intro",
        anchor: "intro",
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
      },
      {
        type: "paragraph",
        order: 1,
        text: "Intro paragraph.",
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
        anchor: "intro",
      },
      {
        type: "heading",
        level: 2,
        order: 2,
        text: "Details",
        anchor: "details",
        headingPath: ["Guide", "Intro", "Details"],
        primaryHeading: "Details",
      },
      {
        type: "paragraph",
        order: 3,
        text: "Details paragraph.",
        headingPath: ["Guide", "Intro", "Details"],
        primaryHeading: "Details",
        anchor: "details",
      },
    ]);

    const chunks = chunkStructuredDocument(document);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.heading_path).toEqual(["Guide", "Intro"]);
    expect(chunks[1].metadata.heading_path).toEqual(["Guide", "Intro", "Details"]);
  });

  it("keeps tables and code blocks isolated from surrounding prose", () => {
    const document = createDocument([
      {
        type: "paragraph",
        order: 0,
        text: "Intro paragraph.",
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
      },
      {
        type: "table",
        order: 1,
        text: "Name | Value\nRate | 100",
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
        html: "<table><tr><th>Name</th><th>Value</th></tr><tr><td>Rate</td><td>100</td></tr></table>",
        rows: [["Name", "Value"], ["Rate", "100"]],
      },
      {
        type: "code",
        order: 2,
        text: "const value = 1;\nconsole.log(value);",
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
        codeLanguage: "ts",
      },
      {
        type: "paragraph",
        order: 3,
        text: "Ending paragraph.",
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
      },
    ]);

    const chunks = chunkStructuredDocument(document);

    expect(chunks).toHaveLength(4);
    expect(chunks[0].metadata.content_kind).toBe("prose");
    expect(chunks[1].metadata.content_kind).toBe("table");
    expect(chunks[2].metadata.content_kind).toBe("code");
    expect(chunks[3].metadata.content_kind).toBe("prose");
    expect(chunks[1].metadata.table_html).toContain("<table>");
    expect(chunks[2].metadata.code_language).toBe("ts");
  });

  it("does not overlap content across structural boundaries", () => {
    const document = createDocument([
      {
        type: "paragraph",
        order: 0,
        text: "First paragraph.",
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
      },
      {
        type: "code",
        order: 1,
        text: "const first = true;",
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
      },
    ]);

    const chunks = chunkStructuredDocument(document);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain("First paragraph.");
    expect(chunks[0].content).not.toContain("const first = true;");
    expect(chunks[1].content).toContain("const first = true;");
    expect(chunks[1].content).not.toContain("First paragraph.");
  });

  it("splits oversized paragraphs, code blocks, and tables with split metadata", () => {
    const longSentence = "This is a sentence that is intentionally repeated to exceed the paragraph size limit. ";
    const longParagraph = longSentence.repeat(60);
    const longCode = Array.from({ length: 450 }, (_, index) => `const item${index} = ${index};`).join("\n");
    const longTableRows = Array.from({ length: 180 }, (_, index) => [`Name ${index}`, `Value ${index}`]);
    const document = createDocument([
      {
        type: "paragraph",
        order: 0,
        text: longParagraph,
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
      },
      {
        type: "code",
        order: 1,
        text: longCode,
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
        codeLanguage: "ts",
      },
      {
        type: "table",
        order: 2,
        text: "",
        headingPath: ["Guide", "Intro"],
        primaryHeading: "Intro",
        html: "<table></table>",
        rows: [["Name", "Value"], ...longTableRows],
      },
    ]);

    const chunks = chunkStructuredDocument(document);

    const paragraphChunks = chunks.filter((chunk) => chunk.metadata.split_part?.original_type === "paragraph");
    const codeChunks = chunks.filter((chunk) => chunk.metadata.split_part?.original_type === "code");
    const tableChunks = chunks.filter((chunk) => chunk.metadata.split_part?.original_type === "table");

    expect(paragraphChunks.length).toBeGreaterThan(1);
    expect(codeChunks.length).toBeGreaterThan(1);
    expect(tableChunks.length).toBeGreaterThan(1);
    expect(tableChunks[0].metadata.table_html).toBe("<table></table>");
  });

  it("populates structure-aware metadata and chunk version", () => {
    const document = createDocument([
      {
        type: "list",
        order: 0,
        text: "1. Install\n2. Run",
        headingPath: ["Guide", "Setup"],
        primaryHeading: "Setup",
        items: ["Install", "Run"],
        listKind: "ordered",
        anchor: "setup",
        domPath: "body > article > ol:nth-of-type(1)",
      },
      {
        type: "blockquote",
        order: 1,
        text: "Remember to check the docs.",
        headingPath: ["Guide", "Setup"],
        primaryHeading: "Setup",
        anchor: "setup",
        domPath: "body > article > blockquote:nth-of-type(1)",
      },
    ]);

    const [chunk] = chunkStructuredDocument(document);

    expect(chunk.metadata.chunk_version).toBe("structure-v1");
    expect(chunk.metadata.heading_path).toEqual(["Guide", "Setup"]);
    expect(chunk.metadata.content_kind).toBe("mixed");
    expect(chunk.metadata.element_types).toEqual(["list", "blockquote"]);
    expect(chunk.metadata.dom_paths).toEqual([
      "body > article > ol:nth-of-type(1)",
      "body > article > blockquote:nth-of-type(1)",
    ]);
  });
});
