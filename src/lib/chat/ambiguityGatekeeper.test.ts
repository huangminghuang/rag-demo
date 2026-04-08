import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAmbiguityGatekeeperConfig } from "./ambiguityGatekeeperConfig";

const ORIGINAL_ENV = { ...process.env };

const {
  sendMessageMock,
  startChatMock,
  getGenerativeModelMock,
  getAmbiguityGatekeeperGenAIMock,
} = vi.hoisted(() => {
  const sendMessageMock = vi.fn();
  const startChatMock = vi.fn(() => ({
    sendMessage: sendMessageMock,
  }));
  const getGenerativeModelMock = vi.fn(() => ({
    startChat: startChatMock,
  }));
  const getAmbiguityGatekeeperGenAIMock = vi.fn(() => ({
    getGenerativeModel: getGenerativeModelMock,
  }));

  return {
    sendMessageMock,
    startChatMock,
    getGenerativeModelMock,
    getAmbiguityGatekeeperGenAIMock,
  };
});

vi.mock("../gemini", () => ({
  getAmbiguityGatekeeperGenAI: getAmbiguityGatekeeperGenAIMock,
}));

const runGatekeeperModelMock = vi.fn();

function gatekeeperConfig() {
  return resolveAmbiguityGatekeeperConfig({
    AMBIGUITY_GATEKEEPER_ENABLED: "true",
    AMBIGUITY_GATEKEEPER_TIMEOUT_MS: "2000",
  } as unknown as NodeJS.ProcessEnv);
}

function makeHistory(): string[] {
  return [
    "Earlier context about deployment",
    "The assistant answered with a general overview.",
  ];
}

