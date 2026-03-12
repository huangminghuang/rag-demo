import { embeddingModelName, genAI } from "@/lib/gemini";
import { TaskType } from "@google/generative-ai";
import { enforceEmbeddingQuota, estimateEmbeddingTokens } from "@/lib/quota/embeddingQuota";

export const EMBEDDING_DIMENSIONS = 3072;
const EMBED_API_MAX_RETRIES = Number.parseInt(process.env.EMBED_API_MAX_RETRIES || "2", 10);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelaySeconds(value: string): number | null {
  const match = value.match(/^(\d+)(?:\.\d+)?s$/);
  if (!match) return null;
  const seconds = Number.parseInt(match[1], 10);
  return Number.isNaN(seconds) ? null : seconds;
}

function getRateLimitRetrySeconds(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = "status" in error ? (error.status as number | undefined) : undefined;
  if (status !== 429) return null;

  const details = "errorDetails" in error ? (error.errorDetails as unknown[] | undefined) : undefined;
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue;
      const detailType = "@type" in detail ? String(detail["@type"]) : "";
      if (!detailType.includes("RetryInfo")) continue;
      const retryDelay = "retryDelay" in detail ? String(detail.retryDelay) : "";
      const parsed = parseRetryDelaySeconds(retryDelay);
      if (parsed !== null) return parsed;
    }
  }

  return 60;
}

/**
 * Generate an embedding for a piece of text (usually for search queries).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const models = [embeddingModelName];
  let lastError;
  enforceEmbeddingQuota(estimateEmbeddingTokens([text]));

  for (const modelName of models) {
    for (let attempt = 0; attempt <= EMBED_API_MAX_RETRIES; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: "v1beta" });
        const result = await model.embedContent({
          content: { role: "user", parts: [{ text }] },
          taskType: TaskType.RETRIEVAL_QUERY,
        });
        return result.embedding.values;
      } catch (error) {
        lastError = error;
        const retrySeconds = getRateLimitRetrySeconds(error);
        if (retrySeconds !== null && attempt < EMBED_API_MAX_RETRIES) {
          const waitSeconds = retrySeconds + 1;
          console.warn(
            `Embedding rate-limited for ${modelName}. Retrying in ${waitSeconds}s (attempt ${attempt + 1}/${EMBED_API_MAX_RETRIES}).`
          );
          await sleep(waitSeconds * 1000);
          continue;
        }

        if (retrySeconds === null) {
          const hasNextModel = models.indexOf(modelName) < models.length - 1;
          if (hasNextModel) {
            console.warn(`Single embedding with ${modelName} failed, trying next model...`);
          }
        }
        break;
      }
    }
  }
  
  throw lastError;
}

/**
 * Generate embeddings for multiple pieces of text (usually for indexing documents).
 */
export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const models = [embeddingModelName];
  let lastError;
  enforceEmbeddingQuota(estimateEmbeddingTokens(texts));

  for (const modelName of models) {
    for (let attempt = 0; attempt <= EMBED_API_MAX_RETRIES; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: "v1beta" });
        const result = await model.batchEmbedContents({
          requests: texts.map(text => ({
            content: { role: "user", parts: [{ text }] },
            taskType: TaskType.RETRIEVAL_DOCUMENT,
          }))
        });
        return result.embeddings.map((e) => e.values);
      } catch (error) {
        lastError = error;
        const retrySeconds = getRateLimitRetrySeconds(error);
        if (retrySeconds !== null && attempt < EMBED_API_MAX_RETRIES) {
          const waitSeconds = retrySeconds + 1;
          console.warn(
            `Batch embedding rate-limited for ${modelName}. Retrying in ${waitSeconds}s (attempt ${attempt + 1}/${EMBED_API_MAX_RETRIES}).`
          );
          await sleep(waitSeconds * 1000);
          continue;
        }

        // Do not degrade into per-item fallback after rate-limit failures.
        if (retrySeconds !== null) {
          throw error;
        }

        const hasNextModel = models.indexOf(modelName) < models.length - 1;
        if (hasNextModel) {
          console.warn(`Batch embedding with ${modelName} failed, trying next model...`);
        }
        break;
      }
    }
  }

  // Final fallback: process one by one if batching is failing
  console.warn("Batching failed, attempting individual embeddings...");
  try {
    const results = [];
    for (const text of texts) {
      const embedding = await generateEmbedding(text);
      results.push(embedding);
    }
    return results;
  } catch {
    console.error("All embedding attempts failed.");
    throw lastError;
  }
}
