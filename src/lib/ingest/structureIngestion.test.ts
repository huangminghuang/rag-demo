import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chunkDocument } from "./chunker";
import { prepareChunksForEmbedding } from "./embeddingInput";
import { resolveEnrichmentConfig } from "./enrichmentConfig";
import { enrichChunksForIngestion } from "./enrichment";
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

  it("enriches table-heavy fixtures with table summaries and table-aware embedding input", async () => {
    const parsed = parseHTMLToStructuredDocument(
      readFixture("table-heavy.html"),
      "https://example.com/docs/en-us/guide/table-heavy",
    );
    const chunks = chunkStructuredDocument(parsed);
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "400",
    });
    const enriched = await enrichChunksForIngestion(chunks, config, async (chunk) => {
      if (chunk.metadata.content_kind === "table") {
        return {
          summary: "Shows request limits by tier.",
          keywords: ["rate limits", "tiers"],
          hypothetical_questions: ["What are the request limits for each tier?"],
          table_summary: "The table compares request-per-minute limits across Free and Pro tiers.",
        };
      }

      return {
        summary: "Explains quota usage.",
        keywords: ["quota"],
        hypothetical_questions: ["How do quotas work?"],
      };
    });
    const prepared = prepareChunksForEmbedding(enriched);
    const tableChunk = prepared.find((chunk) => chunk.metadata.content_kind === "table");

    expect(tableChunk?.metadata.enrichment?.table_summary).toBe(
      "The table compares request-per-minute limits across Free and Pro tiers.",
    );
    expect(tableChunk?.embeddingInput).toContain("Table Summary: The table compares request-per-minute limits across Free and Pro tiers.");
  });

  it("enriches code-heavy fixtures with code summaries and code-aware embedding input", async () => {
    const parsed = parseHTMLToStructuredDocument(
      readFixture("code-heavy.html"),
      "https://example.com/docs/en-us/guide/code-heavy",
    );
    const chunks = chunkStructuredDocument(parsed);
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
    });
    const enriched = await enrichChunksForIngestion(chunks, config, async (chunk) => {
      if (chunk.metadata.content_kind === "code") {
        return {
          summary: "Shows how to create and configure the client.",
          keywords: ["client", "sdk"],
          hypothetical_questions: ["How do I initialize the SDK client?"],
          code_summary: "Creates a configured client instance for SDK usage.",
          api_symbols: ["createClient"],
        };
      }

      return {
        summary: "Explains SDK setup.",
        keywords: ["sdk"],
        hypothetical_questions: ["How do I set up the SDK?"],
      };
    });
    const prepared = prepareChunksForEmbedding(enriched);
    const codeChunk = prepared.find((chunk) => chunk.metadata.content_kind === "code");

    expect(codeChunk?.metadata.enrichment?.code_summary).toBe(
      "Creates a configured client instance for SDK usage.",
    );
    expect(codeChunk?.embeddingInput).toContain(
      "Code Summary: Creates a configured client instance for SDK usage.",
    );
    expect(codeChunk?.embeddingInput).toContain("Symbols: createClient");
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
