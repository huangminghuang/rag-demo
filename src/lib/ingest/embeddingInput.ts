import crypto from "node:crypto";
import type { EnrichmentConfig } from "./enrichmentConfig";
import type { StructureAwareChunk } from "./structureTypes";

const EMBEDDING_INPUT_VERSION = "embed-v1";
const EMBEDDING_INPUT_PREVIEW_CHARS = 240;

export interface PreparedChunkForEmbedding extends StructureAwareChunk {
  embeddingInput: string;
}

function joinList(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(", ") : undefined;
}

function getQuestionLines(values: string[] | undefined): string[] {
  return values && values.length > 0 ? values.map((value) => `- ${value}`) : [];
}

// Build the text that should be embedded for a chunk while keeping persisted content source-grounded.
export function buildChunkEmbeddingInput(chunk: StructureAwareChunk): string {
  const enrichment = chunk.metadata.enrichment;
  const isSuccessfulEnrichment = enrichment?.status === "success" && enrichment.version === "meta-v1";

  if (!isSuccessfulEnrichment) {
    return chunk.content;
  }

  const lines = [
    `Document: ${chunk.metadata.source_title}`,
    `Path: ${chunk.metadata.heading_path.join(" > ")}`,
    `Type: ${
      chunk.metadata.content_kind === "table"
        ? "Table"
        : chunk.metadata.content_kind === "code"
          ? "Code"
          : "Prose"
    }`,
    `Summary: ${enrichment.summary}`,
  ];

  if (chunk.metadata.content_kind === "table" && enrichment.table_summary) {
    lines.push(`Table Summary: ${enrichment.table_summary}`);
  }
  if (chunk.metadata.content_kind === "code" && enrichment.code_summary) {
    lines.push(`Code Summary: ${enrichment.code_summary}`);
  }

  const keywords = joinList(enrichment.keywords);
  if (keywords) {
    lines.push(`Keywords: ${keywords}`);
  }

  const topics = joinList(enrichment.topics);
  if (topics) {
    lines.push(`Topics: ${topics}`);
  }

  const entities = joinList(enrichment.entities);
  if (entities) {
    lines.push(`Entities: ${entities}`);
  }

  const apiSymbols = joinList(enrichment.api_symbols);
  if (apiSymbols) {
    lines.push(`Symbols: ${apiSymbols}`);
  }

  const questionLines = getQuestionLines(enrichment.hypothetical_questions);
  if (questionLines.length > 0) {
    lines.push("Questions:", ...questionLines);
  }

  lines.push("Content:", chunk.content);
  return lines.join("\n");
}

function getEmbeddingInputPreview(text: string): string {
  return text.slice(0, EMBEDDING_INPUT_PREVIEW_CHARS);
}

// Attach derived embedding input to chunks without replacing the persisted chunk content.
export function prepareChunksForEmbedding(
  chunks: StructureAwareChunk[],
): PreparedChunkForEmbedding[] {
  return chunks.map((chunk) => {
    const embeddingInput = buildChunkEmbeddingInput(chunk);

    return {
      ...chunk,
      embeddingInput,
      metadata: {
        ...chunk.metadata,
        embedding_input_version: EMBEDDING_INPUT_VERSION,
        embedding_input_preview: getEmbeddingInputPreview(embeddingInput),
      },
    };
  });
}

// Derive the document processing hash from parsed content and retrieval-affecting enrichment semantics.
export function deriveDocumentProcessingHash(
  parsedHash: string,
  config: EnrichmentConfig,
): string {
  const fingerprint = {
    parsedHash,
    enrichmentVersion: "meta-v1",
    embeddingInputVersion: EMBEDDING_INPUT_VERSION,
    enabledContentKinds: config.enabledContentKinds,
    minChars: config.minChars,
  };

  return crypto.createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
}
