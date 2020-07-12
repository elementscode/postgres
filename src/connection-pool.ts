import * as path from 'path';
import * as pg from 'pg';
import { Config } from './config';
import { Connection } from './connection';

export class ConnectionPool {
  private _pool: pg.Pool;

  public constructor() {
  }

  public connect(config?: Config) {
    if (config && typeof config['name'] === 'string') {
      config.database = config['name'];
    }

    this._pool = new pg.Pool(config);
  }

  public async checkout(): Promise<Connection> {
    let client = await this._pool.connect();
    return new Connection(client);
  }

  public async end(): Promise<this> {
    await this._pool.end();
    return this;
  }
}
