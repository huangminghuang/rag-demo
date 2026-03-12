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

function isModelNotFoundError(error: unknown): boolean {
  if (!error) return false;
  const errString = String(error).toLowerCase();
  const message = (error as any)?.message?.toLowerCase() || "";
  
  const is404 = (error as any)?.status === 404 || (error as any)?.statusCode === 404;
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
