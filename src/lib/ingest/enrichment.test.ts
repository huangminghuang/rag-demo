import { describe, expect, it, vi } from "vitest";
import { planChunkEnrichment, resolveEnrichmentConfig } from "./enrichmentConfig";
import { enrichChunksForIngestion, enrichPlannedChunks, validateEnrichmentOutput } from "./enrichment";
import { deriveDocumentProcessingHash } from "./embeddingInput";
import type { StructureAwareChunk } from "./structureTypes";

function createProseChunk(overrides: Partial<StructureAwareChunk> = {}): StructureAwareChunk {
  return {
    chunkIndex: 0,
    content:
      "Document: Guide\nPath: Guide > Intro\n\nThis chunk explains how to configure authentication for a local development workflow.",
    metadata: {
      chunk_version: "structure-v1",
      source_title: "Guide",
      heading_path: ["Guide", "Intro"],
      primary_heading: "Intro",
      element_types: ["paragraph"],
      content_kind: "prose",
      word_count: 17,
      token_estimate: 31,
    },
    ...overrides,
  };
}

function createTableChunk(overrides: Partial<StructureAwareChunk> = {}): StructureAwareChunk {
  return {
    chunkIndex: 0,
    content:
      "Document: Guide\nPath: Guide > Limits\nType: Table\n\nTier | Requests per minute\nFree | 60\nPro | 300",
    metadata: {
      chunk_version: "structure-v1",
      source_title: "Guide",
      heading_path: ["Guide", "Limits"],
      primary_heading: "Limits",
      element_types: ["table"],
      content_kind: "table",
      word_count: 12,
      token_estimate: 22,
      table_html: "<table><tr><th>Tier</th><th>Requests per minute</th></tr><tr><td>Free</td><td>60</td></tr><tr><td>Pro</td><td>300</td></tr></table>",
    },
    ...overrides,
  };
}

function createCodeChunk(overrides: Partial<StructureAwareChunk> = {}): StructureAwareChunk {
  return {
    chunkIndex: 0,
    content:
      "Document: Guide\nPath: Guide > SDK\nType: Code\n\nconst client = createClient({ apiKey });\nawait client.query({ prompt: \"Hello\" });",
    metadata: {
      chunk_version: "structure-v1",
      source_title: "Guide",
      heading_path: ["Guide", "SDK"],
      primary_heading: "SDK",
      element_types: ["code"],
      content_kind: "code",
      word_count: 16,
      token_estimate: 28,
      code_language: "ts",
    },
    ...overrides,
  };
}

