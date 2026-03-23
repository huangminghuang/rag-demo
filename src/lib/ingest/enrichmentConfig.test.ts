import { describe, expect, it } from "vitest";
import { getChunkEnrichmentDecision, resolveEnrichmentConfig } from "./enrichmentConfig";
import type { StructureAwareChunk } from "./structureTypes";

function createChunk(contentKind: StructureAwareChunk["metadata"]["content_kind"]): StructureAwareChunk {
  return {
    chunkIndex: 0,
    content: "Chunk body with enough text to exceed the minimum character threshold for enrichment eligibility.",
    metadata: {
      chunk_version: "structure-v1",
      source_title: "Guide",
      heading_path: ["Guide", "Intro"],
      primary_heading: "Intro",
      element_types: ["paragraph"],
      content_kind: contentKind,
      word_count: 14,
      token_estimate: 24,
    },
  };
}

function createShortChunk(contentKind: StructureAwareChunk["metadata"]["content_kind"]): StructureAwareChunk {
  return {
    ...createChunk(contentKind),
    content: "tiny",
  };
}

describe("resolveEnrichmentConfig", () => {
  it("forces effective concurrency to 1 when sequential mode is configured", () => {
    const config = resolveEnrichmentConfig({
      ENRICH_MODEL_NAME: "gemini-test",
      ENRICH_MODEL_API_VERSION: "v1beta",
      ENRICH_EXECUTION_MODE: "sequential",
      ENRICH_MAX_CONCURRENCY: "8",
      ENRICH_TIMEOUT_MS: "15000",
      ENRICH_MAX_RETRIES: "2",
    });

    expect(config.modelProfile).toEqual({
      model: "gemini-test",
      apiVersion: "v1beta",
      mode: "sequential",
      maxConcurrency: 1,
      timeoutMs: 15000,
      maxRetries: 2,
    });
  });

  it("marks configured prose, table, and code chunks as eligible and skips unsupported kinds", () => {
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
    });

    expect(getChunkEnrichmentDecision(createChunk("prose"), config)).toEqual({
      status: "eligible",
    });
    expect(getChunkEnrichmentDecision(createChunk("table"), config)).toEqual({
      status: "eligible",
    });
    expect(getChunkEnrichmentDecision(createChunk("code"), config)).toEqual({
      status: "eligible",
    });
    expect(getChunkEnrichmentDecision(createChunk("list"), config)).toEqual({
      status: "skipped_by_policy",
      reason: "content_kind_not_enabled",
    });
  });

  it("keeps table chunks eligible even when they are below the normal minimum character threshold", () => {
    const config = resolveEnrichmentConfig({
      ENRICH_METADATA_CONTENT_KINDS: "prose,table,code",
      ENRICH_METADATA_MIN_CHARS: "40",
    });

    expect(getChunkEnrichmentDecision(createShortChunk("table"), config)).toEqual({
      status: "eligible",
    });
    expect(getChunkEnrichmentDecision(createShortChunk("prose"), config)).toEqual({
      status: "skipped_by_policy",
      reason: "below_min_chars",
    });
  });

  it("rejects bounded parallel mode when configured concurrency is less than 2", () => {
    expect(() =>
      resolveEnrichmentConfig({
        ENRICH_EXECUTION_MODE: "bounded_parallel",
        ENRICH_MAX_CONCURRENCY: "1",
      }),
    ).toThrow("ENRICH_MAX_CONCURRENCY must be at least 2 when ENRICH_EXECUTION_MODE is bounded_parallel");
  });

  it("rejects unsupported enabled content kinds", () => {
    expect(() =>
      resolveEnrichmentConfig({
        ENRICH_METADATA_CONTENT_KINDS: "prose,unknown",
      }),
    ).toThrow("Unsupported enrichment content kind: unknown");
  });
});
