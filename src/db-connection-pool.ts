import * as path from 'path';
import * as pg from 'pg';
import { Config } from './config';
import { DbConnection } from './db-connection';

export class DbConnectionPool {
  private _pool: pg.Pool;

  public constructor() {
  }

  public async connect(config?: Config) {
    if (config && typeof config['name'] === 'string') {
      config.database = config['name'];
    }

    this._pool = new pg.Pool(config);

    try {
      let db = await this.checkout();
      db.checkin();
    } catch (err) {
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
}
