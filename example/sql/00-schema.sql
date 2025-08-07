CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE
  IF NOT EXISTS "documents" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW ()
  );

CREATE TABLE
  IF NOT EXISTS "embeddings" (
    "id" SERIAL PRIMARY KEY,
    "document" INTEGER NOT NULL REFERENCES "documents" ("id") ON DELETE CASCADE,
    "text" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "vector" vector (3),
    "created_at" TIMESTAMPTZ DEFAULT NOW ()
  );

CREATE INDEX IF NOT EXISTS "idx_embeddings_vector_cosine" ON "embeddings" USING "hnsw" ("vector" vector_cosine_ops);