import { z } from "zod";
import { getAmbiguityGatekeeperGenAI } from "../gemini";
import type { AmbiguityGatekeeperConfig } from "./ambiguityGatekeeperConfig";

export interface AmbiguityGatekeeperRequest {
  userMessage: string;
  history: string[];
}

export interface AmbiguityGatekeeperProceedResult {
  decision: "proceed";
  reason: string | null;
  clarificationQuestion: null;
}

export interface AmbiguityGatekeeperClarifyResult {
  decision: "clarify";
  reason: string | null;
  clarificationQuestion: string;
}

export type AmbiguityGatekeeperResult =
  | AmbiguityGatekeeperProceedResult
  | AmbiguityGatekeeperClarifyResult;

export type RunGatekeeperModel = (prompt: string) => Promise<string>;

export interface EvaluateAmbiguityGatekeeperDependencies {
  runGatekeeperModel?: RunGatekeeperModel;
}

const MAX_HISTORY_ENTRIES = 12;
const MAX_HISTORY_TEXT_LENGTH = 500;

const ambiguityGatekeeperResponseSchema = z
  .object({
    decision: z.enum(["proceed", "clarify"]),
    reason: z.string().nullable().optional(),
    clarificationQuestion: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "clarify") {
      if (!value.clarificationQuestion || value.clarificationQuestion.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "clarificationQuestion is required when decision is clarify",
          path: ["clarificationQuestion"],
        });
      }
    }
  });

class AmbiguityGatekeeperTimeoutError extends Error {
  constructor() {
    super("Ambiguity gatekeeper timed out");
    this.name = "AmbiguityGatekeeperTimeoutError";
  }
}

class AmbiguityGatekeeperInvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguityGatekeeperInvalidOutputError";
  }
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Convert chat history into a bounded prompt block for ambiguity checks.
function renderHistory(history: string[]): string {
  if (history.length === 0) {
    return "(none)";
  }

  return history
    .slice(-MAX_HISTORY_ENTRIES)
    .map((entry, index) => {
      const text = entry.trim();
      const boundedText =
        text.length > MAX_HISTORY_TEXT_LENGTH
          ? `${text.slice(0, MAX_HISTORY_TEXT_LENGTH).trimEnd()}...`
          : text;

      return `History ${index + 1}: ${boundedText || "(empty)"}`;
    })
    .join("\n");
}

// Build the single-shot prompt that tells the model when to clarify versus proceed.
export function buildAmbiguityGatekeeperPrompt(request: AmbiguityGatekeeperRequest): string {
  return [
    "You are an ambiguity gatekeeper for a chat assistant.",
    "Decide whether the user's latest message is specific enough to proceed directly, or whether the assistant should ask exactly one targeted clarification question.",
    "Prefer proceed for exact identifiers, config paths, file names, CLI commands, and otherwise specific requests.",
    "Prefer clarify only for genuinely underspecified requests that cannot be answered well yet.",
    "Use the conversation history as supporting context when it makes a short follow-up clear.",
    "Return JSON only and do not include markdown fences or extra commentary.",
    'The JSON schema must be: {"decision":"proceed"|"clarify","reason":"short optional summary","clarificationQuestion":"single short question when decision is clarify"}',
    "If decision is clarify, clarificationQuestion is required and must be one direct question.",
    "If the output cannot be represented cleanly in that schema, the caller will fail open to proceed.",
    "",
    "Conversation history:",
    renderHistory(request.history),
    "",
    "Latest user message:",
    request.userMessage,
  ].join("\n");
}

function extractJsonObject(rawResponse: string): string {
  const fencedJsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedJsonMatch) {
    return fencedJsonMatch[1].trim();
  }

  const firstBrace = rawResponse.indexOf("{");
  const lastBrace = rawResponse.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new AmbiguityGatekeeperInvalidOutputError(
      "Ambiguity gatekeeper response did not contain a JSON object",
    );
  }

  return rawResponse.slice(firstBrace, lastBrace + 1);
}

function parseAmbiguityGatekeeperResponse(rawResponse: string): AmbiguityGatekeeperResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJsonObject(rawResponse));
  } catch (error) {
    if (error instanceof AmbiguityGatekeeperInvalidOutputError) {
      throw error;
    }

    throw new AmbiguityGatekeeperInvalidOutputError(
      "Ambiguity gatekeeper response did not contain valid JSON",
    );
  }

  const result = ambiguityGatekeeperResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new AmbiguityGatekeeperInvalidOutputError(
      "Ambiguity gatekeeper response did not match the expected schema",
    );
  }

  const reason = normalizeText(result.data.reason);

  if (result.data.decision === "clarify") {
    const clarificationQuestion = normalizeText(result.data.clarificationQuestion);

    if (!clarificationQuestion) {
      throw new AmbiguityGatekeeperInvalidOutputError(
        "Ambiguity gatekeeper clarification decision was missing a clarificationQuestion",
      );
    }

    return {
      decision: "clarify",
      reason,
      clarificationQuestion,
    };
  }

  return {
    decision: "proceed",
    reason,
    clarificationQuestion: null,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => reject(new AmbiguityGatekeeperTimeoutError()), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutHandle);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
  });
}

function createGeminiRunGatekeeperModel(config: AmbiguityGatekeeperConfig): RunGatekeeperModel {
  const genAI = getAmbiguityGatekeeperGenAI();
  const model = genAI.getGenerativeModel({ model: config.modelName }, { apiVersion: config.apiVersion });

  return async (prompt: string) => {
    const chat = model.startChat();
    const result = await chat.sendMessage(prompt);
    return result.response.text();
  };
}

// Fail open to proceed whenever the gatekeeper cannot produce a valid clarification decision.
export async function checkQueryAmbiguity(
  request: AmbiguityGatekeeperRequest,
  config: AmbiguityGatekeeperConfig,
  dependencies: EvaluateAmbiguityGatekeeperDependencies = {},
): Promise<AmbiguityGatekeeperResult> {
  if (!config.enabled) {
    return {
      decision: "proceed",
      reason: null,
      clarificationQuestion: null,
    };
  }

  const prompt = buildAmbiguityGatekeeperPrompt(request);
  const runGatekeeperModel =
    dependencies.runGatekeeperModel ?? createGeminiRunGatekeeperModel(config);

  try {
    const rawResponse = await withTimeout(runGatekeeperModel(prompt), config.timeoutMs);
    return parseAmbiguityGatekeeperResponse(rawResponse);
  } catch {
    return {
      decision: "proceed",
      reason: null,
      clarificationQuestion: null,
    };
  }
}
