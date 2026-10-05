import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Exercise the actual migration SQL and API queries, with D1's atomic batch semantics.
// A live workerd check is separate from these in-process integration tests.
export function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(
      new URL('../migrations/0001_foundation.sql', import.meta.url),
      'utf8',
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL('../migrations/0002_reference_data.sql', import.meta.url),
      'utf8',
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL('../migrations/0003_place_entry.sql', import.meta.url),
      'utf8',
    ),
  );
  sqlite.exec(readFileSync(new URL('../migrations/0004_place_enrichment.sql', import.meta.url), 'utf8'));
  function prepared(sql: string, values: SQLInputValue[] = []) {
    return {
      bind(...next: SQLInputValue[]) {
        return prepared(sql, next);
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return {
          success: true,
          results: sqlite.prepare(sql).all(...values),
          meta: {},
        };
      },
      run() {
        const result = sqlite.prepare(sql).run(...values);
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes) },
        };
      },
    };
  }
  return {
    sqlite,
    prepare: prepared,
    async batch(statements: ReturnType<typeof prepared>[]) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(statement.run());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
