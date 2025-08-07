import { Pool } from "pg";
import PostgresVectorStore from "../lib/index";
import { AsyncTransform } from "@mojsoski/async-stream";

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "local",
  database: "db",
});

type ExampleDocument = { id: number; name: string; created_at?: Date | string };

const vectorStore = new PostgresVectorStore<number, ExampleDocument>({
  pool,
  documentScope: { scope: "test" },
  embeddingScope: { scope: "test" },
});

async function main() {
  const documents = await vectorStore.getDocuments().transform().toArray();
  console.log("Documents in store:", documents);

  const documentReference = await vectorStore.createDocument({
    name: "Test Document",
  });
  console.log("Created document with ID:", documentReference);
  await vectorStore.append(
    documentReference,
    AsyncTransform.from([
      { text: "Hello", vector: [1, 2, 3] },
      { text: "World", vector: [4, 5, 6] },
      { text: "Foo", vector: [7, 8, 9] },
    ])
  );
  console.log("Appended embeddings to document.");

  const result = await vectorStore
    .query([2.5, 3, 4.5], [documentReference])
    .transform()
    .toArray();
  console.log("Query result:", result);

  await vectorStore.delete(documentReference);
  console.log("Deleted document with ID:", documentReference);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unhandeled error:", err);
    process.exit(1);
  });
