import * as path from 'path';
import * as pg from 'pg';
import { findOrCreateAppConfig } from '@elements/config';
import { DbConfig } from './types';
import { DbConnection } from './db-connection';
import { SqlResult } from './sql-result';

export enum DbConnectionPoolState {
  Idle='Idle',
  Connecting='Connecting',
  Connected='Connected',
  Error='Error',
}

/**
 * Maintains a pool of database connections for an app. You can checkout a
 * connection from the pool and check it back in when you're done. Or, you can
 * call the sql method directly on the pool to automatically checkout a
 * connection and check it back in when finished.
 */
export class DbConnectionPool {
  private _pool: pg.Pool;

  private _state: DbConnectionPoolState;

  public constructor(config: DbConfig = findOrCreateAppConfig().get<DbConfig>('db', {})) {
    this._state = DbConnectionPoolState.Idle;
  }

  public async connect(config: DbConfig = findOrCreateAppConfig().get<DbConfig>('db', {})) {
    this._state = DbConnectionPoolState.Connecting;
    this._pool = new pg.Pool(config);

    try {
      let db = await this.checkout();
      db.checkin();
      this._state = DbConnectionPoolState.Connected;
    } catch (err) {
      this._state = DbConnectionPoolState.Error;
      throw new Error(`Error connecting to the postgres database: ${err.message}`);
    }
  }

  public async checkout(): Promise<DbConnection> {
    let client = await this._pool.connect();
    return new DbConnection(client);
  }

  public async end(): Promise<this> {
    await this._pool.end();
    return this;
  }

  /**
   * Checkout a database connection and call the sql method on it, automatically
   * closing the connection when this method returns.
   */
  public async sql<R extends any = any, A extends any[] = any[]>(text: string, args?: A): Promise<SqlResult<R>> {
    let db = await this.checkout();
    try {
      return db.sql<R,A>(text, args);
    } finally {
      db.checkin();
    }
  }
}
