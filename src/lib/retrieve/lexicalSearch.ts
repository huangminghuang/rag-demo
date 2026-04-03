import { db } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export interface LexicalSearchResult {
  chunkId: string;
  content: string;
  url: string;
  title: string | null;
  anchor: string | null;
  similarity: number;
}

export interface LexicalSearchOptions {
  limit: number;
  trigramThreshold: number;
}

interface RawLexicalSearchRow {
  chunkId: string;
  content: string;
  url: string;
  title: string | null;
  anchor: string | null;
  ftsScore: number;
  trigramScore: number;
}

interface SearchChunksLexicallyDependencies {
  executeLexicalSearch?: (
    query: string,
    options: LexicalSearchOptions,
  ) => Promise<RawLexicalSearchRow[]>;
}

const FTS_SCORE_WEIGHT = 0.7;
const TRIGRAM_SCORE_WEIGHT = 0.3;

// Keep only rows with meaningful lexical evidence after the database query.
export function isLexicalMatchCandidate(
  row: Pick<RawLexicalSearchRow, "ftsScore" | "trigramScore">,
  trigramThreshold: number,
): boolean {
  return row.ftsScore > 0 || row.trigramScore > trigramThreshold;
}

// Combine FTS and trigram signals into one lexical score for branch ordering.
export function combineLexicalScores(
  row: Pick<RawLexicalSearchRow, "ftsScore" | "trigramScore">,
): number {
  return row.ftsScore * FTS_SCORE_WEIGHT + row.trigramScore * TRIGRAM_SCORE_WEIGHT;
}

// Normalize lexical rows into the retrieval result shape used by later fusion.
export function rankLexicalSearchRows(
  rows: RawLexicalSearchRow[],
  options: LexicalSearchOptions,
): LexicalSearchResult[] {
  return rows
    .filter((row) => isLexicalMatchCandidate(row, options.trigramThreshold))
    .map((row) => ({
      chunkId: row.chunkId,
      content: row.content,
      url: row.anchor ? `${row.url}#${row.anchor}` : row.url,
      title: row.title,
      anchor: row.anchor,
      similarity: combineLexicalScores(row),
    }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, options.limit);
}

async function executeLexicalSearchQuery(
  query: string,
  options: LexicalSearchOptions,
): Promise<RawLexicalSearchRow[]> {
  const tsVector = sql`to_tsvector('english', ${chunks.content})`;
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`;
  const ftsScore = sql<number>`ts_rank_cd(${tsVector}, ${tsQuery})`;
  const trigramScore = sql<number>`similarity(${chunks.content}, ${query})`;
  const lexicalScore =
    sql<number>`(${ftsScore} * ${FTS_SCORE_WEIGHT}) + (${trigramScore} * ${TRIGRAM_SCORE_WEIGHT})`;

  return db
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      anchor: chunks.anchor,
      url: documents.url,
      title: documents.title,
      ftsScore,
      trigramScore,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(sql`(${tsVector} @@ ${tsQuery}) OR (${trigramScore} > ${options.trigramThreshold})`)
    .orderBy(desc(lexicalScore))
    .limit(options.limit);
}

export async function searchChunksLexically(
  query: string,
  options: LexicalSearchOptions,
  dependencies: SearchChunksLexicallyDependencies = {},
): Promise<LexicalSearchResult[]> {
  const executeLexicalSearch = dependencies.executeLexicalSearch ?? executeLexicalSearchQuery;
  const rows = await executeLexicalSearch(query, options);
  return rankLexicalSearchRows(rows, options);
}
