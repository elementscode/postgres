import * as pg from 'pg';
import { DbConfig } from './types';
import { DbConnection } from './db-connection';

export async function connect(config?: DbConfig): Promise<DbConnection> {
  let client = new pg.Client(config);
  await client.connect();
  return new DbConnection(client);
}
