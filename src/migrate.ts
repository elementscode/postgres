import * as fs from 'fs';
import * as path from 'path';
import { DbConnection } from './db-connection';

const reMigrationFileName = /(\d{4}-\d{2}-\d{2}-\d{9})\.js$/

export interface IMigrationApi {
  up(db: DbConnection): void;
  down(db: DbConnection): void;
}

export enum MigrationState {
  Pending='Pending',
  Completed='Completed',
}

export class Migration {
  state: MigrationState;
  name: string;
  description: string;
  batch: number;
  api: IMigrationApi;

  public constructor(description: string, api?: IMigrationApi) {
    this.name = '';
    this.description = description;
    this.state = MigrationState.Pending;
    this.api = api;
  }

  public up(db: DbConnection) {
    this.api.up(db);
  }

  public down(db: DbConnection) {
    this.api.down(db);
  }

  public static create(desc: string, api: IMigrationApi): Migration {
    return new Migration(desc, api);
  }
}

export async function migrateUp() {
  let db = await DbConnection.create();
  await db.sql(`begin`);

  try {
    await ensureMigrationSchemaExists(db);
    let nextBatchNumber = await getNextBatchNumber(db);
    let migrations = await getPendingMigrations(db);
    for (let idx = 0; idx < migrations.length; idx++) {
      let migration = migrations[idx];
      migration.up(db);
      await db.sql(`insert into elements.migrations (name, description, batch) values ($1, $2, $3)`, [migration.name, migration.description, nextBatchNumber]);
    }
  } catch (err) {
    console.error(err);
    await db.sql(`abort`);
  } finally {
    console.error('finished');
    await db.sql(`commit`);
    db.end();
  }
}

export async function migrateDown() {
  let db = await DbConnection.create();
  await db.sql(`begin`);

  try {
    await ensureMigrationSchemaExists(db);
    let migrations = await getLastBatchCompletedMigrations(db);

    for (let idx = migrations.length - 1; idx >= 0; idx--) {
      let migration = migrations[idx];
      migration.down(db);
      await db.sql(`delete from elements.migrations where name = $1`, [migration.name]);
    }
  } catch (err) {
    console.error(err);
    await db.sql(`abort`);
  } finally {
    console.error('finished');
    await db.sql(`commit`);
    db.end();
  }
}

async function getPendingMigrations(db: DbConnection): Promise<Migration[]> {
  let migrations: Migration[] = [];
  let diskMigrations = await getDiskMigrations();
  let dbMigrations = await getDbMigrations(db);
  let dbMigrationSet = new Set(dbMigrations.map(m => m.name));
  return diskMigrations.filter(m => !dbMigrationSet.has(m.name));
}

async function getLastBatchCompletedMigrations(db: DbConnection): Promise<Migration[]> {
  let migrations: Migration[] = [];
  let diskMigrations = await getDiskMigrations();
  let diskMigrationMap = new Map(diskMigrations.map(m => [m.name, m]));
  let dbMigrations = await getDbMigrations(db);
  let batch = dbMigrations.length > 0 ? dbMigrations[dbMigrations.length - 1].batch : 0;

  if (dbMigrations.length > 0) {
    let idx = dbMigrations.length - 1;
    let batch = dbMigrations[idx].batch;

    while (idx >= 0) {
      let migration = dbMigrations[idx--];
      if (migration.batch == batch) {
        let diskMigration = diskMigrationMap.get(migration.name);
        if (diskMigration) {
          migrations.push(diskMigration);
        }
      } else {
        break;
      }
    }
  }

  return migrations;
}

async function getDiskMigrations(): Promise<Migration[]> {
  let migrations: Migration[] = [];
  let migrationsPath = getMigrationsPath();
  fs.readdirSync(migrationsPath).forEach(fileName => {
    let match = reMigrationFileName.exec(fileName);
    if (match) {
      let migration = require(path.join(migrationsPath, fileName)).default;
      migration.name = match[1];
      migrations.push(migration);
    }
  });
  return migrations.sort((m1, m2) => m1.name.localeCompare(m2.name));
}

async function getDbMigrations(db: DbConnection): Promise<Migration[]> {
  let migrations: Migration[] = [];
  let result = await db.sql(`select name, description, batch from elements.migrations`);
  result.forEach(row => {
    let migration = new Migration(row.description);
    migration.state = MigrationState.Completed;
    migration.name = row.name;
    migration.batch = row.batch;
    migrations.push(migration);
  });
  return migrations.sort((m1, m2) => m1.name.localeCompare(m2.name));
}

async function getNextBatchNumber(db: DbConnection): Promise<number> {
  let result = await db.sql(`select max(batch) as batch from elements.migrations limit 1`);
  return result.size > 0 ? result.first().batch + 1 : 1;
}

async function ensureMigrationSchemaExists(db: DbConnection) {
  await db.sql(`
    create extension if not exists "uuid-ossp";
    create schema if not exists elements;
    create table if not exists elements.migrations (
      id uuid primary key default uuid_generate_v1mc(),
      name text not null,
      description text not null,
      batch bigint,
      created_at timestamp default current_timestamp,
      updated_at timestamp default current_timestamp
    );
  `);
}

function getMigrationsPath(): string {
  return path.join(process.cwd(), 'app', 'migrations');
}