describe("enrichPlannedChunks", () => {
  it("stores successful nested enrichment metadata for an eligible prose chunk", async () => {
    const chunk = createProseChunk();
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
      ENRICH_MAX_RETRIES: "0",
    });
    const [planned] = planChunkEnrichment([chunk], config);
    const enrichChunk = vi.fn().mockResolvedValue({
      summary: "Explains local authentication configuration.",
      keywords: ["authentication", "local development"],
      hypothetical_questions: ["How do I configure authentication locally?"],
      entities: ["authentication"],
      topics: ["configuration"],
    });

    const [result] = await enrichPlannedChunks([planned], config, enrichChunk);

    expect(enrichChunk).toHaveBeenCalledTimes(1);
    expect(result.metadata.enrichment).toEqual({
      version: "meta-v1",
      status: "success",
      summary: "Explains local authentication configuration.",
      keywords: ["authentication", "local development"],
      hypothetical_questions: ["How do I configure authentication locally?"],
      entities: ["authentication"],
      topics: ["configuration"],
    });
  });

  it("falls back to failed enrichment metadata when prose output is invalid", async () => {
    const chunk = createProseChunk();
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
      ENRICH_MAX_RETRIES: "0",
    });
    const [planned] = planChunkEnrichment([chunk], config);
    const enrichChunk = vi.fn().mockResolvedValue({
      keywords: ["authentication"],
      hypothetical_questions: ["How do I configure authentication locally?"],
    });

    const [result] = await enrichPlannedChunks([planned], config, enrichChunk);

    expect(result.metadata.enrichment).toEqual({
      version: "meta-v1",
      status: "failed",
      failure_reason: "invalid_enrichment_output",
    });
  });

  it("stores skipped-by-policy metadata without calling the model", async () => {
    const chunk = createProseChunk({ content: "tiny" });
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
      ENRICH_MAX_RETRIES: "0",
    });
    const [planned] = planChunkEnrichment([chunk], config);
    const enrichChunk = vi.fn();

    const [result] = await enrichPlannedChunks([planned], config, enrichChunk);

    expect(enrichChunk).not.toHaveBeenCalled();
    expect(result.metadata.enrichment).toEqual({
      version: "meta-v1",
      status: "skipped_by_policy",
      skip_reason: "below_min_chars",
    });
  });

  it("normalizes successful prose enrichment output by trimming and deduping list fields", () => {
    expect(
      validateEnrichmentOutput(createProseChunk(), {
        summary: "  Explains local authentication configuration.  ",
        keywords: [" authentication ", "local development", "authentication"],
        hypothetical_questions: [
          " How do I configure authentication locally? ",
          "How do I configure authentication locally?",
        ],
        entities: [" auth ", "auth"],
        topics: [" configuration ", "configuration"],
      }),
    ).toEqual({
      version: "meta-v1",
      status: "success",
      summary: "Explains local authentication configuration.",
      keywords: ["authentication", "local development"],
      hypothetical_questions: ["How do I configure authentication locally?"],
      entities: ["auth"],
      topics: ["configuration"],
    });
  });

  it("stores successful nested enrichment metadata for an eligible table chunk", async () => {
    const chunk = createTableChunk();
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "400",
    });
    const [planned] = planChunkEnrichment([chunk], config);
    const enrichChunk = vi.fn().mockResolvedValue({
      summary: "Shows request limits by tier.",
      keywords: ["rate limits", "tiers"],
      hypothetical_questions: ["What are the request limits for each tier?"],
      table_summary: "The Pro tier allows 300 requests per minute versus 60 for Free.",
    });

    const [result] = await enrichPlannedChunks([planned], config, enrichChunk);

    expect(result.metadata.enrichment).toEqual({
      version: "meta-v1",
      status: "success",
      summary: "Shows request limits by tier.",
      keywords: ["rate limits", "tiers"],
      hypothetical_questions: ["What are the request limits for each tier?"],
      table_summary: "The Pro tier allows 300 requests per minute versus 60 for Free.",
    });
  });

  it("falls back to failed enrichment metadata when table output is missing table_summary", async () => {
    const chunk = createTableChunk();
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "400",
    });
    const [planned] = planChunkEnrichment([chunk], config);
    const enrichChunk = vi.fn().mockResolvedValue({
      summary: "Shows request limits by tier.",
      keywords: ["rate limits"],
      hypothetical_questions: ["What are the request limits for each tier?"],
    });

    const [result] = await enrichPlannedChunks([planned], config, enrichChunk);

    expect(result.metadata.enrichment).toEqual({
      version: "meta-v1",
      status: "failed",
      failure_reason: "invalid_enrichment_output",
    });
  });

  it("stores successful nested enrichment metadata for an eligible code chunk", async () => {
    const chunk = createCodeChunk();
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
      ENRICH_MAX_RETRIES: "0",
    });
    const [planned] = planChunkEnrichment([chunk], config);
    const enrichChunk = vi.fn().mockResolvedValue({
      summary: "Shows how to initialize and query the client.",
      keywords: ["client", "query"],
      hypothetical_questions: ["How do I initialize the client and send a query?"],
      code_summary: "Creates a client instance and executes a query request.",
      api_symbols: ["createClient", "client.query"],
    });

    const [result] = await enrichPlannedChunks([planned], config, enrichChunk);

    expect(result.metadata.enrichment).toEqual({
      version: "meta-v1",
      status: "success",
      summary: "Shows how to initialize and query the client.",
      keywords: ["client", "query"],
      hypothetical_questions: ["How do I initialize the client and send a query?"],
      code_summary: "Creates a client instance and executes a query request.",
      api_symbols: ["createClient", "client.query"],
    });
  });

  it("falls back to failed enrichment metadata when code output lacks code_summary and api_symbols", async () => {
    const chunk = createCodeChunk();
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
    });
    const [planned] = planChunkEnrichment([chunk], config);
    const enrichChunk = vi.fn().mockResolvedValue({
      summary: "Shows how to initialize and query the client.",
      keywords: ["client", "query"],
      hypothetical_questions: ["How do I initialize the client and send a query?"],
    });

    const [result] = await enrichPlannedChunks([planned], config, enrichChunk);

    expect(result.metadata.enrichment).toEqual({
      version: "meta-v1",
      status: "failed",
      failure_reason: "invalid_enrichment_output",
    });
  });
});

