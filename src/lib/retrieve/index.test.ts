import { describe, expect, it, vi } from "vitest";
import { resolveQueryRewriteConfig } from "./queryRewriteConfig";

vi.mock("@/lib/ingest/embeddings", () => ({
  generateEmbedding: vi.fn(),
}));

describe("retrieveRelevantChunks", () => {
  it("uses dual-branch fusion when query rewrite applies", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-original-only",
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
        },
        {
          chunkId: "chunk-both",
          content: "Shared hit",
          url: "https://vite.dev/guide/shared",
          title: "Shared",
          anchor: null,
          similarity: 0.78,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-both",
          content: "Shared hit",
          url: "https://vite.dev/guide/shared",
          title: "Shared",
          anchor: null,
          similarity: 0.81,
        },
        {
          chunkId: "chunk-rewritten-only",
          content: "Rewritten branch content",
          url: "https://vite.dev/guide/proxy",
          title: "Proxy",
          anchor: null,
          similarity: 0.79,
        },
      ]);

    const results = await retrieveRelevantChunks(
      "How do I configure a proxy in Vite?",
      { limit: 2, threshold: 0.6 },
      {
        searchByQuery,
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "How do I configure a proxy in Vite?",
          rewrittenQuery: "Vite dev server proxy server.proxy configuration",
          reason: "applied",
        }),
      },
    );

    expect(searchByQuery).toHaveBeenNthCalledWith(1, "How do I configure a proxy in Vite?", {
      limit: 8,
      threshold: 0.6,
    });
    expect(searchByQuery).toHaveBeenNthCalledWith(
      2,
      "Vite dev server proxy server.proxy configuration",
      { limit: 8, threshold: 0.6 },
    );
    expect(results).toEqual([
      {
        content: "Original branch content",
        url: "https://vite.dev/guide/env",
        title: "Env",
        anchor: null,
        similarity: 0.82,
      },
      {
        content: "Shared hit",
        url: "https://vite.dev/guide/shared",
        title: "Shared",
        anchor: null,
        similarity: 0.81,
      },
    ]);
  });

  it("keeps original-only retrieval behavior when rewrite is skipped", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-1",
        content: "Exact identifier match",
        url: "https://vite.dev/config/shared-options",
        title: "Config",
        anchor: "resolve-alias",
        similarity: 0.91,
      },
    ]);

    const results = await retrieveRelevantChunks(
      "resolve.alias",
      { limit: 3, threshold: 0.55 },
      {
        searchByQuery,
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: false,
          originalQuery: "resolve.alias",
          rewrittenQuery: null,
          reason: "identifier_like",
        }),
      },
    );

    expect(searchByQuery).toHaveBeenCalledTimes(1);
    expect(searchByQuery).toHaveBeenCalledWith("resolve.alias", {
      limit: 3,
      threshold: 0.55,
    });
    expect(results).toEqual([
      {
        content: "Exact identifier match",
        url: "https://vite.dev/config/shared-options",
        title: "Config",
        anchor: "resolve-alias",
        similarity: 0.91,
      },
    ]);
  });

  it("returns rewrite and provenance debug metadata only when debug mode is requested", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-original-only",
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
        },
        {
          chunkId: "chunk-both",
          content: "Shared hit",
          url: "https://vite.dev/guide/shared",
          title: "Shared",
          anchor: null,
          similarity: 0.78,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-both",
          content: "Shared hit",
          url: "https://vite.dev/guide/shared",
          title: "Shared",
          anchor: null,
          similarity: 0.81,
        },
      ]);

    const result = await retrieveRelevantChunks(
      "How do I configure a proxy in Vite?",
      { limit: 2, threshold: 0.6, debug: true },
      {
        searchByQuery,
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "How do I configure a proxy in Vite?",
          rewrittenQuery: "Vite dev server proxy server.proxy configuration",
          reason: "applied",
        }),
      },
    );

    expect(result).toEqual({
      chunks: [
        {
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
          matchedBy: "original",
        },
        {
          content: "Shared hit",
          url: "https://vite.dev/guide/shared",
          title: "Shared",
          anchor: null,
          similarity: 0.81,
          matchedBy: "both",
        },
      ],
      debug: {
        originalQuery: "How do I configure a proxy in Vite?",
        rewrittenQuery: "Vite dev server proxy server.proxy configuration",
        rewriteApplied: true,
        rewriteReason: "applied",
        originalBranchCount: 2,
        rewrittenBranchCount: 1,
        fusedCount: 2,
      },
    });
  });
});
