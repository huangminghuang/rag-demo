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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("users_email_idx").on(table.email),
  index("users_role_idx").on(table.role),
]);

export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("oauth_provider_account_idx").on(table.provider, table.providerAccountId),
  index("oauth_user_id_idx").on(table.userId),
]);

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  sessionToken: text("session_token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("auth_session_token_idx").on(table.sessionToken),
  index("auth_session_user_id_idx").on(table.userId),
  index("auth_session_expires_idx").on(table.expiresAt),
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  title: text("title"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("conversations_user_id_idx").on(table.userId),
]);

export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("conversation_messages_conversation_id_idx").on(table.conversationId),
  index("conversation_messages_user_id_idx").on(table.userId),
  index("conversation_messages_created_at_idx").on(table.createdAt),
]);

export const usersRelations = relations(users, ({ many }) => ({
  oauthAccounts: many(oauthAccounts),
  authSessions: many(authSessions),
  conversations: many(conversations),
  messages: many(conversationMessages),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, {
    fields: [oauthAccounts.userId],
    references: [users.id],
  }),
}));

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, {
    fields: [authSessions.userId],
    references: [users.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(conversationMessages),
}));

export const conversationMessagesRelations = relations(conversationMessages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationMessages.conversationId],
    references: [conversations.id],
  }),
  user: one(users, {
    fields: [conversationMessages.userId],
    references: [users.id],
  }),
}));