describe("enrichChunksForIngestion", () => {
  it("applies success, failed, and skipped enrichment states before persistence", async () => {
    const eligibleSuccess = createProseChunk({
      chunkIndex: 0,
      content:
        "Document: Guide\nPath: Guide > Intro\n\nThis chunk explains local authentication configuration in enough detail to be eligible.",
    });
    const eligibleFailure = createProseChunk({
      chunkIndex: 1,
      content:
        "Document: Guide\nPath: Guide > Intro\n\nThis chunk describes local authorization behavior in enough detail to be eligible.",
    });
    const skipped = createProseChunk({
      chunkIndex: 2,
      content: "tiny",
    });
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
      ENRICH_MAX_RETRIES: "0",
    });
    const enrichChunk = vi.fn(async (chunk: StructureAwareChunk) => {
      if (chunk.chunkIndex === 0) {
        return {
          summary: "Explains local authentication configuration.",
          keywords: ["authentication", "local development"],
          hypothetical_questions: ["How do I configure authentication locally?"],
        };
      }

      return {
        keywords: ["authorization"],
      };
    });

    const results = await enrichChunksForIngestion(
      [eligibleSuccess, eligibleFailure, skipped],
      config,
      enrichChunk,
    );

    expect(enrichChunk).toHaveBeenCalledTimes(2);
    expect(results.map((chunk) => chunk.metadata.enrichment?.status)).toEqual([
      "success",
      "failed",
      "skipped_by_policy",
    ]);
  });
});

describe("issue 6 processing hash semantics", () => {
  it("treats enrichment policy changes as document reprocessing inputs", () => {
    const configA = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
    });
    const configB = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose",
      ENRICH_METADATA_MIN_CHARS: "120",
    });

    expect(deriveDocumentProcessingHash("same-hash", configA)).not.toBe(
      deriveDocumentProcessingHash("same-hash", configB),
    );
  });
});

describe("issue 9 execution modes", () => {
  it("runs enrichment sequentially when the model profile is configured for sequential execution", async () => {
    const chunks = [
      createProseChunk({ chunkIndex: 0 }),
      createProseChunk({ chunkIndex: 1 }),
      createProseChunk({ chunkIndex: 2 }),
    ];
    const config = resolveEnrichmentConfig({
      ENRICH_EXECUTION_MODE: "sequential",
      ENRICH_MAX_CONCURRENCY: "4",
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const enrichChunk = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      return {
        summary: "Explains authentication setup.",
        keywords: ["authentication"],
        hypothetical_questions: ["How do I configure authentication?"],
      };
    });

    const results = await enrichChunksForIngestion(chunks, config, enrichChunk);

    expect(maxInFlight).toBe(1);
    expect(results.every((chunk) => chunk.metadata.enrichment?.status === "success")).toBe(true);
  });

  it("applies bounded parallel enrichment up to the configured concurrency without changing result semantics", async () => {
    const chunks = [
      createProseChunk({ chunkIndex: 0 }),
      createProseChunk({ chunkIndex: 1 }),
      createProseChunk({ chunkIndex: 2 }),
      createProseChunk({ chunkIndex: 3, content: "tiny" }),
    ];
    const config = resolveEnrichmentConfig({
      ENRICH_EXECUTION_MODE: "bounded_parallel",
      ENRICH_MAX_CONCURRENCY: "2",
      ENRICH_MAX_RETRIES: "1",
      ENRICH_TIMEOUT_MS: "1000",
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const enrichChunk = vi.fn(async (chunk: StructureAwareChunk) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      if (chunk.chunkIndex === 1) {
        return {
          keywords: ["broken"],
        };
      }

      return {
        summary: `Summary ${chunk.chunkIndex}`,
        keywords: [`keyword-${chunk.chunkIndex}`],
        hypothetical_questions: [`Question ${chunk.chunkIndex}`],
      };
    });

    const results = await enrichChunksForIngestion(chunks, config, enrichChunk);

    expect(maxInFlight).toBe(2);
    expect(results.map((chunk) => chunk.metadata.enrichment?.status)).toEqual([
      "success",
      "failed",
      "success",
      "skipped_by_policy",
    ]);
  });

  it("retries failed chunk enrichment up to the configured retry limit before succeeding", async () => {
    const chunk = createProseChunk({ chunkIndex: 0 });
    const config = resolveEnrichmentConfig({
      ENRICH_EXECUTION_MODE: "bounded_parallel",
      ENRICH_MAX_CONCURRENCY: "2",
      ENRICH_MAX_RETRIES: "1",
      ENRICH_TIMEOUT_MS: "1000",
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
    });
    let attempts = 0;
    const enrichChunk = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary_failure");
      }

      return {
        summary: "Explains authentication setup.",
        keywords: ["authentication"],
        hypothetical_questions: ["How do I configure authentication?"],
      };
    });

    const [result] = await enrichChunksForIngestion([chunk], config, enrichChunk);

    expect(attempts).toBe(2);
    expect(result.metadata.enrichment?.status).toBe("success");
  });
});
