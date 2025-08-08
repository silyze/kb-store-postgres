import { assert } from "@mojsoski/assert";
import { AsyncReadStream, AsyncTransform } from "@mojsoski/async-stream";
import { Embedding, EmbeddingResult, Vector, VectorStore } from "@silyze/kb";
import type { Pool } from "pg";
import SQL, { SQLStatement } from "sql-template-strings";

export type EmbeddingRow<TPrimaryKey> = Embedding & {
  document: TPrimaryKey;
};

export type DistanceAlgorithm =
  | "l1"
  | "l2"
  | "negative_inner_product"
  | "cosine";

export type PostgresVectorStoreConfig<TPrimaryKey> = {
  pool: Pool;
  algorithm?: DistanceAlgorithm;
  mapEmbeddingColumn?: (columnName: keyof EmbeddingRow<TPrimaryKey>) => string;
  documentScope?: Record<string, any>;
  embeddingScope?: Record<string, any>;
  documentTable?: string;
  embeddingTable?: string;
};

export function createIdentifier(str: string) {
  return '"' + str.replace(/"/g, '""') + '"';
}

export default class PostgresVectorStore<
  TPrimaryKey,
  TDocument extends { id: TPrimaryKey }
> extends VectorStore<TPrimaryKey, TDocument> {
  #pool: Pool;
  #mapEmbeddingColumn: (columnName: keyof EmbeddingRow<TPrimaryKey>) => string;
  #documentScope: Record<string, any>;
  #embeddingScope: Record<string, any>;
  #algorithm: DistanceAlgorithm;
  #documentTable: string;
  #embeddingTable: string;

  #createScopeFilter(scope: Record<string, any>): SQLStatement {
    const entries = Object.entries(scope);
    if (entries.length === 0) return SQL``;

    const statement = SQL``;
    let first = true;
    for (const [key, value] of entries) {
      if (!first) statement.append(SQL` AND `);
      statement.append(createIdentifier(key)).append(SQL` = ${value ?? null}`);
      first = false;
    }
    return statement;
  }

  #createInsertQuery<T extends object>(
    table: string,
    object: Omit<T, "id">,
    scope: Record<string, any>,
    mapFunction?: (key: keyof T) => string
  ): SQLStatement {
    const fullObject: Record<string, any> = {
      ...scope,
      ...object,
    };

    const keys = Object.keys(fullObject);
    const columns: string[] = [];
    const values: any[] = [];

    for (const key of keys) {
      const columnName = mapFunction ? mapFunction(key as keyof T) : key;
      columns.push(createIdentifier(columnName));
      values.push(fullObject[key]);
    }

    const statement = SQL`INSERT INTO `
      .append(createIdentifier(table))
      .append(SQL` (`);
    statement.append(columns.join(", "));
    statement.append(SQL`) VALUES (`);

    for (let i = 0; i < values.length; i++) {
      statement.append(
        SQL`${
          Array.isArray(values[i]) ? `[${values[i].join(",")}]` : values[i]
        }`
      );
      if (i < values.length - 1) {
        statement.append(SQL`, `);
      }
    }

    statement.append(SQL`) RETURNING "id"`);
    return statement;
  }

  constructor(config: PostgresVectorStoreConfig<TPrimaryKey>) {
    super();
    this.#pool = config.pool;
    this.#mapEmbeddingColumn =
      config.mapEmbeddingColumn ?? ((columnName) => columnName);
    this.#documentScope = config.documentScope ?? {};
    this.#embeddingScope = config.embeddingScope ?? {};
    this.#algorithm = config.algorithm ?? "cosine";
    this.#documentTable = config.documentTable ?? "documents";
    this.#embeddingTable = config.embeddingTable ?? "embeddings";
  }

  async getDocumentByReference(
    reference: TPrimaryKey
  ): Promise<TDocument | undefined> {
    const stmt = SQL`SELECT * FROM `
      .append(createIdentifier(this.#documentTable))
      .append(SQL` WHERE "id" = ${reference}`);

    const scopeFilter = this.#createScopeFilter(this.#documentScope);
    if (scopeFilter.text.length > 0) {
      stmt.append(SQL` AND `).append(scopeFilter);
    }

    const result = await this.#pool.query<TDocument>(stmt);
    return result.rows[0];
  }

  query(
    vector: Vector,
    documents?: TPrimaryKey[],
    limit = 10,
    offset = 0
  ): AsyncReadStream<EmbeddingResult<TPrimaryKey>> {
    const operator = {
      l2: "<->",
      l1: "<+>",
      negative_inner_product: "<#>",
      cosine: "<=>",
    }[this.#algorithm];

    assert(operator, `Unsupported distance algorithm: ${this.#algorithm}`);

    const vectorCol = this.#mapEmbeddingColumn("vector");
    const textCol = this.#mapEmbeddingColumn("text");
    const docCol = this.#mapEmbeddingColumn("document");

    const stmt = SQL`SELECT `;
    stmt.append(createIdentifier(docCol)).append(SQL` AS document, `);
    stmt.append(createIdentifier(textCol)).append(SQL` AS text, `);
    stmt.append(createIdentifier(vectorCol)).append(SQL` AS vector, `);

    stmt.append(
      SQL``
        .append(createIdentifier(vectorCol))
        .append(` ${operator} `)
        .append(SQL`${"[" + vector.join(",") + "]"}`)
        .append(SQL` AS distance `)
    );

    stmt.append(SQL`FROM `).append(createIdentifier(this.#embeddingTable));

    const filters: SQLStatement[] = [];

    const scopeFilter = this.#createScopeFilter(this.#embeddingScope);
    if (scopeFilter.text.length > 0) {
      filters.push(scopeFilter);
    }

    if (documents !== undefined) {
      filters.push(
        SQL``.append(createIdentifier(docCol)).append(SQL` = ANY(${documents})`)
      );
    }

    if (filters.length > 0) {
      stmt.append(SQL` WHERE `);
      filters.forEach((filter, i) => {
        if (i > 0) stmt.append(SQL` AND `);
        stmt.append(filter);
      });
    }

    stmt.append(SQL` ORDER BY distance ASC`);
    stmt.append(SQL` LIMIT ${limit} OFFSET ${offset}`);

    return AsyncTransform.from<EmbeddingResult<TPrimaryKey>>(
      this.#pool.query(stmt).then((res) =>
        res.rows.map((row) => ({
          text: row.text,
          vector: JSON.parse(row.vector),
          distance: row.distance,
          document: row.document,
        }))
      )
    );
  }

  async append(
    document: TPrimaryKey,
    embeddings: AsyncReadStream<Embedding>
  ): Promise<void> {
    for await (const embedding of embeddings.transform()) {
      await this.#pool.query(
        this.#createInsertQuery(
          this.#embeddingTable,
          { ...embedding, document },
          this.#embeddingScope,
          this.#mapEmbeddingColumn
        )
      );
    }
  }

  async delete(document: TPrimaryKey): Promise<void> {
    const stmt = SQL`DELETE FROM `
      .append(createIdentifier(this.#documentTable))
      .append(SQL` WHERE "id" = ${document}`);

    const scopeFilter = this.#createScopeFilter(this.#documentScope);
    if (scopeFilter.text.length > 0) {
      stmt.append(SQL` AND `).append(scopeFilter);
    }

    await this.#pool.query(stmt);
  }

  async createDocument(document: Omit<TDocument, "id">): Promise<TPrimaryKey> {
    const result = await this.#pool.query<{ id: TPrimaryKey }>(
      this.#createInsertQuery(
        this.#documentTable,
        document,
        this.#documentScope
      )
    );

    assert(result.rows.length === 1, "Expected one row to be returned");
    return result.rows[0].id;
  }

  getDocuments(): AsyncReadStream<TDocument> {
    const scopeFilter = this.#createScopeFilter(this.#documentScope);

    const stmt = SQL`SELECT * FROM `.append(
      createIdentifier(this.#documentTable)
    );

    if (scopeFilter.text.length > 0) {
      stmt.append(SQL` WHERE `).append(scopeFilter);
    }

    return AsyncTransform.from<TDocument>(
      this.#pool.query<TDocument>(stmt).then((result) => result.rows)
    );
  }
}
