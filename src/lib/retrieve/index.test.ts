import { describe, expect, it, vi } from "vitest";
import { resolveHybridRetrievalConfig } from "./hybridRetrievalConfig";
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

  it("falls back to original-only retrieval when rewrite generation fails", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-1",
        content: "Original branch fallback",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: null,
        similarity: 0.88,
      },
    ]);

    const results = await retrieveRelevantChunks(
      "How do environment variables work in Vite?",
      { limit: 3, threshold: 0.55 },
      {
        searchByQuery,
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: false,
          originalQuery: "How do environment variables work in Vite?",
          rewrittenQuery: null,
          reason: "model_failed",
        }),
      },
    );

    expect(searchByQuery).toHaveBeenCalledTimes(1);
    expect(searchByQuery).toHaveBeenCalledWith("How do environment variables work in Vite?", {
      limit: 3,
      threshold: 0.55,
    });
    expect(results).toEqual([
      {
        content: "Original branch fallback",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: null,
        similarity: 0.88,
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
          matchedBy: ["vector_original"],
        },
        {
          content: "Shared hit",
          url: "https://vite.dev/guide/shared",
          title: "Shared",
          anchor: null,
          similarity: 0.81,
          matchedBy: ["vector_original", "vector_rewritten"],
        },
      ],
      debug: {
        originalQuery: "How do I configure a proxy in Vite?",
        rewrittenQuery: "Vite dev server proxy server.proxy configuration",
        rewriteApplied: true,
        rewriteReason: "applied",
        originalBranchCount: 2,
        rewrittenBranchCount: 1,
        branchCounts: {
          vectorOriginal: 2,
          lexicalOriginal: 0,
          vectorRewritten: 1,
          lexicalRewritten: 0,
        },
        fusedCount: 2,
        reranking: {
          status: "skipped_disabled",
          applied: false,
          inputCount: 2,
          outputCount: 2,
          beforeIds: ["chunk-original-only", "chunk-both"],
          afterIds: ["chunk-original-only", "chunk-both"],
          diagnostics: [],
        },
      },
    });
  });

  it("returns skipped reranking metadata for original-only debug retrieval", async () => {
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

    const result = await retrieveRelevantChunks(
      "resolve.alias",
      { limit: 3, threshold: 0.55, debug: true },
      {
        searchByQuery,
        resolveRerankingConfig: () =>
          ({ enabled: false, candidateCount: 10, timeoutMs: 2500, debug: false }),
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

    expect(result).toEqual({
      chunks: [
        {
          content: "Exact identifier match",
          url: "https://vite.dev/config/shared-options",
          title: "Config",
          anchor: "resolve-alias",
          similarity: 0.91,
          matchedBy: ["vector_original"],
        },
      ],
      debug: {
        originalQuery: "resolve.alias",
        rewrittenQuery: null,
        rewriteApplied: false,
        rewriteReason: "identifier_like",
        originalBranchCount: 1,
        rewrittenBranchCount: 0,
        branchCounts: {
          vectorOriginal: 1,
          lexicalOriginal: 0,
          vectorRewritten: 0,
          lexicalRewritten: 0,
        },
        fusedCount: 1,
        reranking: {
          status: "skipped_disabled",
          applied: false,
          inputCount: 1,
          outputCount: 1,
          beforeIds: ["chunk-1"],
          afterIds: ["chunk-1"],
          diagnostics: [],
        },
      },
    });
  });

  it("uses hybrid lexical and vector retrieval through the shared boundary when enabled", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-vector",
          content: "Vector branch content",
          url: "https://vite.dev/guide/features",
          title: "Features",
          anchor: null,
          similarity: 0.82,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-rewritten-vector",
          content: "Rewritten vector content",
          url: "https://vite.dev/guide/dep-pre-bundling",
          title: "Dependency Pre-Bundling",
          anchor: null,
          similarity: 0.84,
        },
      ]);
    const searchLexically = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-lexical",
          content: "Exact optimizeDeps identifier match",
          url: "https://vite.dev/config/dep-optimization-options",
          title: "Dep Optimization Options",
          anchor: null,
          similarity: 0.79,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-rewritten-vector",
          content: "Rewritten vector content",
          url: "https://vite.dev/guide/dep-pre-bundling",
          title: "Dependency Pre-Bundling",
          anchor: null,
          similarity: 0.77,
        },
      ]);

    const results = await retrieveRelevantChunks(
      "How does Vite dependency pre-bundling work?",
      { limit: 3, threshold: 0.6 },
      {
        searchByQuery,
        searchLexically,
        resolveHybridConfig: () =>
          resolveHybridRetrievalConfig({
            HYBRID_RETRIEVAL_ENABLED: "true",
            HYBRID_PRE_FUSION_LIMIT: "12",
          } as unknown as NodeJS.ProcessEnv),
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "How does Vite dependency pre-bundling work?",
          rewrittenQuery: "Vite dependency pre-bundling optimizeDeps esbuild dev server",
          reason: "applied",
        }),
      },
    );

    expect(searchByQuery).toHaveBeenNthCalledWith(
      1,
      "How does Vite dependency pre-bundling work?",
      {
        limit: 12,
        threshold: 0.6,
      },
    );
    expect(searchLexically).toHaveBeenNthCalledWith(
      1,
      "How does Vite dependency pre-bundling work?",
      {
        limit: 12,
        trigramThreshold: 0.18,
      },
    );
    expect(searchByQuery).toHaveBeenNthCalledWith(
      2,
      "Vite dependency pre-bundling optimizeDeps esbuild dev server",
      {
        limit: 12,
        threshold: 0.6,
      },
    );
    expect(searchLexically).toHaveBeenNthCalledWith(
      2,
      "Vite dependency pre-bundling optimizeDeps esbuild dev server",
      {
        limit: 12,
        trigramThreshold: 0.18,
      },
    );
    expect(results).toEqual([
      {
        content: "Rewritten vector content",
        url: "https://vite.dev/guide/dep-pre-bundling",
        title: "Dependency Pre-Bundling",
        anchor: null,
        similarity: expect.any(Number),
      },
      {
        content: "Vector branch content",
        url: "https://vite.dev/guide/features",
        title: "Features",
        anchor: null,
        similarity: expect.any(Number),
      },
      {
        content: "Exact optimizeDeps identifier match",
        url: "https://vite.dev/config/dep-optimization-options",
        title: "Dep Optimization Options",
        anchor: null,
        similarity: expect.any(Number),
      },
    ]);
  });

  it("reranks fused vector results through the shared retrieval boundary when enabled", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-original",
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-rewritten",
          content: "Rewritten branch content",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.81,
        },
      ]);
    const rerankRetrievedCandidates = vi.fn().mockResolvedValue({
      applied: true,
      status: "applied",
      inputCount: 2,
      outputCount: 2,
      beforeIds: ["chunk-original", "chunk-rewritten"],
      afterIds: ["chunk-rewritten", "chunk-original"],
      diagnostics: [],
      candidates: [
        {
          chunkId: "chunk-rewritten",
          content: "Rewritten branch content",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.81,
          matchedBy: ["vector_rewritten"],
        },
        {
          chunkId: "chunk-original",
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
          matchedBy: ["vector_original"],
        },
      ],
    });

    const results = await retrieveRelevantChunks(
      "How do I configure a proxy in Vite?",
      { limit: 2, threshold: 0.6 },
      {
        searchByQuery,
        resolveRerankingConfig: () =>
          ({ enabled: true, candidateCount: 10, timeoutMs: 2500, debug: false }),
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "How do I configure a proxy in Vite?",
          rewrittenQuery: "Vite dev server proxy server.proxy configuration",
          reason: "applied",
        }),
        rerankRetrievedCandidates,
      },
    );

    expect(rerankRetrievedCandidates).toHaveBeenCalledWith(
      {
        originalQuery: "How do I configure a proxy in Vite?",
        rewrittenQuery: "Vite dev server proxy server.proxy configuration",
        candidates: [
          {
            chunkId: "chunk-original",
            content: "Original branch content",
            url: "https://vite.dev/guide/env",
            title: "Env",
            anchor: null,
            similarity: 0.82,
            matchedBy: ["vector_original"],
          },
          {
            chunkId: "chunk-rewritten",
            content: "Rewritten branch content",
            url: "https://vite.dev/config/server-options",
            title: "Server Options",
            anchor: null,
            similarity: 0.81,
            matchedBy: ["vector_rewritten"],
          },
        ],
        limit: 2,
      },
      {
        enabled: true,
        candidateCount: 10,
        timeoutMs: 2500,
        debug: false,
      },
    );
    expect(results).toEqual([
      {
        content: "Rewritten branch content",
        url: "https://vite.dev/config/server-options",
        title: "Server Options",
        anchor: null,
        similarity: 0.81,
      },
      {
        content: "Original branch content",
        url: "https://vite.dev/guide/env",
        title: "Env",
        anchor: null,
        similarity: 0.82,
      },
    ]);
  });

  it("returns reranking debug metadata when reranking applies", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-original",
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-rewritten",
          content: "Rewritten branch content",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.81,
        },
      ]);
    const rerankRetrievedCandidates = vi.fn().mockResolvedValue({
      applied: true,
      status: "applied",
      inputCount: 2,
      outputCount: 2,
      beforeIds: ["chunk-original", "chunk-rewritten"],
      afterIds: ["chunk-rewritten", "chunk-original"],
      diagnostics: [
        {
          chunkId: "chunk-rewritten",
          score: 0.97,
          reason: "More directly answers proxy setup.",
        },
        {
          chunkId: "chunk-original",
          score: 0.61,
          reason: "Relevant but less specific.",
        },
      ],
      candidates: [
        {
          chunkId: "chunk-rewritten",
          content: "Rewritten branch content",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.81,
          matchedBy: ["vector_rewritten"],
        },
        {
          chunkId: "chunk-original",
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
          matchedBy: ["vector_original"],
        },
      ],
    });

    const result = await retrieveRelevantChunks(
      "How do I configure a proxy in Vite?",
      { limit: 2, threshold: 0.6, debug: true },
      {
        searchByQuery,
        resolveRerankingConfig: () =>
          ({ enabled: true, candidateCount: 10, timeoutMs: 2500, debug: false }),
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "How do I configure a proxy in Vite?",
          rewrittenQuery: "Vite dev server proxy server.proxy configuration",
          reason: "applied",
        }),
        rerankRetrievedCandidates,
      },
    );

    expect(result).toEqual({
      chunks: [
        {
          content: "Rewritten branch content",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.81,
          matchedBy: ["vector_rewritten"],
        },
        {
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
          matchedBy: ["vector_original"],
        },
      ],
      debug: {
        originalQuery: "How do I configure a proxy in Vite?",
        rewrittenQuery: "Vite dev server proxy server.proxy configuration",
        rewriteApplied: true,
        rewriteReason: "applied",
        originalBranchCount: 1,
        rewrittenBranchCount: 1,
        branchCounts: {
          vectorOriginal: 1,
          lexicalOriginal: 0,
          vectorRewritten: 1,
          lexicalRewritten: 0,
        },
        fusedCount: 2,
        reranking: {
          status: "applied",
          applied: true,
          inputCount: 2,
          outputCount: 2,
          beforeIds: ["chunk-original", "chunk-rewritten"],
          afterIds: ["chunk-rewritten", "chunk-original"],
          diagnostics: [
            {
              chunkId: "chunk-rewritten",
              score: 0.97,
              reason: "More directly answers proxy setup.",
            },
            {
              chunkId: "chunk-original",
              score: 0.61,
              reason: "Relevant but less specific.",
            },
          ],
        },
      },
    });
  });

  it("returns reranking fallback metadata when reranking does not apply successfully", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-original",
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-rewritten",
          content: "Rewritten branch content",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.81,
        },
      ]);
    const rerankRetrievedCandidates = vi.fn().mockResolvedValue({
      applied: false,
      status: "fallback_model_failed",
      inputCount: 2,
      outputCount: 2,
      beforeIds: ["chunk-original", "chunk-rewritten"],
      afterIds: ["chunk-original", "chunk-rewritten"],
      diagnostics: [],
      candidates: [
        {
          chunkId: "chunk-original",
          content: "Original branch content",
          url: "https://vite.dev/guide/env",
          title: "Env",
          anchor: null,
          similarity: 0.82,
          matchedBy: ["vector_original"],
        },
        {
          chunkId: "chunk-rewritten",
          content: "Rewritten branch content",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.81,
          matchedBy: ["vector_rewritten"],
        },
      ],
    });

    const result = await retrieveRelevantChunks(
      "How do I configure a proxy in Vite?",
      { limit: 2, threshold: 0.6, debug: true },
      {
        searchByQuery,
        resolveRerankingConfig: () =>
          ({ enabled: true, candidateCount: 10, timeoutMs: 2500, debug: false }),
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "How do I configure a proxy in Vite?",
          rewrittenQuery: "Vite dev server proxy server.proxy configuration",
          reason: "applied",
        }),
        rerankRetrievedCandidates,
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
          matchedBy: ["vector_original"],
        },
        {
          content: "Rewritten branch content",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          similarity: 0.81,
          matchedBy: ["vector_rewritten"],
        },
      ],
      debug: {
        originalQuery: "How do I configure a proxy in Vite?",
        rewrittenQuery: "Vite dev server proxy server.proxy configuration",
        rewriteApplied: true,
        rewriteReason: "applied",
        originalBranchCount: 1,
        rewrittenBranchCount: 1,
        branchCounts: {
          vectorOriginal: 1,
          lexicalOriginal: 0,
          vectorRewritten: 1,
          lexicalRewritten: 0,
        },
        fusedCount: 2,
        reranking: {
          status: "fallback_model_failed",
          applied: false,
          inputCount: 2,
          outputCount: 2,
          beforeIds: ["chunk-original", "chunk-rewritten"],
          afterIds: ["chunk-original", "chunk-rewritten"],
          diagnostics: [],
          fallbackReason: "model_failed",
        },
      },
    });
  });

  it("uses hybrid retrieval for exact queries even when rewrite is skipped", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-vector",
        content: "General env guide",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: null,
        similarity: 0.81,
      },
    ]);
    const searchLexically = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-lexical",
        content: "Use import.meta.env to access exposed variables.",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: "env-variables",
        similarity: 0.92,
      },
    ]);

    const results = await retrieveRelevantChunks(
      "import.meta.env",
      { limit: 2, threshold: 0.55 },
      {
        searchByQuery,
        searchLexically,
        resolveHybridConfig: () =>
          resolveHybridRetrievalConfig({
            HYBRID_RETRIEVAL_ENABLED: "true",
          } as unknown as NodeJS.ProcessEnv),
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: false,
          originalQuery: "import.meta.env",
          rewrittenQuery: null,
          reason: "identifier_like",
        }),
      },
    );

    expect(searchByQuery).toHaveBeenCalledTimes(1);
    expect(searchLexically).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        content: "Use import.meta.env to access exposed variables.",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: "env-variables",
        similarity: expect.any(Number),
      },
      {
        content: "General env guide",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: null,
        similarity: expect.any(Number),
      },
    ]);
  });

  it("returns branch-level debug metadata for hybrid retrieval when debug mode is requested", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-vector",
          content: "Vector branch content",
          url: "https://vite.dev/guide/features",
          title: "Features",
          anchor: null,
          similarity: 0.82,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-shared",
          content: "Shared rewritten vector content",
          url: "https://vite.dev/guide/dep-pre-bundling",
          title: "Dependency Pre-Bundling",
          anchor: null,
          similarity: 0.84,
        },
      ]);
    const searchLexically = vi
      .fn()
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-shared",
          content: "Shared rewritten vector content",
          url: "https://vite.dev/guide/dep-pre-bundling",
          title: "Dependency Pre-Bundling",
          anchor: null,
          similarity: 0.79,
        },
      ])
      .mockResolvedValueOnce([
        {
          chunkId: "chunk-lexical-rewritten",
          content: "Rewritten lexical match",
          url: "https://vite.dev/config/dep-optimization-options",
          title: "Dep Optimization Options",
          anchor: null,
          similarity: 0.77,
        },
      ]);

    const result = await retrieveRelevantChunks(
      "How does Vite dependency pre-bundling work?",
      { limit: 3, threshold: 0.6, debug: true },
      {
        searchByQuery,
        searchLexically,
        resolveHybridConfig: () =>
          resolveHybridRetrievalConfig({
            HYBRID_RETRIEVAL_ENABLED: "true",
            HYBRID_PRE_FUSION_LIMIT: "12",
          } as unknown as NodeJS.ProcessEnv),
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: true,
          originalQuery: "How does Vite dependency pre-bundling work?",
          rewrittenQuery: "Vite dependency pre-bundling optimizeDeps esbuild dev server",
          reason: "applied",
        }),
      },
    );

    expect(result).toEqual({
      chunks: [
        {
          content: "Shared rewritten vector content",
          url: "https://vite.dev/guide/dep-pre-bundling",
          title: "Dependency Pre-Bundling",
          anchor: null,
          similarity: expect.any(Number),
          matchedBy: ["lexical_original", "vector_rewritten"],
        },
        {
          content: "Vector branch content",
          url: "https://vite.dev/guide/features",
          title: "Features",
          anchor: null,
          similarity: expect.any(Number),
          matchedBy: ["vector_original"],
        },
        {
          content: "Rewritten lexical match",
          url: "https://vite.dev/config/dep-optimization-options",
          title: "Dep Optimization Options",
          anchor: null,
          similarity: expect.any(Number),
          matchedBy: ["lexical_rewritten"],
        },
      ],
      debug: {
        originalQuery: "How does Vite dependency pre-bundling work?",
        rewrittenQuery: "Vite dependency pre-bundling optimizeDeps esbuild dev server",
        rewriteApplied: true,
        rewriteReason: "applied",
        originalBranchCount: 2,
        rewrittenBranchCount: 2,
        branchCounts: {
          vectorOriginal: 1,
          lexicalOriginal: 1,
          vectorRewritten: 1,
          lexicalRewritten: 1,
        },
        fusedCount: 3,
        reranking: {
          status: "skipped_disabled",
          applied: false,
          inputCount: 3,
          outputCount: 3,
          beforeIds: ["chunk-shared", "chunk-vector", "chunk-lexical-rewritten"],
          afterIds: ["chunk-shared", "chunk-vector", "chunk-lexical-rewritten"],
          diagnostics: [],
        },
      },
    });
  });

  it("reranks hybrid fused results through the shared retrieval boundary when enabled", async () => {
    const { retrieveRelevantChunks } = await import("./index");
    const searchByQuery = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-vector",
        content: "Vector branch content",
        url: "https://vite.dev/guide/features",
        title: "Features",
        anchor: null,
        similarity: 0.82,
      },
    ]);
    const searchLexically = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-lexical",
        content: "Exact optimizeDeps identifier match",
        url: "https://vite.dev/config/dep-optimization-options",
        title: "Dep Optimization Options",
        anchor: null,
        similarity: 0.9,
      },
    ]);
    const rerankRetrievedCandidates = vi.fn().mockResolvedValue({
      applied: true,
      status: "applied",
      inputCount: 2,
      outputCount: 2,
      beforeIds: ["chunk-lexical", "chunk-vector"],
      afterIds: ["chunk-vector", "chunk-lexical"],
      diagnostics: [],
      candidates: [
        {
          chunkId: "chunk-vector",
          content: "Vector branch content",
          url: "https://vite.dev/guide/features",
          title: "Features",
          anchor: null,
          similarity: 0.82,
          matchedBy: ["vector_original"],
        },
        {
          chunkId: "chunk-lexical",
          content: "Exact optimizeDeps identifier match",
          url: "https://vite.dev/config/dep-optimization-options",
          title: "Dep Optimization Options",
          anchor: null,
          similarity: 0.9,
          matchedBy: ["lexical_original"],
        },
      ],
    });

    const results = await retrieveRelevantChunks(
      "optimizeDeps",
      { limit: 2, threshold: 0.55 },
      {
        searchByQuery,
        searchLexically,
        resolveHybridConfig: () =>
          resolveHybridRetrievalConfig({
            HYBRID_RETRIEVAL_ENABLED: "true",
          } as unknown as NodeJS.ProcessEnv),
        resolveRerankingConfig: () =>
          ({ enabled: true, candidateCount: 10, timeoutMs: 2500, debug: false }),
        resolveRewriteConfig: () =>
          resolveQueryRewriteConfig({ QUERY_REWRITE_ENABLED: "true" } as NodeJS.ProcessEnv),
        rewriteQuery: vi.fn().mockResolvedValue({
          applied: false,
          originalQuery: "optimizeDeps",
          rewrittenQuery: null,
          reason: "identifier_like",
        }),
        rerankRetrievedCandidates,
      },
    );

    expect(rerankRetrievedCandidates).toHaveBeenCalledWith(
      {
        originalQuery: "optimizeDeps",
        rewrittenQuery: null,
        candidates: [
          {
            chunkId: "chunk-lexical",
            content: "Exact optimizeDeps identifier match",
            url: "https://vite.dev/config/dep-optimization-options",
            title: "Dep Optimization Options",
            anchor: null,
            similarity: expect.any(Number),
            matchedBy: ["lexical_original"],
          },
          {
            chunkId: "chunk-vector",
            content: "Vector branch content",
            url: "https://vite.dev/guide/features",
            title: "Features",
            anchor: null,
            similarity: expect.any(Number),
            matchedBy: ["vector_original"],
          },
        ],
        limit: 2,
      },
      {
        enabled: true,
        candidateCount: 10,
        timeoutMs: 2500,
        debug: false,
      },
    );
    expect(results).toEqual([
      {
        content: "Vector branch content",
        url: "https://vite.dev/guide/features",
        title: "Features",
        anchor: null,
        similarity: 0.82,
      },
      {
        content: "Exact optimizeDeps identifier match",
        url: "https://vite.dev/config/dep-optimization-options",
        title: "Dep Optimization Options",
        anchor: null,
        similarity: 0.9,
      },
    ]);
  });
});
