import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessageMock = vi.fn();
const startChatMock = vi.fn(() => ({
  sendMessage: sendMessageMock,
}));
const getGenerativeModelMock = vi.fn(() => ({
  startChat: startChatMock,
}));
const googleGenerativeAIConstructorMock = vi.fn();

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    constructor(apiKey: string) {
      googleGenerativeAIConstructorMock(apiKey);
    }

    getGenerativeModel = getGenerativeModelMock;
  },
}));

const ORIGINAL_ENV = { ...process.env };

async function loadModule() {
  vi.resetModules();
  return import("./gemini");
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    GEMINI_API_KEY: "test-api-key",
    QUERY_MODEL_NAME: "test-model",
    QUERY_MODEL_FALLBACKS: "",
  };

  sendMessageMock.mockResolvedValue({
    response: {
      text: () => "mock response",
    },
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  sendMessageMock.mockReset();
  startChatMock.mockClear();
  getGenerativeModelMock.mockClear();
  googleGenerativeAIConstructorMock.mockClear();
});

describe("sendChatWithFallback", () => {
  it("does not log prompt payload when verbose debug mode is disabled", async () => {
    delete process.env.REASONING_VERBOSE_DEBUG;
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { sendChatWithFallback } = await loadModule();

    await sendChatWithFallback({
      history: [],
      systemPrompt: "system prompt",
      userMessage: "user prompt",
    });

    expect(consoleInfoSpy).not.toHaveBeenCalledWith(
      "[reasoning-debug]",
      expect.anything()
    );
  });

  it("logs prompt payload when verbose debug mode is enabled", async () => {
    process.env.REASONING_VERBOSE_DEBUG = "true";
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { sendChatWithFallback } = await loadModule();

    await sendChatWithFallback({
      history: [],
      systemPrompt: "system prompt",
      userMessage: "user prompt",
    });

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[reasoning-debug]",
      expect.any(Object)
    );
  });

  it("includes the system prompt and user prompt in the debug payload", async () => {
    process.env.REASONING_VERBOSE_DEBUG = "true";
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { sendChatWithFallback } = await loadModule();

    await sendChatWithFallback({
      history: [],
      systemPrompt: "You are a helpful assistant.",
      userMessage: "Explain Vite config loading.",
    });

    expect(consoleInfoSpy).toHaveBeenCalledWith("[reasoning-debug]", {
      model: "test-model",
      systemPrompt: "You are a helpful assistant.",
      userPrompt: "Explain Vite config loading.",
    });
  });
});

describe("getEnrichmentApiKey", () => {
  it("uses ENRICH_MODEL_API_KEY when it is configured", async () => {
    process.env.ENRICH_MODEL_API_KEY = "enrich-key";

    const { getEnrichmentApiKey } = await loadModule();

    expect(getEnrichmentApiKey()).toBe("enrich-key");
  });

  it("falls back to GEMINI_API_KEY when ENRICH_MODEL_API_KEY is not configured", async () => {
    delete process.env.ENRICH_MODEL_API_KEY;

    const { getEnrichmentApiKey } = await loadModule();

    expect(getEnrichmentApiKey()).toBe("test-api-key");
  });
});

describe("getQueryRewriteApiKey", () => {
  it("uses QUERY_REWRITE_API_KEY when it is configured", async () => {
    process.env.QUERY_REWRITE_API_KEY = "rewrite-key";

    const { getQueryRewriteApiKey } = await loadModule();

    expect(getQueryRewriteApiKey()).toBe("rewrite-key");
  });

  it("falls back to GEMINI_API_KEY when QUERY_REWRITE_API_KEY is not configured", async () => {
    delete process.env.QUERY_REWRITE_API_KEY;

    const { getQueryRewriteApiKey } = await loadModule();

    expect(getQueryRewriteApiKey()).toBe("test-api-key");
  });
});

describe("getAmbiguityGatekeeperApiKey", () => {
  it("uses AMBIGUITY_GATEKEEPER_API_KEY when it is configured", async () => {
    process.env.AMBIGUITY_GATEKEEPER_API_KEY = "gatekeeper-key";

    const { getAmbiguityGatekeeperApiKey } = await loadModule();

    expect(getAmbiguityGatekeeperApiKey()).toBe("gatekeeper-key");
  });

  it("falls back to GEMINI_API_KEY when AMBIGUITY_GATEKEEPER_API_KEY is not configured", async () => {
    delete process.env.AMBIGUITY_GATEKEEPER_API_KEY;

    const { getAmbiguityGatekeeperApiKey } = await loadModule();

    expect(getAmbiguityGatekeeperApiKey()).toBe("test-api-key");
  });

  it("throws when neither AMBIGUITY_GATEKEEPER_API_KEY nor GEMINI_API_KEY is configured", async () => {
    delete process.env.AMBIGUITY_GATEKEEPER_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const { getAmbiguityGatekeeperApiKey } = await loadModule();

    expect(() => getAmbiguityGatekeeperApiKey()).toThrow(
      "AMBIGUITY_GATEKEEPER_API_KEY or GEMINI_API_KEY must be defined in the environment variables.",
    );
  });

  it("loads and creates the dedicated client when only AMBIGUITY_GATEKEEPER_API_KEY is configured", async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.AMBIGUITY_GATEKEEPER_API_KEY = "gatekeeper-key";

    const { getAmbiguityGatekeeperApiKey, getAmbiguityGatekeeperGenAI } = await loadModule();

    expect(getAmbiguityGatekeeperApiKey()).toBe("gatekeeper-key");

    getAmbiguityGatekeeperGenAI();

    expect(googleGenerativeAIConstructorMock).toHaveBeenCalledWith("gatekeeper-key");
  });
});
