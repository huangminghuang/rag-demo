import { describe, expect, it, vi } from "vitest";
import { resolveHybridRetrievalConfig } from "./hybridRetrievalConfig";
import { resolveQueryRewriteConfig } from "./queryRewriteConfig";
import { resolveRerankingConfig } from "./rerankingConfig";

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

function rerankingConfig(overrides: Record<string, string> = {}) {
  return resolveRerankingConfig({
    RERANKING_ENABLED: "true",
    RERANKING_CANDIDATE_COUNT: "10",
    ...overrides,
  } as unknown as NodeJS.ProcessEnv);
}

describe("reranking acceptance", () => {
  it("improves top-1 and top-3 ordering for conversational retrieval without dropping strong support", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-broad",
          content: "General Vite configuration overview.",
          url: "https://vite.dev/guide/",
          title: "Guide",
          anchor: null,
          similarity: 0.84,
        },
        {
          chunkId: "chunk-support",
          content: "Additional dev server notes.",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.8,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-answer",
          content: "Configure local API forwarding with server.proxy in Vite dev server config.",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: "server-proxy",
          similarity: 0.81,
        },
      ]);
    const rerankRetrievedCandidates = vi.fn().mockResolvedValue({
      applied: true,
      status: "applied",
      inputCount: 3,
      outputCount: 3,
      beforeIds: ["chunk-broad", "chunk-answer", "chunk-support"],
      afterIds: ["chunk-answer", "chunk-broad", "chunk-support"],
      diagnostics: [
        {
          chunkId: "chunk-answer",
          score: 0.97,
          reason: "Most direct answer to the proxy question.",
        },
        {
          chunkId: "chunk-broad",
          score: 0.52,
          reason: "Useful background context.",
        },
        {
          chunkId: "chunk-support",
          score: 0.48,
          reason: "Secondary support.",
        },
      ],
      candidates: [
        {
          chunkId: "chunk-answer",
          content: "Configure local API forwarding with server.proxy in Vite dev server config.",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: "server-proxy",
          similarity: 0.81,
          matchedBy: ["vector_rewritten"],
        },
        {
          chunkId: "chunk-broad",
          content: "General Vite configuration overview.",
          url: "https://vite.dev/guide/",
          title: "Guide",
          anchor: null,
          similarity: 0.84,
          matchedBy: ["vector_original"],
        },
        {
          chunkId: "chunk-support",
          content: "Additional dev server notes.",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.8,
          matchedBy: ["vector_original"],
        },
      ],
    });

    const result = await retrieveRelevantChunks(
      "How do I configure a proxy for local API calls in Vite?",
      { limit: 3, threshold: 0.55, debug: true },
      {
        searchByQuery,
        resolveRerankingConfig: () => rerankingConfig(),
        resolveRewriteConfig: () => rewriteConfig(),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "How do I configure a proxy for local API calls in Vite?",
          rewrittenQuery: "Vite dev server proxy server.proxy configuration",
          reason: "applied",
        }),
        rerankRetrievedCandidates,
      },
    );

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      "Configure local API forwarding with server.proxy in Vite dev server config.",
      "General Vite configuration overview.",
      "Additional dev server notes.",
    ]);
    expect(result.debug.reranking?.status).toBe("applied");
    expect(result.debug.reranking?.afterIds).toEqual([
      "chunk-answer",
      "chunk-broad",
      "chunk-support",
    ]);
  });

  it.each([
    {
      label: "exact identifier",
      query: "import.meta.env",
      exactId: "chunk-exact",
      exactContent: "Use import.meta.env to access client-exposed environment variables.",
      exactMatchSource: ["lexical_original"] as const,
    },
    {
      label: "file name",
      query: "vite.config.ts",
      exactId: "chunk-file",
      exactContent: "Use vite.config.ts to configure project-level Vite behavior.",
      exactMatchSource: ["lexical_original"] as const,
    },
    {
      label: "config path",
      query: "server.proxy",
      exactId: "chunk-config",
      exactContent: "Configure the dev server with server.proxy for local API calls.",
      exactMatchSource: ["lexical_original"] as const,
    },
    {
      label: "command",
      query: "vite build",
      exactId: "chunk-command",
      exactContent: "Run vite build to generate a production bundle.",
      exactMatchSource: ["lexical_original"] as const,
    },
  ])("keeps $label queries strong after reranking", async ({ query, exactId, exactContent, exactMatchSource }) => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-broad",
        content: "Broader Vite guide content.",
        url: "https://vite.dev/guide/",
        title: "Guide",
        anchor: null,
        similarity: 0.77,
      },
    ]);
    const searchLexically = vi.fn().mockResolvedValue([
      {
        chunkId: exactId,
        content: exactContent,
        url: "https://vite.dev/config/",
        title: "Config Reference",
        anchor: null,
        similarity: 0.92,
      },
    ]);
    const rerankRetrievedCandidates = vi.fn().mockResolvedValue({
      applied: true,
      status: "applied",
      inputCount: 2,
      outputCount: 2,
      beforeIds: [exactId, "chunk-broad"],
      afterIds: [exactId, "chunk-broad"],
      diagnostics: [],
      candidates: [
        {
          chunkId: exactId,
          content: exactContent,
          url: "https://vite.dev/config/",
          title: "Config Reference",
          anchor: null,
          similarity: 0.92,
          matchedBy: [...exactMatchSource],
        },
        {
          chunkId: "chunk-broad",
          content: "Broader Vite guide content.",
          url: "https://vite.dev/guide/",
          title: "Guide",
          anchor: null,
          similarity: 0.77,
          matchedBy: ["vector_original"],
        },
      ],
    });

    const result = await retrieveRelevantChunks(
      query,
      { limit: 2, threshold: 0.55, debug: true },
      {
        searchByQuery,
        searchLexically,
        resolveHybridConfig: () => hybridConfig(),
        resolveRerankingConfig: () => rerankingConfig(),
        resolveRewriteConfig: () => rewriteConfig(),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: false,
          originalQuery: query,
          rewrittenQuery: null,
          reason: "identifier_like",
        }),
        rerankRetrievedCandidates,
      },
    );

    expect(result.chunks[0]?.content).toBe(exactContent);
    expect(result.chunks[0]?.matchedBy).toEqual(exactMatchSource);
    expect(result.debug.reranking?.status).toBe("applied");
  });

  it("prefers distinct useful evidence in the top results when candidates are near-duplicates", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-duplicate-a",
          content: "Modes control which .env files are loaded in Vite.",
          url: "https://vite.dev/guide/env-and-mode",
          title: "Env Variables and Modes",
          anchor: "modes",
          similarity: 0.82,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-duplicate-b",
          content: "Modes control which .env files are loaded in Vite, including mode-specific files.",
          url: "https://vite.dev/guide/env-and-mode",
          title: "Env Variables and Modes",
          anchor: "modes",
          similarity: 0.81,
        },
      ]);
    const searchLexically = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-distinct",
        content: ".env, .env.local, and mode-specific files are loaded in a defined priority order.",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: "env-files",
        similarity: 0.9,
      },
    ]);
    const rerankRetrievedCandidates = vi.fn().mockResolvedValue({
      applied: true,
      status: "applied",
      inputCount: 3,
      outputCount: 2,
      beforeIds: ["chunk-distinct", "chunk-duplicate-a", "chunk-duplicate-b"],
      afterIds: ["chunk-duplicate-a", "chunk-distinct"],
      diagnostics: [
        {
          chunkId: "chunk-duplicate-a",
          score: 0.94,
          reason: "Strong primary answer chunk.",
        },
        {
          chunkId: "chunk-distinct",
          score: 0.88,
          reason: "Adds distinct env-file loading detail.",
        },
      ],
      candidates: [
        {
          chunkId: "chunk-duplicate-a",
          content: "Modes control which .env files are loaded in Vite.",
          url: "https://vite.dev/guide/env-and-mode",
          title: "Env Variables and Modes",
          anchor: "modes",
          similarity: 0.82,
          matchedBy: ["vector_original"],
        },
        {
          chunkId: "chunk-distinct",
          content: ".env, .env.local, and mode-specific files are loaded in a defined priority order.",
          url: "https://vite.dev/guide/env-and-mode",
          title: "Env Variables and Modes",
          anchor: "env-files",
          similarity: 0.9,
          matchedBy: ["lexical_original"],
        },
      ],
    });

    const result = await retrieveRelevantChunks(
      "What are Vite modes, and how do they affect .env file loading?",
      { limit: 2, threshold: 0.55, debug: true },
      {
        searchByQuery,
        searchLexically,
        resolveHybridConfig: () => hybridConfig(),
        resolveRerankingConfig: () => rerankingConfig(),
        resolveRewriteConfig: () => rewriteConfig(),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "What are Vite modes, and how do they affect .env file loading?",
          rewrittenQuery: "Vite modes env file loading",
          reason: "applied",
        }),
        rerankRetrievedCandidates,
      },
    );

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      "Modes control which .env files are loaded in Vite.",
      ".env, .env.local, and mode-specific files are loaded in a defined priority order.",
    ]);
    expect(result.debug.reranking?.afterIds).toEqual(["chunk-duplicate-a", "chunk-distinct"]);
  });
});
