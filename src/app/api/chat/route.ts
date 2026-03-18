import { NextResponse } from "next/server";
import { sendChatWithFallback } from "@/lib/gemini";
import { retrieveRelevantChunks } from "@/lib/retrieve";
import { consumeQueryQuota, estimateQueryTokens, getQueryQuotaConfig } from "@/lib/quota/queryQuota";
import { isEmbeddingQuotaExceededError } from "@/lib/quota/embeddingQuota";
import { getChatRetrieveThreshold } from "@/lib/retrieve/config";
import { requireUser } from "@/lib/auth/guards";
import { requireCsrf } from "@/lib/auth/csrf";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface SourceItem {
  number: number;
  title: string | null;
  url: string;
}

function extractCitedSourceIndexes(text: string): number[] {
  const cited = new Set<number>();
  const matches = text.matchAll(/\[([0-9,\s]+)\]/g);

  for (const match of matches) {
    const raw = match[1];
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const n = Number.parseInt(part, 10);
      if (!Number.isNaN(n) && n > 0) {
        cited.add(n);
      }
    }
  }

  return [...cited].sort((a, b) => a - b);
}

function stripReferencesSection(text: string): string {
  return text
    .replace(/\n+\*\*References:\*\*[\s\S]*$/i, "")
    .replace(/\n+References:\s*[\s\S]*$/i, "")
    .trim();
}

function isFallbackResponse(text: string): boolean {
  return text.toLowerCase().includes("i don't know based on the indexed vite documentation");
}

export async function POST(req: Request) {
  try {
    const csrfError = requireCsrf(req);
    if (csrfError) return csrfError;

    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { messages }: { messages?: ChatMessage[] } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Messages are required" }, { status: 400 });
    }

    const userMessage = messages[messages.length - 1]?.content;
    if (!userMessage || typeof userMessage !== "string") {
      return NextResponse.json({ error: "Last message must be a user message with content" }, { status: 400 });
    }

    // 1. Retrieve relevant chunks as context
    const relevantChunks = await retrieveRelevantChunks(userMessage, {
      limit: 5,
      threshold: getChatRetrieveThreshold(),
    });

    // 2. Build the context string
    const context = relevantChunks.length > 0 
      ? relevantChunks.map((c, i) => `[Source ${i+1}] (${c.url}):\n${c.content}`).join("\n\n---\n\n")
      : "No relevant documentation found.";

    // 3. Construct the grounded prompt
    const systemPrompt = `You are a helpful assistant for Vite developers.
Your goal is to answer questions using ONLY the provided documentation context below.
If the answer is not in the context, clearly say "I don't know based on the indexed Vite documentation."
Do not use your own knowledge to supplement the documentation.
ALWAYS cite your sources by using the source numbers in brackets, like [1] or [1, 2].

DOCUMENTATION CONTEXT:
${context}
`;

    // Gemini requires conversation history to start with a user message.
    const rawHistory = messages
      .slice(0, -1)
      .map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: String(m.content ?? "").trim() }],
      }))
      .filter((m) => m.parts[0].text.length > 0);

    const firstUserIndex = rawHistory.findIndex((m) => m.role === "user");
    const history = firstUserIndex === -1 ? [] : rawHistory.slice(firstUserIndex);

    const inputTextsForEstimate = [
      systemPrompt,
      userMessage,
      ...history.map((h) => h.parts[0].text),
    ];
    const estimatedInputTokens = estimateQueryTokens(inputTextsForEstimate);
    const quotaResult = consumeQueryQuota(estimatedInputTokens);

    if (!quotaResult.allowed) {
      const config = getQueryQuotaConfig();
      const response = NextResponse.json(
        {
          error: quotaResult.message || "Query quota exceeded.",
          reason: quotaResult.reason,
          limits: {
            rpm: config.rpm,
            tpm: config.tpm,
            rpd: config.rpd,
          },
          retryAfterSeconds: quotaResult.retryAfterSeconds,
        },
        { status: 429 }
      );

      if (quotaResult.retryAfterSeconds) {
        response.headers.set("Retry-After", String(quotaResult.retryAfterSeconds));
      }

      return response;
    }

    // 4. Generate response using Gemini (with model fallback)
    const result = await sendChatWithFallback({
      history,
      systemPrompt,
      userMessage,
    });

    const citedIndexes = extractCitedSourceIndexes(result.text);
    const citedSources: SourceItem[] = citedIndexes
      .map((idx) => relevantChunks[idx - 1])
      .filter((chunk): chunk is (typeof relevantChunks)[number] => Boolean(chunk))
      .map((chunk, listIndex) => ({
        number: citedIndexes[listIndex],
        title: chunk.title,
        url: chunk.url,
      }));

    const fallbackSources: SourceItem[] =
      citedSources.length > 0
        ? citedSources
        : relevantChunks.map((chunk, idx) => ({ number: idx + 1, title: chunk.title, url: chunk.url }));

    const sources = citedSources.length > 0
      ? citedSources
      : fallbackSources.filter((source, index, all) => {
          return all.findIndex((candidate) => candidate.url === source.url) === index;
        });

    const content = stripReferencesSection(result.text);
    const finalSources = isFallbackResponse(content) ? [] : sources;

    return NextResponse.json({ 
      content,
      sources: finalSources
    });
  } catch (error) {
    if (isEmbeddingQuotaExceededError(error)) {
      const response = NextResponse.json(
        {
          error: error.message,
          reason: error.reason,
          limits: error.limits,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        { status: 429 }
      );
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
      return response;
    }

    console.error("Chat error:", error);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
