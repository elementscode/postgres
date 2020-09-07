import * as pg from 'pg';
import { camelCase } from '@elements/utils';
import { findOrCreateAppConfig } from '@elements/config';
import { SqlResult } from './sql-result';
import { DbConfig } from './types';

function camelCaseColNames<T = any>(rows: T[]): T[] {
  let result = [];

  if (!rows) {
    return result;
  }

  for (let idx = 0; idx < rows.length; idx++) {
    let oldRow = rows[idx];
    let newRow = {};
    Object.keys(oldRow).forEach(oldKey => {
      newRow[camelCase(oldKey)] = oldRow[oldKey];
    });
    result.push(newRow);
  }
  return result;
}


/**
 * The Connection class represents a single connection to the database server.
 * These connections will be "checked out" of a database pool that contains
 * multiple connections to the database.
 */
export class DbConnection {
  private _client: pg.ClientBase;

  public get name(): string {
    return this._client['database'];
  }

  public constructor(client: pg.ClientBase) {
    this._client = client;
  }

  public async sql<R extends any = any, A extends any[] = any[]>(text: string, args?: A): Promise<SqlResult<R>> {
    let result = await this._client.query<R, A>(text, args);
    return new SqlResult<R>(camelCaseColNames<R>(result.rows));
  }

  public async end(): Promise<void> {
    if (typeof this._client['end'] === 'function') {
      return this._client['end']();
    }
  }

  public checkin(): this {
    if (typeof this._client['release'] === 'function') {
      this._client['release']();
    }
    return this;
  }

  public static async create(config: DbConfig = findOrCreateAppConfig().get<DbConfig>('db', {})): Promise<DbConnection> {
    let client = new pg.Client(config);
    await client.connect();
    return new DbConnection(client);
  }
}
