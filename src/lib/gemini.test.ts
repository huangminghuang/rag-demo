import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessageMock = vi.fn();
const startChatMock = vi.fn(() => ({
  sendMessage: sendMessageMock,
}));
const getGenerativeModelMock = vi.fn(() => ({
  startChat: startChatMock,
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
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
