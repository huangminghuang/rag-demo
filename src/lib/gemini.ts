import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content } from "@google/generative-ai";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not defined in the environment variables.");
}

const queryModelName = process.env.QUERY_MODEL_NAME || "gemini-3.1-flash-lite-preview";
const embeddingModelName = process.env.EMBED_MODEL_NAME || "gemini-embedding-001";
const queryModelFallbacks = (process.env.QUERY_MODEL_FALLBACKS || "gemini-2.5-flash")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const queryApiVersion = process.env.QUERY_MODEL_API_VERSION || "v1beta";

export const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const embeddingModel = genAI.getGenerativeModel({ model: embeddingModelName }, { apiVersion: "v1beta" });
export { queryModelName, embeddingModelName };

// Resolve the API key for enrichment-model requests, falling back to the shared Gemini key.
export function getEnrichmentApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.ENRICH_MODEL_API_KEY || env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ENRICH_MODEL_API_KEY or GEMINI_API_KEY must be defined in the environment variables.");
  }

  return apiKey;
}

// Create a Gemini client for enrichment requests so they can use a dedicated API key when configured.
export function getEnrichmentGenAI(env: NodeJS.ProcessEnv = process.env): GoogleGenerativeAI {
  return new GoogleGenerativeAI(getEnrichmentApiKey(env));
}

// Resolve the API key for query-rewrite requests, falling back to the shared Gemini key.
export function getQueryRewriteApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.QUERY_REWRITE_API_KEY || env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("QUERY_REWRITE_API_KEY or GEMINI_API_KEY must be defined in the environment variables.");
  }

  return apiKey;
}

// Create a Gemini client for query-rewrite requests so they can use a dedicated API key when configured.
export function getQueryRewriteGenAI(env: NodeJS.ProcessEnv = process.env): GoogleGenerativeAI {
  return new GoogleGenerativeAI(getQueryRewriteApiKey(env));
}

// Check whether verbose reasoning-model prompt logging is enabled for this request.
function isReasoningVerboseDebugEnabled(): boolean {
  return process.env.REASONING_VERBOSE_DEBUG === "true";
}

// Print the reasoning-model prompt payload before sending it to Gemini when debug mode is enabled.
function logReasoningPromptPayload(params: {
  modelName: string;
  systemPrompt: string;
  userMessage: string;
}): void {
  if (!isReasoningVerboseDebugEnabled()) {
    return;
  }

  try {
    console.info("[reasoning-debug]", {
      model: params.modelName,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userMessage,
    });
  } catch {
    // Prompt logging must never interfere with the model request path.
  }
}

function isModelNotFoundError(error: unknown): boolean {
  if (!error) return false;
  const errString = String(error).toLowerCase();
  const errorLike = error as {
    message?: string;
    status?: number;
    statusCode?: number;
  };
  const message = errorLike.message?.toLowerCase() || "";

  const is404 = errorLike.status === 404 || errorLike.statusCode === 404;
  const hasNotFoundText = errString.includes("not found") || 
                          message.includes("not found") || 
                          errString.includes("is not supported for generatecontent") ||
                          message.includes("is not supported for generatecontent");

  return is404 || hasNotFoundText;
}

function getQueryModelCandidates(): string[] {
  return [queryModelName, ...queryModelFallbacks].filter((value, index, all) => all.indexOf(value) === index);
}

export async function sendChatWithFallback(params: {
  history: Content[];
  systemPrompt: string;
  userMessage: string;
}): Promise<{ text: string; model: string }> {
  const modelCandidates = getQueryModelCandidates();
  let lastError: unknown;

  for (const modelName of modelCandidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: queryApiVersion });
      const chat = model.startChat({
        history: params.history,
      });
      logReasoningPromptPayload({
        modelName,
        systemPrompt: params.systemPrompt,
        userMessage: params.userMessage,
      });
      const result = await chat.sendMessage([{ text: params.systemPrompt }, { text: params.userMessage }]);
      return { text: result.response.text(), model: modelName };
    } catch (error) {
      lastError = error;
      if (isModelNotFoundError(error)) {
        console.warn(`Query model unavailable: ${modelName}. Trying fallback model...`);
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
