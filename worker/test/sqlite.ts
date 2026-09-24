/**
 * bun:sqlite adapted to the D1 client interface, so the repository and the
 * whole app run against the real migration in tests. D1 is SQLite too; batch()
 * keeps D1's all-or-nothing transaction semantics.
 */
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlDatabase, SqlResult, SqlStatement, SqlValue } from "../src/db";

export const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

class SqliteStatement implements SqlStatement {
  constructor(
    private readonly owner: SqliteD1,
    readonly sql: string,
    private readonly values: SqlValue[] = [],
  ) {}

  bind(...values: SqlValue[]): SqlStatement {
    return new SqliteStatement(this.owner, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    return this.execute<T>().results[0] ?? null;
  }

  async all<T>(): Promise<SqlResult<T>> {
    return this.execute<T>();
  }

  async run(): Promise<unknown> {
    return this.execute();
  }

  execute<T>(): SqlResult<T> {
    this.owner.statementCount++;
    return {
      results: this.owner.db.query(this.sql).all(...this.values) as T[],
    };
  }
}

export class SqliteD1 implements SqlDatabase {
  /** Statements executed so far, to check the per-request D1 query budget. */
  statementCount = 0;

  constructor(readonly db: Database) {}

  prepare(query: string): SqlStatement {
    return new SqliteStatement(this, query);
  }

  async batch<T>(statements: SqlStatement[]): Promise<SqlResult<T>[]> {
    return this.db.transaction(() =>
      statements.map((statement) =>
        (statement as SqliteStatement).execute<T>(),
      ),
    )();
  }

  /** Synchronous query helper for assertions. */
  rows<T = Record<string, unknown>>(sql: string, ...values: SqlValue[]): T[] {
    return this.db.query(sql).all(...values) as T[];
  }
}

export function migrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
}

export function createTestDatabase(): SqliteD1 {
  const db = new Database(":memory:");
  db.exec(migrationSql());
  return new SqliteD1(db);
}
