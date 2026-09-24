// Compile-time check that the real D1 binding satisfies the interface the
// repository is written against. Only part of the Workers typecheck.
import type { SqlDatabase } from "./db";

export type D1SatisfiesSqlDatabase = D1Database extends SqlDatabase
  ? true
  : never;
const check: D1SatisfiesSqlDatabase = true;
void check;
