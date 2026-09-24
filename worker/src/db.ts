/**
 * The subset of the D1 client API that the Worker uses. D1Database satisfies it
 * (checked in d1-compat.ts); tests adapt bun:sqlite to it.
 */
export type SqlValue = string | number | null;

export interface SqlResult<T> {
  results: T[];
}

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run(): Promise<unknown>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  /** Runs the statements in order inside one transaction. */
  batch<T = Record<string, unknown>>(
    statements: SqlStatement[],
  ): Promise<SqlResult<T>[]>;
}
