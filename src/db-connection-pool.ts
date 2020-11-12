import * as path from 'path';
import * as pg from 'pg';
import { findOrCreateAppConfig } from '@elements/config';
import { DbConfig } from './types';
import { DbConnection } from './db-connection';

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

  public constructor() {
    this._state = DbConnectionPoolState.Idle;
  }

  public async connect(config: DbConfig = findOrCreateAppConfig().get<DbConfig>('db', {})) {
    this._state = DbConnectionPoolState.Connecting;
    this._pool = new pg.Pool(config);
    this._state = DbConnectionPoolState.Connected;
  }

  public async checkout(): Promise<DbConnection> {
    if (this._state == DbConnectionPoolState.Idle) {
      await this.connect();
    }

    let client = await this._pool.connect();
    return new DbConnection(client);
  }

  public async end(): Promise<this> {
    await this._pool.end();
    return this;
  }
}
