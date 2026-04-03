import { describe, expect, it, vi } from "vitest";
import { resolveHybridRetrievalConfig } from "./hybridRetrievalConfig";
import { resolveQueryRewriteConfig } from "./queryRewriteConfig";

vi.mock("@/lib/ingest/embeddings", () => ({
  generateEmbedding: vi.fn(),
}));

function hybridConfig(overrides: Record<string, string> = {}) {
  return resolveHybridRetrievalConfig({
    HYBRID_RETRIEVAL_ENABLED: "true",
    ...overrides,
  } as unknown as NodeJS.ProcessEnv);
}

function rewriteConfig(overrides: Record<string, string> = {}) {
  return resolveQueryRewriteConfig({
    QUERY_REWRITE_ENABLED: "true",
    ...overrides,
  } as unknown as NodeJS.ProcessEnv);
}

describe("hybrid retrieval acceptance", () => {
  it("keeps exact identifier-style queries stable or improved under hybrid retrieval", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi.fn().mockResolvedValue([
      {
        chunkId: "vector-env",
        content: "General environment variables guide.",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: null,
        similarity: 0.78,
      },
    ]);
    const searchLexically = vi.fn().mockResolvedValue([
      {
        chunkId: "lexical-env",
        content: "Use import.meta.env to access client-exposed environment variables.",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: "env-variables",
        similarity: 0.92,
      },
    ]);

    const result = await retrieveRelevantChunks(
      "import.meta.env",
      { limit: 2, threshold: 0.55, debug: true },
      {
        searchByQuery,
        searchLexically,
        resolveHybridConfig: () => hybridConfig(),
        resolveRewriteConfig: () => rewriteConfig(),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: false,
          originalQuery: "import.meta.env",
          rewrittenQuery: null,
          reason: "identifier_like",
        }),
      },
    );

    expect(result.chunks[0]?.matchedBy).toEqual(["lexical_original"]);
    expect(result.chunks[0]?.content).toContain("import.meta.env");
    expect(result.debug.branchCounts.lexicalOriginal).toBe(1);
    expect(result.debug.branchCounts.vectorOriginal).toBe(1);
  });

  it.each([
    {
      label: "config path",
      query: "server.proxy",
      lexicalContent: "Configure the dev server with server.proxy for local API calls.",
    },
    {
      label: "file name",
      query: "vite.config.ts",
      lexicalContent: "Use vite.config.ts to configure project-level Vite behavior.",
    },
    {
      label: "exact command",
      query: "vite build",
      lexicalContent: "Run vite build to generate a production bundle.",
    },
  ])("lets lexical matching lead for $label queries", async ({ query, lexicalContent }) => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi.fn().mockResolvedValue([
      {
        chunkId: `vector-${query}`,
        content: "Broader Vite guide content.",
        url: "https://vite.dev/guide/",
        title: "Guide",
        anchor: null,
        similarity: 0.73,
      },
    ]);
    const searchLexically = vi.fn().mockResolvedValue([
      {
        chunkId: `lexical-${query}`,
        content: lexicalContent,
        url: "https://vite.dev/config/",
        title: "Config Reference",
        anchor: null,
        similarity: 0.9,
      },
    ]);

    const result = await retrieveRelevantChunks(
      query,
      { limit: 2, threshold: 0.55, debug: true },
      {
        searchByQuery,
        searchLexically,
        resolveHybridConfig: () => hybridConfig(),
        resolveRewriteConfig: () => rewriteConfig(),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: false,
          originalQuery: query,
          rewrittenQuery: null,
          reason: "identifier_like",
        }),
      },
    );

    expect(result.chunks[0]?.matchedBy).toEqual(["lexical_original"]);
    expect(result.debug.branchCounts.lexicalOriginal).toBe(1);
  });

  it("keeps conversational questions benefiting from vector retrieval under hybrid mode", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "vector-original",
          content: "Original vector content",
          url: "https://vite.dev/guide/env-and-mode",
          title: "Env Variables and Modes",
          anchor: null,
          similarity: 0.8,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "vector-rewritten",
          content: "Rewritten vector content",
          url: "https://vite.dev/guide/env-and-mode",
          title: "Env Variables and Modes",
          anchor: "env-variables",
          similarity: 0.91,
        },
      ]);
    const searchLexically = vi.fn().mockResolvedValue([]);

    const result = await retrieveRelevantChunks(
      "How do environment variables work in Vite, and what is the VITE_ prefix for?",
      { limit: 2, threshold: 0.55, debug: true },
      {
        searchByQuery,
        searchLexically,
        resolveHybridConfig: () => hybridConfig(),
        resolveRewriteConfig: () => rewriteConfig(),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "How do environment variables work in Vite, and what is the VITE_ prefix for?",
          rewrittenQuery: "Vite environment variables import.meta.env VITE_ prefix env exposure",
          reason: "applied",
        }),
      },
    );

    expect(result.chunks[0]?.matchedBy).toEqual(["vector_original"]);
    expect(result.chunks.some((chunk) => chunk.matchedBy.includes("vector_rewritten"))).toBe(true);
    expect(result.debug.rewriteApplied).toBe(true);
    expect(result.debug.branchCounts.vectorOriginal).toBe(1);
    expect(result.debug.branchCounts.vectorRewritten).toBe(1);
  });
});
