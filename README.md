# @silyze/kb-store-postgres

PostgreSQL implementation of `VectorStore<TDocumentReference, TDocument>` for [`@silyze/kb`](https://www.npmjs.com/package/@silyze/kb), supporting vector-based similarity search and scoped document/embedding storage.

## Features

- Compatible with OpenAI and custom vector embeddings.
- Efficient vector similarity search using [`pgvector`](https://github.com/pgvector/pgvector) and HNSW indexes.
- Scoped document/embedding support via optional filters.
- Pluggable embedding and document schemas.
- Simple, promise-based interface.
- Fully typed in TypeScript.

## Installation

```bash
npm install @silyze/kb-store-postgres
```

> Requires PostgreSQL 15+ with `pgvector` extension installed.

## SQL Schema Example

```sql
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE IF NOT EXISTS "documents" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "embeddings" (
  "id" SERIAL PRIMARY KEY,
  "document" INTEGER NOT NULL REFERENCES "documents" ("id") ON DELETE CASCADE,
  "text" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "vector" vector(3),
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_embeddings_vector_cosine"
  ON "embeddings" USING hnsw ("vector" vector_cosine_ops);
```

## Usage Example

```ts
import { Pool } from "pg";
import PostgresVectorStore from "@silyze/kb-store-postgres";
import { AsyncTransform } from "@mojsoski/async-stream";

type ExampleDocument = { id: number; name: string; created_at?: Date };

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "your-password",
  database: "your-db",
});

const vectorStore = new PostgresVectorStore<number, ExampleDocument>({
  pool,
  documentScope: { scope: "test" },
  embeddingScope: { scope: "test" },
});

async function run() {
  const docId = await vectorStore.createDocument({ name: "Example Doc" });

  await vectorStore.append(
    docId,
    AsyncTransform.from([
      { text: "Hello", vector: [1, 2, 3] },
      { text: "World", vector: [4, 5, 6] },
    ])
  );

  const results = await vectorStore
    .query([2, 2, 2], [docId])
    .transform()
    .toArray();

  console.log(results);

  await vectorStore.delete(docId);
}

run().catch(console.error);
```

## API

### `new PostgresVectorStore(config)`

Creates a new vector store instance.

**Config options:**

| Key                  | Type                                                         | Description                                           |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| `pool`               | `pg.Pool`                                                    | PostgreSQL connection pool                            |
| `algorithm`          | `"cosine"` \| `"l2"` \| `"l1"` \| `"negative_inner_product"` | Vector distance metric (default: `"cosine"`)          |
| `documentScope`      | `Record<string, any>`                                        | Scope filter applied to documents (optional)          |
| `embeddingScope`     | `Record<string, any>`                                        | Scope filter applied to embeddings (optional)         |
| `documentTable`      | `string`                                                     | Name of the document table (default: `"documents"`)   |
| `embeddingTable`     | `string`                                                     | Name of the embedding table (default: `"embeddings"`) |
| `mapEmbeddingColumn` | `(key: keyof EmbeddingRow<T>) => string`                     | Optional mapping for embedding column names           |

### `query(vector, documents?, limit?, offset?)`

Returns nearest embeddings to a given vector. Optionally filters by document IDs.

### `append(documentId, embeddings)`

Appends a stream of embeddings to a document.

### `delete(documentId)`

Deletes a document and all associated embeddings.

### `createDocument(data)`

Inserts a new document row and returns its primary key.

### `getDocuments()`

Returns an async stream of all documents (filtered by scope if set).
