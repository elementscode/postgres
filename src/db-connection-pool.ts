import * as path from 'path';
import * as pg from 'pg';
import { Config } from './config';
import { DbConnection } from './db-connection';

export class DbConnectionPool {
  private _pool: pg.Pool;

  public constructor() {
  }

  public connect(config?: Config) {
    if (config && typeof config['name'] === 'string') {
      config.database = config['name'];
    }

    this._pool = new pg.Pool(config);
  }

  public async checkout(): Promise<DbConnection> {
    let client = await this._pool.connect();
    return new DbConnection(client);
  }

  public async end(): Promise<this> {
    await this._pool.end();
    return this;
  }
}
