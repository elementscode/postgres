import * as pg from 'pg';
import { SqlResult } from './sql_result';

/**
 * The Database class represents a single connection to the database server.
 * These connections will be "checked out" of a database pool that contains
 * multiple connections to the database.
 */
export class Database {
  private _client: pg.ClientBase;

  public get name(): string {
    return this._client['database'];
  }

  public constructor(client: pg.ClientBase) {
    this._client = client;
  }

  public async sql<R extends any = any, A extends any[] = any[]>(text: string, args?: A): Promise<SqlResult<R>> {
    let result = await this._client.query<R, A>(text, args);
    return new SqlResult<R>(result.rows);
  }

  public checkin(): this {
    if (typeof this._client['release'] === 'function') {
      this._client['release']();
    }
    return this;
  }
}
