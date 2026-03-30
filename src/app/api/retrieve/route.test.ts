import { beforeEach, describe, expect, it, vi } from "vitest";

const retrieveRelevantChunks = vi.fn();
const requireUser = vi.fn();
const requireCsrf = vi.fn();

vi.mock("@/lib/retrieve", () => ({
  retrieveRelevantChunks,
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser,
}));

vi.mock("@/lib/auth/csrf", () => ({
  requireCsrf,
}));

describe("POST /api/retrieve", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireCsrf.mockReturnValue(null);
    requireUser.mockResolvedValue({
      ok: true,
      user: { id: "user-1", email: "test@example.com", name: "Test", role: "user" },
    });
  });

  it("uses the shared retrieval boundary and keeps the response shape unchanged", async () => {
    retrieveRelevantChunks.mockResolvedValue([
      {
        content: "Retrieved chunk",
        url: "https://vite.dev/guide/env",
        title: "Env Variables",
        anchor: null,
        similarity: 0.87,
      },
    ]);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/retrieve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "csrf_token=test-token",
          "x-csrf-token": "test-token",
        },
        body: JSON.stringify({
          query: "How do environment variables work in Vite?",
          limit: 4,
          threshold: 0.7,
        }),
      }),
    );

    expect(retrieveRelevantChunks).toHaveBeenCalledWith(
      "How do environment variables work in Vite?",
      {
        debug: false,
        limit: 4,
        threshold: 0.7,
      },
    );
    await expect(response.json()).resolves.toEqual({
      chunks: [
        {
          content: "Retrieved chunk",
          url: "https://vite.dev/guide/env",
          title: "Env Variables",
          anchor: null,
          similarity: 0.87,
        },
      ],
    });
  });

  it("returns rewrite and fusion debug details only when explicit debug mode is requested", async () => {
    retrieveRelevantChunks.mockResolvedValue({
      chunks: [
        {
          content: "Retrieved chunk",
          url: "https://vite.dev/guide/env",
          title: "Env Variables",
          anchor: null,
          similarity: 0.87,
          matchedBy: ["vector_original", "lexical_rewritten"],
        },
      ],
      debug: {
        originalQuery: "How do environment variables work in Vite?",
        rewrittenQuery: "Vite environment variables import.meta.env VITE_ prefix",
        rewriteApplied: true,
        rewriteReason: "applied",
        originalBranchCount: 3,
        rewrittenBranchCount: 2,
        branchCounts: {
          vectorOriginal: 2,
          lexicalOriginal: 1,
          vectorRewritten: 1,
          lexicalRewritten: 1,
        },
        fusedCount: 1,
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/retrieve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "csrf_token=test-token",
          "x-csrf-token": "test-token",
        },
        body: JSON.stringify({
          query: "How do environment variables work in Vite?",
          debug: true,
        }),
      }),
    );

    expect(retrieveRelevantChunks).toHaveBeenCalledWith(
      "How do environment variables work in Vite?",
      {
        debug: true,
        limit: 5,
        threshold: 0.55,
      },
    );
    await expect(response.json()).resolves.toEqual({
      chunks: [
        {
          content: "Retrieved chunk",
          url: "https://vite.dev/guide/env",
          title: "Env Variables",
          anchor: null,
          similarity: 0.87,
          matchedBy: ["vector_original", "lexical_rewritten"],
        },
      ],
      debug: {
        originalQuery: "How do environment variables work in Vite?",
        rewrittenQuery: "Vite environment variables import.meta.env VITE_ prefix",
        rewriteApplied: true,
        rewriteReason: "applied",
        originalBranchCount: 3,
        rewrittenBranchCount: 2,
        branchCounts: {
          vectorOriginal: 2,
          lexicalOriginal: 1,
          vectorRewritten: 1,
          lexicalRewritten: 1,
        },
        fusedCount: 1,
      },
    });
  });
});
