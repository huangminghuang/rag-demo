import { pgTable, text, timestamp, uuid, integer, jsonb, halfvec, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

const EMBEDDING_DIMENSIONS = 3072;

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull().unique(),
  title: text("title"),
  lang: text("lang"),
  product: text("product"),
  contentHash: text("content_hash"),
  updatedAt: timestamp("updated_at"),
  lastCrawledAt: timestamp("last_crawled_at").defaultNow(),
}, (table) => [
  uniqueIndex("url_idx").on(table.url),
  index("lang_idx").on(table.lang),
  index("product_idx").on(table.product),
]);

export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count"),
  embedding: halfvec("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
  anchor: text("anchor"),
  metadata: jsonb("metadata"),
}, (table) => [
  index("document_id_idx").on(table.documentId),
  index("embedding_idx").using("hnsw", table.embedding.op("halfvec_cosine_ops")),
]);

export const documentsRelations = relations(documents, ({ many }) => ({
  chunks: many(chunks),
}));

export const chunksRelations = relations(chunks, ({ one }) => ({
  document: one(documents, {
    fields: [chunks.documentId],
    references: [documents.id],
  }),
}));
