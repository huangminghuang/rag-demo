import { db } from "@/lib/db";
import { documents, chunks } from "@/lib/db/schema";
import { getSitemapUrls } from "./sitemap";
import { fetchPage, parseHTMLToStructuredDocument } from "./parser";
import { chunkStructuredDocument } from "./structureChunker";
import { planChunkEnrichment, resolveEnrichmentConfig } from "./enrichmentConfig";
import { enrichChunksForIngestion } from "./enrichment";
import { enrichChunkWithModel } from "./enrichmentModel";
import { deriveDocumentProcessingHash, prepareChunksForEmbedding } from "./embeddingInput";
import { generateBatchEmbeddings } from "./embeddings";
import { eq } from "drizzle-orm";
import { isEmbeddingQuotaExceededError } from "@/lib/quota/embeddingQuota";

function getEmbedBatchSize(): number {
  const raw = process.env.EMBED_BATCH_SIZE;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;

  if (!Number.isNaN(parsed) && parsed > 0) {
    return parsed;
  }

  return 50;
}

export async function runIngestion(options: {
  limit?: number;
  productFilter?: string;
  sitemapUrl?: string;
  forceReindex?: boolean;
}) {
  console.log("Starting ingestion...");
  const embedBatchSize = getEmbedBatchSize();
  const enrichmentConfig = resolveEnrichmentConfig();
  const activeEnrichmentConfig = {
    ...enrichmentConfig,
    enabledContentKinds: enrichmentConfig.enabledContentKinds.filter(
      (kind) => kind === "prose" || kind === "table" || kind === "code",
    ),
  };

  // Quick check for DB table existence
  try {
    await db.query.documents.findFirst();
  } catch (error) {
    console.error("CRITICAL: Database tables are not set up. Run migrations first.");
    console.error(error);
    return;
  }
  
  const mainSitemap = options.sitemapUrl || process.env.SITEMAP_URL || "https://dev.epicgames.com/documentation/sitemap.xml";

  console.log(`Fetching sitemap from: ${mainSitemap}`);
  const allUrls = await getSitemapUrls(mainSitemap);

  let filteredUrls = allUrls;
  if (options.productFilter) {
    const normalizedFilter = options.productFilter.toLowerCase();
    filteredUrls = allUrls.filter((url) => {
      try {
        const segments = new URL(url).pathname
          .split("/")
          .filter(Boolean)
          .map((segment) => segment.toLowerCase());
        return segments.includes(normalizedFilter);
      } catch {
        return false;
      }
    });

    // Prioritize root and shorter paths within the selected filter scope,
    // so low crawl limits include foundational pages like `/guide`.
    filteredUrls = [...filteredUrls].sort((a, b) => {
      const rank = (url: string) => {
        try {
          const segments = new URL(url).pathname
            .split("/")
            .filter(Boolean)
            .map((segment) => segment.toLowerCase());
          const idx = segments.indexOf(normalizedFilter);
          if (idx === -1) return Number.MAX_SAFE_INTEGER;
          const tail = segments.slice(idx + 1);
          const firstTail = tail[0] || "";
          const apiPenalty = firstTail.startsWith("api-") ? 1 : 0;
          return tail.length * 10 + apiPenalty;
        } catch {
          return Number.MAX_SAFE_INTEGER;
        }
      };

      return rank(a) - rank(b);
    });
  }

  const urlsToProcess = filteredUrls.slice(0, options.limit || 100);
  console.log(`Processing ${urlsToProcess.length} URLs...`);

  for (const url of urlsToProcess) {
    try {
      // 1. Check if document exists and has the same hash (incremental crawl)
      const existingDoc = await db.query.documents.findFirst({
        where: eq(documents.url, url),
      });

      const html = await fetchPage(url);
      const parsed = parseHTMLToStructuredDocument(html, url);
      const processingHash = deriveDocumentProcessingHash(parsed.hash, activeEnrichmentConfig);

      if (!options.forceReindex && existingDoc && existingDoc.contentHash === processingHash) {
        console.log(`Skipping unchanged document: ${url}`);
        continue;
      }

      console.log(`Processing changes for: ${url}`);

      // Use a transaction for consistency
      await db.transaction(async (tx) => {
        // 2. Upsert document metadata
        const [doc] = await tx.insert(documents).values({
          url: parsed.url,
          title: parsed.title,
          lang: parsed.lang,
          product: parsed.product,
          contentHash: processingHash,
          lastCrawledAt: new Date(),
        }).onConflictDoUpdate({
          target: documents.url,
          set: {
            title: parsed.title,
            lang: parsed.lang,
            product: parsed.product,
            contentHash: processingHash,
            lastCrawledAt: new Date(),
          },
        }).returning();

        // 3. Clear existing chunks (if any) before re-chunking
        await tx.delete(chunks).where(eq(chunks.documentId, doc.id));

        // 4. Chunk the document
        const docChunks = chunkStructuredDocument(parsed);
        console.log(`  Split into ${docChunks.length} chunks`);
        const enrichmentPlan = planChunkEnrichment(docChunks, activeEnrichmentConfig);
        const eligibleChunkCount = enrichmentPlan.filter((item) => item.decision.status === "eligible").length;
        console.log(`  Enrichment policy: ${eligibleChunkCount}/${docChunks.length} chunks eligible`);
        const persistedChunks = await enrichChunksForIngestion(
          docChunks,
          activeEnrichmentConfig,
          enrichChunkWithModel,
        );
        const preparedChunks = prepareChunksForEmbedding(persistedChunks);

        // 5. Generate embeddings in batches for efficiency
        const batchSize = embedBatchSize;
        for (let i = 0; i < preparedChunks.length; i += batchSize) {
          const batch = preparedChunks.slice(i, i + batchSize);
          const embeddings = await generateBatchEmbeddings(batch.map((c) => c.embeddingInput));

          // 6. Store chunks and embeddings
          await tx.insert(chunks).values(
            batch.map((c, index) => ({
              documentId: doc.id,
              chunkIndex: c.chunkIndex,
              content: c.content,
              tokenCount: c.metadata.token_estimate,
              embedding: embeddings[index],
              anchor: c.anchor,
              metadata: c.metadata,
            }))
          );
        }
      });

      console.log(`Successfully ingested and embedded: ${url}`);

    } catch (error) {
      if (isEmbeddingQuotaExceededError(error)) {
        console.error(`Embedding quota exceeded while processing ${url}.`);
        console.error(error.message);
        console.error(`Retry after ${error.retryAfterSeconds}s.`);
        break;
      }

      console.error(`Error processing ${url}:`, error);
    }
  }

  console.log("Ingestion completed.");
}
