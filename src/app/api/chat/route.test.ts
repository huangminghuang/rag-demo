import { beforeEach, describe, expect, it, vi } from "vitest";

const sendChatWithFallback = vi.fn();
const retrieveRelevantChunks = vi.fn();
const consumeQueryQuota = vi.fn();
const estimateQueryTokens = vi.fn();
const getQueryQuotaConfig = vi.fn();
const requireUser = vi.fn();
const requireCsrf = vi.fn();

vi.mock("@/lib/gemini", () => ({
  sendChatWithFallback,
}));

vi.mock("@/lib/retrieve", () => ({
  retrieveRelevantChunks,
}));

vi.mock("@/lib/quota/queryQuota", () => ({
  consumeQueryQuota,
  estimateQueryTokens,
  getQueryQuotaConfig,
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUser,
}));

vi.mock("@/lib/auth/csrf", () => ({
  requireCsrf,
}));

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireCsrf.mockReturnValue(null);
    requireUser.mockResolvedValue({
      ok: true,
      user: { id: "user-1", email: "test@example.com", name: "Test", role: "user" },
    });
    estimateQueryTokens.mockReturnValue(120);
    consumeQueryQuota.mockReturnValue({ allowed: true });
    getQueryQuotaConfig.mockReturnValue({ rpm: 60, tpm: 60000, rpd: 1000 });
  });

  it("uses the shared retrieval boundary and keeps the chat response shape unchanged", async () => {
    retrieveRelevantChunks.mockResolvedValue([
      {
        content: "Use the `VITE_` prefix for client-exposed env vars.",
        url: "https://vite.dev/guide/env-and-mode#env-variables",
        title: "Env Variables and Modes",
        anchor: "env-variables",
        similarity: 0.9,
      },
    ]);
    sendChatWithFallback.mockResolvedValue({
      text: "Use the `VITE_` prefix for variables exposed to client code [1].",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "csrf_token=test-token",
          "x-csrf-token": "test-token",
        },
        body: JSON.stringify({
          messages: [
            { role: "user", content: "How do environment variables work in Vite?" },
          ],
        }),
      }),
    );

    expect(retrieveRelevantChunks).toHaveBeenCalledWith(
      "How do environment variables work in Vite?",
      {
        history: [],
        limit: 5,
        threshold: expect.any(Number),
      },
    );
    await expect(response.json()).resolves.toEqual({
      content: "Use the `VITE_` prefix for variables exposed to client code [1].",
      sources: [
        {
          number: 1,
          title: "Env Variables and Modes",
          url: "https://vite.dev/guide/env-and-mode#env-variables",
        },
      ],
    });
  });

  it("passes the same retained conversation history into retrieval for reranking", async () => {
    retrieveRelevantChunks.mockResolvedValue([
      {
        content: "Configure local API forwarding with server.proxy.",
        url: "https://vite.dev/config/server-options#server-proxy",
        title: "Server Options",
        anchor: "server-proxy",
        similarity: 0.93,
      },
    ]);
    sendChatWithFallback.mockResolvedValue({
      text: "Use `server.proxy` for local API forwarding [1].",
    });

    const { POST } = await import("./route");
    await POST(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "csrf_token=test-token",
          "x-csrf-token": "test-token",
        },
        body: JSON.stringify({
          messages: [
            { role: "user", content: "What about local API calls?" },
            { role: "assistant", content: "We were discussing the dev server." },
            { role: "user", content: "How do I configure a proxy in Vite?" },
          ],
        }),
      }),
    );

    expect(retrieveRelevantChunks).toHaveBeenCalledWith(
      "How do I configure a proxy in Vite?",
      {
        history: [
          "What about local API calls?",
          "We were discussing the dev server.",
        ],
        limit: 5,
        threshold: expect.any(Number),
      },
    );
  });

  it("keeps source numbering and cited sources aligned with the final retrieval order", async () => {
    retrieveRelevantChunks.mockResolvedValue([
      {
        content: "Use server.proxy to forward local API requests.",
        url: "https://vite.dev/config/server-options#server-proxy",
        title: "Server Options",
        anchor: "server-proxy",
        similarity: 0.95,
      },
      {
        content: "General dev server overview.",
        url: "https://vite.dev/config/server-options",
        title: "Server Options",
        anchor: null,
        similarity: 0.82,
      },
    ]);
    sendChatWithFallback.mockResolvedValue({
      text: "Use `server.proxy` for local API forwarding [1].",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "csrf_token=test-token",
          "x-csrf-token": "test-token",
        },
        body: JSON.stringify({
          messages: [
            { role: "user", content: "How do I configure a proxy in Vite?" },
          ],
        }),
      }),
    );

    expect(sendChatWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("[Source 1] (https://vite.dev/config/server-options#server-proxy):"),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      content: "Use `server.proxy` for local API forwarding [1].",
      sources: [
        {
          number: 1,
          title: "Server Options",
          url: "https://vite.dev/config/server-options#server-proxy",
        },
      ],
    });
  });
});
