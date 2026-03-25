import { getEnrichmentGenAI } from "@/lib/gemini";
import type { EnrichmentConfig } from "./enrichmentConfig";
import type { StructureAwareChunk } from "./structureTypes";

interface RawChunkEnrichment {
  summary?: string;
  keywords?: string[];
  hypothetical_questions?: string[];
  entities?: string[];
  topics?: string[];
  table_summary?: string;
  code_summary?: string;
  api_symbols?: string[];
}

function getProseEnrichmentPrompt(chunk: StructureAwareChunk): string {
  return [
    "You generate concise retrieval metadata for one prose documentation chunk.",
    "Return JSON only.",
    'Required fields: "summary", "keywords", "hypothetical_questions".',
    'Optional fields: "entities", "topics".',
    "Use only the provided chunk content and heading context. Do not invent facts.",
    "Keep summary to 1-2 sentences.",
    "Return keywords and hypothetical_questions as arrays of strings.",
    "",
    `Title: ${chunk.metadata.source_title}`,
    `Path: ${chunk.metadata.heading_path.join(" > ")}`,
    `Content kind: ${chunk.metadata.content_kind}`,
    "Chunk:",
    chunk.content,
  ].join("\n");
}

function getTableEnrichmentPrompt(chunk: StructureAwareChunk): string {
  return [
    "You generate concise retrieval metadata for one documentation table chunk.",
    "Return JSON only.",
    'Required fields: "summary", "keywords", "hypothetical_questions", "table_summary".',
    'Optional fields: "entities", "topics".',
    "Use only the provided table content and heading context. Do not invent facts.",
    "Keep summary concise.",
    "Use table_summary to explain the main comparison or takeaway from the table.",
    "",
    `Title: ${chunk.metadata.source_title}`,
    `Path: ${chunk.metadata.heading_path.join(" > ")}`,
    `Content kind: ${chunk.metadata.content_kind}`,
    "Table chunk:",
    chunk.content,
  ].join("\n");
}

function getCodeEnrichmentPrompt(chunk: StructureAwareChunk): string {
  return [
    "You generate concise retrieval metadata for one documentation code chunk.",
    "Return JSON only.",
    'Required fields: "summary", "keywords", "hypothetical_questions".',
    'At least one of these is also required: "code_summary" or "api_symbols".',
    'Optional fields: "entities", "topics".',
    "Use only the provided code content and heading context. Do not invent facts.",
    "Keep summary concise.",
    "Use code_summary to explain the purpose of the code example.",
    "Use api_symbols for the main functions, classes, or methods shown in the code.",
    "",
    `Title: ${chunk.metadata.source_title}`,
    `Path: ${chunk.metadata.heading_path.join(" > ")}`,
    `Content kind: ${chunk.metadata.content_kind}`,
    "Code chunk:",
    chunk.content,
  ].join("\n");
}

// Ask Gemini for chunk enrichment metadata using the configured enrichment model profile.
export async function enrichChunkWithModel(
  chunk: StructureAwareChunk,
  config: EnrichmentConfig,
): Promise<RawChunkEnrichment> {
  const model = getEnrichmentGenAI().getGenerativeModel(
    { model: config.modelProfile.model },
    { apiVersion: config.modelProfile.apiVersion },
  );

  const prompt = chunk.metadata.content_kind === "table"
    ? getTableEnrichmentPrompt(chunk)
    : chunk.metadata.content_kind === "code"
      ? getCodeEnrichmentPrompt(chunk)
      : getProseEnrichmentPrompt(chunk);
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  return JSON.parse(text) as RawChunkEnrichment;
}
