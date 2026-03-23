import { describe, expect, it } from "vitest";
import { buildChunkEmbeddingInput, deriveDocumentProcessingHash, prepareChunksForEmbedding } from "./embeddingInput";
import { resolveEnrichmentConfig } from "./enrichmentConfig";
import type { StructureAwareChunk } from "./structureTypes";

function createChunk(overrides: Partial<StructureAwareChunk> = {}): StructureAwareChunk {
  return {
    chunkIndex: 0,
    content:
      "Document: Guide\nPath: Guide > Intro\n\nThis is the source-grounded prose chunk content for authentication setup.",
    metadata: {
      chunk_version: "structure-v1",
      source_title: "Guide",
      heading_path: ["Guide", "Intro"],
      primary_heading: "Intro",
      element_types: ["paragraph"],
      content_kind: "prose",
      word_count: 14,
      token_estimate: 24,
      enrichment: {
        version: "meta-v1",
        status: "success",
        summary: "Explains authentication setup.",
        keywords: ["authentication", "setup"],
        hypothetical_questions: ["How do I configure authentication?"],
        entities: ["authentication"],
        topics: ["configuration"],
      },
    },
    ...overrides,
  };
}

function createTableChunk(overrides: Partial<StructureAwareChunk> = {}): StructureAwareChunk {
  return {
    chunkIndex: 0,
    content: "Document: Guide\nPath: Guide > Limits\nType: Table\n\nTier | Requests per minute\nFree | 60\nPro | 300",
    metadata: {
      chunk_version: "structure-v1",
      source_title: "Guide",
      heading_path: ["Guide", "Limits"],
      primary_heading: "Limits",
      element_types: ["table"],
      content_kind: "table",
      word_count: 12,
      token_estimate: 22,
      enrichment: {
        version: "meta-v1",
        status: "success",
        summary: "Shows request limits by tier.",
        keywords: ["rate limits", "tiers"],
        hypothetical_questions: ["What are the request limits for each tier?"],
        table_summary: "The Pro tier allows 300 requests per minute versus 60 for Free.",
      },
    },
    ...overrides,
  };
}

function createCodeChunk(overrides: Partial<StructureAwareChunk> = {}): StructureAwareChunk {
  return {
    chunkIndex: 0,
    content: "Document: Guide\nPath: Guide > SDK\nType: Code\n\nconst client = createClient({ apiKey });\nawait client.query({ prompt: \"Hello\" });",
    metadata: {
      chunk_version: "structure-v1",
      source_title: "Guide",
      heading_path: ["Guide", "SDK"],
      primary_heading: "SDK",
      element_types: ["code"],
      content_kind: "code",
      word_count: 16,
      token_estimate: 28,
      enrichment: {
        version: "meta-v1",
        status: "success",
        summary: "Shows how to initialize and query the client.",
        keywords: ["client", "query"],
        hypothetical_questions: ["How do I initialize the client and send a query?"],
        code_summary: "Creates a client instance and executes a query request.",
        api_symbols: ["createClient", "client.query"],
      },
      code_language: "ts",
    },
    ...overrides,
  };
}

describe("buildChunkEmbeddingInput", () => {
  it("builds a normalized embedding input for successfully enriched prose chunks", () => {
    const embeddingInput = buildChunkEmbeddingInput(createChunk());

    expect(embeddingInput).toContain("Summary: Explains authentication setup.");
    expect(embeddingInput).toContain("Keywords: authentication, setup");
    expect(embeddingInput).toContain("Questions:");
    expect(embeddingInput).toContain("Content:");
    expect(embeddingInput).toContain("This is the source-grounded prose chunk content");
  });

  it("falls back to raw chunk content for non-success enrichment states", () => {
    const rawContent = createChunk({
      metadata: {
        ...createChunk().metadata,
        enrichment: {
          version: "meta-v1",
          status: "failed",
          failure_reason: "invalid_enrichment_output",
        },
      },
    }).content;

    expect(
      buildChunkEmbeddingInput(
        createChunk({
          metadata: {
            ...createChunk().metadata,
            enrichment: {
              version: "meta-v1",
              status: "failed",
              failure_reason: "invalid_enrichment_output",
            },
          },
        }),
      ),
    ).toBe(rawContent);
  });

  it("builds a normalized embedding input for successfully enriched table chunks", () => {
    const embeddingInput = buildChunkEmbeddingInput(createTableChunk());

    expect(embeddingInput).toContain("Type: Table");
    expect(embeddingInput).toContain("Summary: Shows request limits by tier.");
    expect(embeddingInput).toContain(
      "Table Summary: The Pro tier allows 300 requests per minute versus 60 for Free.",
    );
    expect(embeddingInput).toContain("Content:");
    expect(embeddingInput).toContain("Tier | Requests per minute");
  });

  it("builds a normalized embedding input for successfully enriched code chunks", () => {
    const embeddingInput = buildChunkEmbeddingInput(createCodeChunk());

    expect(embeddingInput).toContain("Type: Code");
    expect(embeddingInput).toContain("Summary: Shows how to initialize and query the client.");
    expect(embeddingInput).toContain("Code Summary: Creates a client instance and executes a query request.");
    expect(embeddingInput).toContain("Symbols: createClient, client.query");
    expect(embeddingInput).toContain("const client = createClient");
  });
});

describe("prepareChunksForEmbedding", () => {
  it("keeps persisted chunk content separate from embedding input", () => {
    const [prepared] = prepareChunksForEmbedding([createChunk()]);

    expect(prepared.content).toContain("source-grounded prose chunk content");
    expect(prepared.embeddingInput).not.toBe(prepared.content);
    expect(prepared.metadata.embedding_input_version).toBe("embed-v1");
    expect(prepared.metadata.embedding_input_preview).toContain("Summary: Explains authentication setup.");
  });
});

describe("deriveDocumentProcessingHash", () => {
  it("changes when enrichment policy settings change even if parsed content hash is unchanged", () => {
    const configA = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
    });
    const configB = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose",
      ENRICH_METADATA_MIN_CHARS: "120",
    });

    expect(
      deriveDocumentProcessingHash("same-parsed-hash", configA),
    ).not.toBe(deriveDocumentProcessingHash("same-parsed-hash", configB));
  });
});
