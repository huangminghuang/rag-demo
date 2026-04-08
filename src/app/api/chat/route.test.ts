import { beforeEach, describe, expect, it, vi } from "vitest";

const sendChatWithFallback = vi.fn();
const retrieveRelevantChunks = vi.fn();
const checkQueryAmbiguity = vi.fn();
const resolveAmbiguityGatekeeperConfig = vi.fn();
const previewQueryQuota = vi.fn();
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

vi.mock("@/lib/chat/ambiguityGatekeeper", () => ({
  checkQueryAmbiguity,
}));

vi.mock("@/lib/chat/ambiguityGatekeeperConfig", () => ({
  resolveAmbiguityGatekeeperConfig,
}));

vi.mock("@/lib/quota/queryQuota", () => ({
  consumeQueryQuota,
  estimateQueryTokens,
  getQueryQuotaConfig,
  previewQueryQuota,
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
    previewQueryQuota.mockReturnValue({ allowed: true });
    consumeQueryQuota.mockReturnValue({ allowed: true });
    getQueryQuotaConfig.mockReturnValue({ rpm: 60, tpm: 60000, rpd: 1000 });
    resolveAmbiguityGatekeeperConfig.mockReturnValue({
      enabled: true,
      modelName: "gemini-2.5-flash",
      apiVersion: "v1beta",
      timeoutMs: 2000,
      debug: false,
    });
    checkQueryAmbiguity.mockResolvedValue({
      decision: "proceed",
      reason: null,
      clarificationQuestion: null,
    });
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

  it("returns a clarification payload and skips retrieval and chat when the gatekeeper asks a question", async () => {
    checkQueryAmbiguity.mockResolvedValue({
      decision: "clarify",
      reason: "The request is underspecified.",
      clarificationQuestion: "Which Vite config file do you want to change?",
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
            { role: "user", content: "How do I set this up?" },
          ],
        }),
      }),
    );

    expect(resolveAmbiguityGatekeeperConfig).toHaveBeenCalledTimes(1);
    expect(checkQueryAmbiguity).toHaveBeenCalledWith(
      {
        userMessage: "How do I set this up?",
        history: [],
      },
      expect.objectContaining({ enabled: true }),
    );
    expect(consumeQueryQuota).toHaveBeenCalledWith(120);
    expect(retrieveRelevantChunks).not.toHaveBeenCalled();
    expect(sendChatWithFallback).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      content: "Which Vite config file do you want to change?",
      sources: [],
      needsClarification: true,
      clarificationReason: "The request is underspecified.",
    });
  });

  it("keeps the normal chat path when the gatekeeper fails open to proceed", async () => {
    checkQueryAmbiguity.mockResolvedValue({
      decision: "proceed",
      reason: null,
      clarificationQuestion: null,
    });
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

    expect(checkQueryAmbiguity).toHaveBeenCalledWith(
      {
        userMessage: "How do environment variables work in Vite?",
        history: [],
      },
      expect.objectContaining({ enabled: true }),
    );
    expect(retrieveRelevantChunks).toHaveBeenCalledWith(
      "How do environment variables work in Vite?",
      {
        history: [],
        limit: 5,
        threshold: expect.any(Number),
      },
    );
    expect(sendChatWithFallback).toHaveBeenCalledTimes(1);
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

  it("lets exact CLI command requests proceed on the normal chat path", async () => {
    checkQueryAmbiguity.mockResolvedValue({
      decision: "proceed",
      reason: "The request names an exact CLI command.",
      clarificationQuestion: null,
    });
    retrieveRelevantChunks.mockResolvedValue([
      {
        content: "Use vite build to create a production bundle.",
        url: "https://vite.dev/guide/cli#vite-build",
        title: "CLI",
        anchor: "vite-build",
        similarity: 0.94,
      },
    ]);
    sendChatWithFallback.mockResolvedValue({
      text: "Run `vite build` to create a production bundle [1].",
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
          messages: [{ role: "user", content: "vite build" }],
        }),
      }),
    );

    expect(checkQueryAmbiguity).toHaveBeenCalledWith(
      {
        userMessage: "vite build",
        history: [],
      },
      expect.objectContaining({ enabled: true }),
    );
    expect(retrieveRelevantChunks).toHaveBeenCalledWith(
      "vite build",
      {
        history: [],
        limit: 5,
        threshold: expect.any(Number),
      },
    );
    expect(sendChatWithFallback).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      content: "Run `vite build` to create a production bundle [1].",
      sources: [
        {
          number: 1,
          title: "CLI",
          url: "https://vite.dev/guide/cli#vite-build",
        },
      ],
    });
  });

  it("returns 429 and does not call the gatekeeper when the request is already over quota", async () => {
    previewQueryQuota.mockReturnValue({
      allowed: false,
      reason: "tpm",
      message: "Query TPM limit reached (250000/min).",
      retryAfterSeconds: 17,
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
            { role: "user", content: "How do I set this up?" },
          ],
        }),
      }),
    );

    expect(estimateQueryTokens).toHaveBeenCalledWith(["How do I set this up?"]);
    expect(previewQueryQuota).toHaveBeenCalledWith(120);
    expect(checkQueryAmbiguity).not.toHaveBeenCalled();
    expect(retrieveRelevantChunks).not.toHaveBeenCalled();
    expect(sendChatWithFallback).not.toHaveBeenCalled();
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Query TPM limit reached (250000/min).",
      reason: "tpm",
      limits: {
        rpm: 60,
        tpm: 60000,
        rpd: 1000,
      },
      retryAfterSeconds: 17,
    });
  });

  it("still uses the mutating quota charge on the normal chat path", async () => {
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
            { role: "user", content: "How do environment variables work in Vite?" },
          ],
        }),
      }),
    );

    expect(previewQueryQuota).toHaveBeenCalledWith(expect.any(Number));
    expect(consumeQueryQuota).toHaveBeenCalledWith(expect.any(Number));
  });

  it("fails open to the normal chat path when the gatekeeper throws", async () => {
    checkQueryAmbiguity.mockRejectedValue(new Error("gatekeeper unavailable"));
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
    expect(sendChatWithFallback).toHaveBeenCalledTimes(1);
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
});