async function loadModule() {
  vi.resetModules();
  return import("./ambiguityGatekeeper");
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    GEMINI_API_KEY: "test-api-key",
  };
  runGatekeeperModelMock.mockReset();
  sendMessageMock.mockReset();
  startChatMock.mockReset();
  getGenerativeModelMock.mockReset();
  getAmbiguityGatekeeperGenAIMock.mockReset();
  startChatMock.mockImplementation(() => ({
    sendMessage: sendMessageMock,
  }));
  getGenerativeModelMock.mockImplementation(() => ({
    startChat: startChatMock,
  }));
  getAmbiguityGatekeeperGenAIMock.mockImplementation(() => ({
    getGenerativeModel: getGenerativeModelMock,
  }));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("evaluateAmbiguityGatekeeper", () => {
  it("asks one targeted clarification question for ambiguous requests", async () => {
    runGatekeeperModelMock.mockResolvedValue(`{
      "decision":"clarify",
      "reason":"The request does not specify what aspect of the deployment is blocked.",
      "clarificationQuestion":"Which part of the deployment workflow is failing?"
    }`);

    const { checkQueryAmbiguity } = await loadModule();
    const result = await checkQueryAmbiguity(
      {
        userMessage: "It's not working, what should I do?",
        history: makeHistory(),
      },
      gatekeeperConfig(),
      { runGatekeeperModel: runGatekeeperModelMock },
    );

    expect(result).toEqual({
      decision: "clarify",
      reason: "The request does not specify what aspect of the deployment is blocked.",
      clarificationQuestion: "Which part of the deployment workflow is failing?",
    });
    expect(runGatekeeperModelMock.mock.calls[0][0]).toContain(
      "Earlier context about deployment",
    );
    expect(runGatekeeperModelMock.mock.calls[0][0]).toContain(
      "It's not working, what should I do?",
    );
    expect(runGatekeeperModelMock).toHaveBeenCalledTimes(1);
  });

  it("proceeds for specific requests", async () => {
    runGatekeeperModelMock.mockResolvedValue(`{
      "decision":"proceed",
      "reason":"The request names an exact config path."
    }`);

    const { checkQueryAmbiguity } = await loadModule();
    const result = await checkQueryAmbiguity(
      {
        userMessage: "How do I set server.proxy in vite.config.ts?",
        history: [],
      },
      gatekeeperConfig(),
      { runGatekeeperModel: runGatekeeperModelMock },
    );

    expect(result).toEqual({
      decision: "proceed",
      reason: "The request names an exact config path.",
      clarificationQuestion: null,
    });
  });

  it("proceeds for exact identifier-style requests", async () => {
    runGatekeeperModelMock.mockResolvedValue(`{
      "decision":"proceed",
      "reason":"The request names an exact identifier and file path."
    }`);

    const { checkQueryAmbiguity } = await loadModule();
    const result = await checkQueryAmbiguity(
      {
        userMessage: "How do I use `server.proxy` in `vite.config.ts`?",
        history: [],
      },
      gatekeeperConfig(),
      { runGatekeeperModel: runGatekeeperModelMock },
    );

    expect(result).toEqual({
      decision: "proceed",
      reason: "The request names an exact identifier and file path.",
      clarificationQuestion: null,
    });
  });

  it("proceeds for CLI commands", async () => {
    runGatekeeperModelMock.mockResolvedValue(`{
      "decision":"proceed",
      "reason":"The request names an exact CLI command."
    }`);

    const { checkQueryAmbiguity } = await loadModule();
    const result = await checkQueryAmbiguity(
      {
        userMessage: "vite build",
        history: [],
      },
      gatekeeperConfig(),
      { runGatekeeperModel: runGatekeeperModelMock },
    );

    expect(result).toEqual({
      decision: "proceed",
      reason: "The request names an exact CLI command.",
      clarificationQuestion: null,
    });
    expect(runGatekeeperModelMock.mock.calls[0][0]).toContain(
      "Prefer proceed for exact identifiers, config paths, file names, CLI commands, and otherwise specific requests.",
    );
    expect(runGatekeeperModelMock.mock.calls[0][0]).toContain("vite build");
  });

  it("uses retained history to clear up a short follow-up question", async () => {
    runGatekeeperModelMock.mockResolvedValue(`{
      "decision":"proceed",
      "reason":"The recent conversation makes the follow-up specific enough."
    }`);

    const { checkQueryAmbiguity } = await loadModule();
    const result = await checkQueryAmbiguity(
      {
        userMessage: "What about SSR?",
        history: [
          "Earlier context about deployment",
          "The assistant answered with a general overview.",
          "We were discussing Vite config and client/server behavior.",
        ],
      },
      gatekeeperConfig(),
      { runGatekeeperModel: runGatekeeperModelMock },
    );

    expect(result).toEqual({
      decision: "proceed",
      reason: "The recent conversation makes the follow-up specific enough.",
      clarificationQuestion: null,
    });
  });

  it("fails open to proceed when the model output is malformed", async () => {
    runGatekeeperModelMock.mockResolvedValue("not json at all");

    const { checkQueryAmbiguity } = await loadModule();
    const result = await checkQueryAmbiguity(
      {
        userMessage: "What should I do next?",
        history: [],
      },
      gatekeeperConfig(),
      { runGatekeeperModel: runGatekeeperModelMock },
    );

    expect(result).toEqual({
      decision: "proceed",
      reason: null,
      clarificationQuestion: null,
    });
  });

  it("returns proceed without calling the model when disabled", async () => {
    const { checkQueryAmbiguity } = await loadModule();
    const result = await checkQueryAmbiguity(
      {
        userMessage: "What should I do next?",
        history: ["Earlier context about deployment"],
      },
      resolveAmbiguityGatekeeperConfig({
        AMBIGUITY_GATEKEEPER_ENABLED: "false",
      } as unknown as NodeJS.ProcessEnv),
      { runGatekeeperModel: runGatekeeperModelMock },
    );

    expect(result).toEqual({
      decision: "proceed",
      reason: null,
      clarificationQuestion: null,
    });
    expect(runGatekeeperModelMock).not.toHaveBeenCalled();
  });

  it("fails open to proceed when the model times out", async () => {
    const { checkQueryAmbiguity } = await loadModule();
    const result = await checkQueryAmbiguity(
      {
        userMessage: "What should I do next?",
        history: [],
      },
      resolveAmbiguityGatekeeperConfig({
        AMBIGUITY_GATEKEEPER_ENABLED: "true",
        AMBIGUITY_GATEKEEPER_TIMEOUT_MS: "1",
      } as unknown as NodeJS.ProcessEnv),
      {
        runGatekeeperModel: () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve(`{"decision":"proceed"}`), 25);
          }),
      },
    );

    expect(result).toEqual({
      decision: "proceed",
      reason: null,
      clarificationQuestion: null,
    });
  });

  it("uses the Gemini fallback without injecting request history into chat start", async () => {
    sendMessageMock.mockResolvedValue({
      response: {
        text: () => `{"decision":"proceed","reason":"ok"}`,
      },
    });
    const config = gatekeeperConfig();

    const { checkQueryAmbiguity } = await loadModule();
    const result = await checkQueryAmbiguity(
      {
        userMessage: "How do I set server.proxy in vite.config.ts?",
        history: [
          "Earlier context about deployment",
          "The assistant answered with a general overview.",
        ],
      },
      config,
    );

    expect(result).toEqual({
      decision: "proceed",
      reason: "ok",
      clarificationQuestion: null,
    });
    expect(getAmbiguityGatekeeperGenAIMock).toHaveBeenCalledTimes(1);
    expect(getGenerativeModelMock).toHaveBeenCalledWith(
      { model: config.modelName },
      { apiVersion: config.apiVersion },
    );
    expect(startChatMock).toHaveBeenCalledTimes(1);
    expect(startChatMock.mock.calls[0]).toEqual([]);
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("Earlier context about deployment"),
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("How do I set server.proxy in vite.config.ts?"),
    );
  });
});
