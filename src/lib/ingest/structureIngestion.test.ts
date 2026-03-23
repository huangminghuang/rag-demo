import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chunkDocument } from "./chunker";
import { parseHTML } from "./parser";
import { chunkStructuredDocument } from "./structureChunker";
import { parseHTMLToStructuredDocument } from "./structureParser";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__");

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

describe("structure-aware ingestion pipeline", () => {
  it("produces persistence-ready records with JSON-serializable metadata", () => {
    const fixtureNames = ["table-heavy.html", "code-heavy.html", "mixed-content.html"];

    for (const fixtureName of fixtureNames) {
      const url = `https://example.com/docs/en-us/guide/${fixtureName}`;
      const parsed = parseHTMLToStructuredDocument(readFixture(fixtureName), url);
      const chunks = chunkStructuredDocument(parsed);
      const records = chunks.map((chunk) => ({
        content: chunk.content,
        anchor: chunk.anchor,
        tokenCount: chunk.metadata.token_estimate,
        metadata: chunk.metadata,
      }));

      expect(chunks.length).toBeGreaterThan(0);
      expect(records.every((record) => typeof record.content === "string" && record.content.length > 0)).toBe(true);
      expect(records.every((record) => Number.isInteger(record.tokenCount) && record.tokenCount > 0)).toBe(true);
      expect(records.every((record) => typeof JSON.stringify(record.metadata) === "string")).toBe(true);
    }
  });

  it("keeps the structured pipeline compatible with legacy ingest inputs while adding typed chunk metadata", () => {
    const fixtureNames = ["table-heavy.html", "code-heavy.html", "mixed-content.html"];

    for (const fixtureName of fixtureNames) {
      const url = `https://example.com/docs/en-us/guide/${fixtureName}`;
      const html = readFixture(fixtureName);
      const legacyParsed = parseHTML(html, url);
      const legacyChunks = chunkDocument(legacyParsed.content, legacyParsed.title, legacyParsed.headings);
      const structuredParsed = parseHTMLToStructuredDocument(html, url);
      const structuredChunks = chunkStructuredDocument(structuredParsed);

      expect(legacyChunks.length).toBeGreaterThan(0);
      expect(structuredChunks.length).toBeGreaterThan(0);
      expect(structuredChunks.every((chunk) => chunk.metadata.chunk_version === "structure-v1")).toBe(true);
    }
  });

  it("preserves table-heavy retrieval context in dedicated table chunks", () => {
    const parsed = parseHTMLToStructuredDocument(
      readFixture("table-heavy.html"),
      "https://example.com/docs/en-us/guide/table-heavy",
    );
    const chunks = chunkStructuredDocument(parsed);
    const tableChunks = chunks.filter((chunk) => chunk.metadata.content_kind === "table");

    expect(tableChunks).toHaveLength(1);
    expect(tableChunks[0].content).toContain("Requests per minute");
    expect(tableChunks[0].metadata.table_html).toContain("<table");
  });

  it("preserves code-heavy retrieval context in dedicated code chunks", () => {
    const parsed = parseHTMLToStructuredDocument(
      readFixture("code-heavy.html"),
      "https://example.com/docs/en-us/guide/code-heavy",
    );
    const chunks = chunkStructuredDocument(parsed);
    const codeChunks = chunks.filter((chunk) => chunk.metadata.content_kind === "code");

    expect(codeChunks).toHaveLength(1);
    expect(codeChunks[0].content).toContain("createClient");
    expect(codeChunks[0].metadata.code_language).toBe("ts");
  });

  it("preserves mixed-content retrieval context across prose, list, table, and code sections", () => {
    const parsed = parseHTMLToStructuredDocument(
      readFixture("mixed-content.html"),
      "https://example.com/docs/en-us/guide/mixed-content",
    );
    const chunks = chunkStructuredDocument(parsed);
    const contentKinds = chunks.map((chunk) => chunk.metadata.content_kind);

    expect(contentKinds).toContain("mixed");
    expect(contentKinds).toContain("table");
    expect(contentKinds).toContain("code");
    expect(chunks.some((chunk) => chunk.content.includes("Install dependencies"))).toBe(true);
  });
});
