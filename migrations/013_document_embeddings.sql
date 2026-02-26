-- Document chunks with embeddings for RAG over property documents
-- Run: psql $DATABASE_URL -f migrations/013_document_embeddings.sql
-- Requires: pgvector extension (CREATE EXTENSION vector; run as superuser if not already enabled)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
  id SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES property_documents(id) ON DELETE CASCADE,
  document_key VARCHAR(512) NOT NULL,
  system_key VARCHAR(50) NOT NULL,
  document_type VARCHAR(255),
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_document_chunks_property ON document_chunks(property_id);
CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_document_chunks_system ON document_chunks(system_key);

-- Vector index created separately when table has data (ivfflat requires rows)
