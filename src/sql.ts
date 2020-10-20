import { DbPool } from './db-pool';
import { SqlResult } from './sql-result';

/**
 * Checkout a database connection and call the sql method on it, automatically
 * closing the connection when this method returns.
 */
export async function sql<R extends any = any, A extends any[] = any[]>(text: string, args?: A): Promise<SqlResult<R>> {
  let db = await DbPool.checkout();
  try {
    return db.sql<R,A>(text, args);
  } finally {
    db.checkin();
  }
}
