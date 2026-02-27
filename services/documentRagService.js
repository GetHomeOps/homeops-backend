"use strict";

/**
 * Document RAG Service
 *
 * Ingests property documents (PDFs) into vector store for semantic search.
 * Used by AI chat to answer questions about document content.
 */

const { PDFParse } = require("pdf-parse");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { OpenAIEmbeddings } = require("@langchain/openai");
const pgvector = require("pgvector/pg");
const db = require("../db");
const { getFile } = require("./s3Service");
const PropertyDocument = require("../models/propertyDocuments");

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const EMBEDDING_MODEL = "text-embedding-3-small";
const TOP_K = 8;

let pgvectorReady = null;

async function ensurePgVectorTypes() {
  if (pgvectorReady === true) return;
  if (pgvectorReady === false) throw new Error("pgvector not available");
  try {
    await pgvector.registerTypes(db);
    pgvectorReady = true;
  } catch (e) {
    pgvectorReady = false;
    throw new Error("pgvector not available (run migration 013)");
  }
}

async function extractTextFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text || "";
}

function isPdfDocument(documentKey) {
  const key = (documentKey || "").toLowerCase();
  return key.endsWith(".pdf");
}

/**
 * Ingest a single document: download, extract text, chunk, embed, store.
 */
async function ingestDocument(propertyId, documentId) {
  await ensurePgVectorTypes();

  const doc = await PropertyDocument.get(documentId);
  if (doc.property_id !== propertyId) {
    throw new Error("Document does not belong to property");
  }
  if (!isPdfDocument(doc.document_key)) {
    return { skipped: true, reason: "Not a PDF" };
  }

  const buffer = await getFile(doc.document_key);
  const text = await extractTextFromPdf(buffer);
  if (!text || text.trim().length < 50) {
    return { skipped: true, reason: "Could not extract enough text" };
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  const chunks = await splitter.splitText(text);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const embeddingsModel = new OpenAIEmbeddings({
    openAIApiKey: apiKey,
    model: EMBEDDING_MODEL,
  });

  const vectors = await embeddingsModel.embedDocuments(chunks);

  await db.query(
    `DELETE FROM document_chunks WHERE document_id = $1`,
    [documentId]
  );

  for (let i = 0; i < chunks.length; i++) {
    const embeddingSql = pgvector.toSql(vectors[i]);
    await db.query(
      `INSERT INTO document_chunks (property_id, document_id, document_key, system_key, document_type, chunk_index, content, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        propertyId,
        documentId,
        doc.document_key,
        doc.system_key || "general",
        doc.document_type || "other",
        i,
        chunks[i],
        embeddingSql,
      ]
    );
  }

  return { chunks: chunks.length };
}

/**
 * Ingest all PDF documents for a property.
 */
async function ingestPropertyDocuments(propertyId) {
  await ensurePgVectorTypes();
  const docs = await PropertyDocument.getByPropertyId(propertyId);
  const results = [];
  for (const doc of docs) {
    if (!isPdfDocument(doc.document_key)) continue;
    try {
      const r = await ingestDocument(propertyId, doc.id);
      results.push({ documentId: doc.id, ...r });
    } catch (err) {
      console.error(`[documentRag] Ingest failed for doc ${doc.id}:`, err.message);
      results.push({ documentId: doc.id, error: err.message });
    }
  }
  return results;
}

/**
 * Search document chunks by semantic similarity.
 * Returns top-k chunks for the given query, filtered by property.
 */
async function searchChunks(propertyId, query, options = {}) {
  if (pgvectorReady === false) return [];
  try {
    await ensurePgVectorTypes();
  } catch {
    return [];
  }

  const { systemKey, limit = TOP_K } = options;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return [];
  }

  const embeddingsModel = new OpenAIEmbeddings({
    openAIApiKey: apiKey,
    model: EMBEDDING_MODEL,
  });
  const [queryEmbedding] = await embeddingsModel.embedDocuments([query]);
  const embeddingSql = pgvector.toSql(queryEmbedding);

  let sql = `
    SELECT c.content, c.system_key, c.document_type, c.document_key,
           p.document_name, p.document_date
    FROM document_chunks c
    JOIN property_documents p ON p.id = c.document_id
    WHERE c.property_id = $1 AND c.embedding IS NOT NULL
  `;
  const params = [propertyId];
  if (systemKey) {
    params.push(systemKey);
    sql += ` AND system_key = $${params.length}`;
  }
  sql += ` ORDER BY embedding <=> $${params.length + 1} LIMIT $${params.length + 2}`;
  params.push(embeddingSql, limit);

  const res = await db.query(sql, params);
  return res.rows;
}

/**
 * Build document context string for LLM from search results.
 */
async function getDocumentContext(propertyId, query, options = {}) {
  const chunks = await searchChunks(propertyId, query, options);
  if (chunks.length === 0) return "";

  const parts = chunks.map((c, i) => {
    const name = c.document_name || c.document_key?.split("/").pop() || "document";
    const meta = [name];
    if (c.document_date) meta.push(c.document_date);
    if (c.document_type) meta.push(c.document_type);
    if (c.system_key) meta.push(c.system_key);
    const source = ` (from ${meta.join(", ")})`;
    return `[Excerpt ${i + 1}${source}]\n${c.content}`;
  });
  return "Relevant document excerpts:\n" + parts.join("\n\n");
}

module.exports = {
  ingestDocument,
  ingestPropertyDocuments,
  searchChunks,
  getDocumentContext,
};
