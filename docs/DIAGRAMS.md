# Application Sequence Diagrams

## 1. Ingestion Route (`POST /api/ingest`)
This route starts an async ingestion job for Vite docs (or configured sitemap), then the ingestion service crawls, parses, chunks, embeds, and stores results in PostgreSQL + pgvector.

```mermaid
sequenceDiagram
    participant Admin as User/Admin
    participant API as /api/ingest (Route Handler)
    participant IS as Ingestion Service (lib/ingest)
    participant SM as Sitemap Service (lib/ingest/sitemap)
    participant PS as Parser Service (lib/ingest/parser)
    participant Gemini as Gemini API (Embedding)
    participant DB as PostgreSQL (pgvector)
    participant Docs as Vite Docs (External)

    Admin->>API: POST { limit, productFilter }
    API->>IS: runIngestion(options)
    Note over API,IS: Fire-and-forget async task
    API-->>Admin: 200 JSON (Ingestion Started)

    IS->>SM: getSitemapUrls(mainSitemap)
    SM->>Docs: Fetch sitemap.xml
    Docs-->>SM: XML Data
    SM-->>IS: List of URLs

    Note over IS: Apply product segment filter and prioritize root/shorter paths

    loop For each URL (up to limit)
        IS->>DB: Query existing doc by URL
        DB-->>IS: Document metadata (if exists)
        
        IS->>PS: fetchPage(url)
        PS->>Docs: GET HTML
        Docs-->>PS: HTML content
        IS->>PS: parseHTML(html)
        PS-->>IS: Parsed Content + Hash
        
        alt Hash Mismatch or New Doc
            IS->>DB: Upsert Document Metadata
            IS->>DB: Delete existing chunks for document
            IS->>IS: Chunk content
            IS->>Gemini: batchEmbedContents(chunks) [quota-gated]
            Gemini-->>IS: Embeddings
            IS->>DB: Insert chunks + halfvec embeddings
        else Hash Matches
            Note over IS: Skip unchanged page
        end

        alt Embedding quota exceeded
            Note over IS: Stop current ingestion run
        end
    end
```

---

## 2. Retrieval Route (`POST /api/retrieve`)
This route embeds a query and returns top chunks using cosine similarity on `halfvec(3072)` embeddings.

```mermaid
sequenceDiagram
    participant User as User/Frontend
    participant API as /api/retrieve (Route Handler)
    participant Gemini as Gemini API (Embedding Model)
    participant DB as PostgreSQL (pgvector)
    participant EQ as Embedding Quota Guard

    User->>API: POST { query, limit?, threshold? }
    API->>API: Resolve threshold (request override or env default)
    API->>EQ: Check embed RPM/TPM/RPD
    EQ-->>API: allow / block
    
    alt Quota exceeded
        API-->>User: 429 { reason, retryAfterSeconds }
    else Allowed
        API->>Gemini: embedContent(query)
        Gemini-->>API: Vector [3072]
        API->>DB: Cosine Similarity Search (halfvec)
        Note over DB: HNSW Index Lookup
        DB-->>API: Top-K Relevant Chunks + Metadata
        API-->>User: 200 JSON { chunks }
    end
```

---

## 3. Chat Route (`POST /api/chat`)
This route does quota checks, retrieval, grounded generation with model fallback, then returns formatted answer + source list.

```mermaid
sequenceDiagram
    participant User as User/Frontend
    participant API as /api/chat (Route Handler)
    participant RS as Retrieval Logic
    participant QQ as Query Quota Guard
    participant EQ as Embedding Quota Guard
    participant Gemini as Gemini API (Query Model + Fallbacks)
    participant DB as PostgreSQL (pgvector)

    User->>API: POST { messages }
    
    API->>RS: Retrieve context for last user message
    RS->>EQ: Check embedding quota
    alt Embedding quota exceeded
        API-->>User: 429 { reason, retryAfterSeconds }
    else Allowed
        RS->>DB: Vector Search (top-k, CHAT_RETRIEVE_THRESHOLD)
        DB-->>RS: Content + Citation URLs
        RS-->>API: Grounding Context
    end

    API->>QQ: Check query quota
    alt Query quota exceeded
        API-->>User: 429 { reason, retryAfterSeconds }
    else Allowed

        API->>Gemini: sendChatWithFallback(history + systemPrompt + userMessage)
        Note right of Gemini: Try QUERY_MODEL_NAME, fallback if unavailable
        Gemini-->>API: Generated Answer (with citations)

        API->>API: Strip trailing References section
        API->>API: Parse citation indexes [1], [1,2]
        API->>API: Build sources list with stable citation numbers
        API-->>User: 200 JSON { content, sources }
    end
```
