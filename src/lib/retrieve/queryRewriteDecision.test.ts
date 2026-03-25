import { beforeEach, describe, expect, it, vi } from "vitest";
import { rewriteQueryForRetrieval } from "./queryRewrite";
import { resolveQueryRewriteConfig } from "./queryRewriteConfig";

describe("rewriteQueryForRetrieval", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a rewritten query when the model succeeds", async () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    const rewriteModel = vi.fn().mockResolvedValue(
      "Vite environment variables import.meta.env VITE_ prefix env exposure client-side variables",
    );

    await expect(
      rewriteQueryForRetrieval(
        "How do environment variables work in Vite, and what is the VITE_ prefix for?",
        config,
        { rewriteModel },
      ),
    ).resolves.toEqual({
      applied: true,
      originalQuery: "How do environment variables work in Vite, and what is the VITE_ prefix for?",
      rewrittenQuery:
        "Vite environment variables import.meta.env VITE_ prefix env exposure client-side variables",
      reason: "applied",
    });
  });

  it("normalizes rewritten output and collapses whitespace", async () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    const rewriteModel = vi.fn().mockResolvedValue(
      "  Vite   path aliases   resolve.alias   configuration  ",
    );

    await expect(
      rewriteQueryForRetrieval("How do I set up path aliases in Vite?", config, { rewriteModel }),
    ).resolves.toEqual({
      applied: true,
      originalQuery: "How do I set up path aliases in Vite?",
      rewrittenQuery: "Vite path aliases resolve.alias configuration",
      reason: "applied",
    });
  });

  it("returns equivalent_to_original when the rewritten query normalizes to the same text", async () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    const rewriteModel = vi.fn().mockResolvedValue("How do I set up path aliases in Vite?");

    await expect(
      rewriteQueryForRetrieval("How do I set up path aliases in Vite?", config, { rewriteModel }),
    ).resolves.toEqual({
      applied: false,
      originalQuery: "How do I set up path aliases in Vite?",
      rewrittenQuery: null,
      reason: "equivalent_to_original",
    });
  });

  it("returns model_failed when the rewrite model fails", async () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);
    const rewriteModel = vi.fn().mockRejectedValue(new Error("network_error"));

    await expect(
      rewriteQueryForRetrieval("How do I configure a proxy in Vite?", config, { rewriteModel }),
    ).resolves.toEqual({
      applied: false,
      originalQuery: "How do I configure a proxy in Vite?",
      rewrittenQuery: null,
      reason: "model_failed",
    });
  });

  it("logs rewrite decisions only when explicit rewrite debug logging is enabled", async () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
      QUERY_REWRITE_DEBUG: "true",
    } as NodeJS.ProcessEnv);
    const rewriteModel = vi.fn().mockResolvedValue("Vite server proxy configuration dev server proxy");
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await rewriteQueryForRetrieval("How do I configure a proxy in Vite?", config, { rewriteModel });

    expect(consoleInfoSpy).toHaveBeenCalledWith("[query-rewrite-debug]", {
      originalQuery: "How do I configure a proxy in Vite?",
      rewrittenQuery: "Vite server proxy configuration dev server proxy",
      reason: "applied",
    });
  });
});
