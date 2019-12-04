import * as path from 'path';
import * as pg from 'pg';
import { Settings } from '@elements/settings';
import { Config } from './config';
import { Database } from './database';

export class Pool {
  private _pool: pg.Pool;

  public constructor() {
  }

  public connect(config?: Config) {
    if (config && typeof config['name'] === 'string') {
      config.database = config['name'];
    }

    this._pool = new pg.Pool(config);
  }

  public async checkout(): Promise<Database> {
    let client = await this._pool.connect();
    return new Database(client);
  }

  public async end(): Promise<this> {
    await this._pool.end();
    return this;
  }
}
