import * as pg from 'pg';
import { Config } from './config';
import { DbConnection } from './db-connection';

export async function connect(config?: Config): Promise<DbConnection> {
  let client = new pg.Client(config);
  await client.connect();
  return new DbConnection(client);
}
