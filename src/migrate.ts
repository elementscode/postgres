import * as fs from 'fs';
import * as path from 'path';
import {
  table,
  style,
  FontColor,
  FontStyle,
  showCursor,
  hideCursor,
} from '@elements/term';
import {
  padZeros,
  pluralize,
  getDateString,
  indent,
} from '@elements/utils'
import { StandardError } from '@elements/error';
import { Job } from '@elements/job';
import { DbConnection } from './db-connection';

// note: the group is around the 2020-09-05 date, excluding the timestamp
// portion, so we can easily extract the 'created' field of the migration. The
// 'name' field of the migration will be the basename without the file
// extension.
const reMigrationFileName = /(\d{4}-\d{2}-\d{2})-\d{9}\.js$/

export class MigrationError extends StandardError {
  migration: Migration;
  constructor(migration: Migration, message: string) {
    super(message);
    this.migration = migration;
  }
}

export interface IMigrateOpts {
  noTransaction?: boolean;
}

export interface IMigrateStatusOpts {
  up?: boolean;
  down?: boolean;
}

export interface IMigrationApi {
  up(db: DbConnection): void;
  down(db: DbConnection): void;
}

export enum UpDownState {
  Up='Up',
  Down='Down',
}

function getColorForUpDownState(state: UpDownState) {
  switch (state) {
    case UpDownState.Up:
      return FontColor.Green;
    case UpDownState.Down:
      return FontColor.Yellow;
    default:
      throw new Error('Unknown state: ' + state);
  }
}

export enum RunState {
  Pending='Pending',
  Completed='Completed',
  Error='Error',
}

function getColorForRunState(state: RunState) {
  switch (state) {
    case RunState.Pending:
      return FontColor.Yellow;
    case RunState.Completed:
      return FontColor.Green;
    case RunState.Error:
      return FontColor.Red;
    default:
      throw new Error('Unknown state: ' + state);
  }
}

export class Migration {
  upDownState: UpDownState;
  runState: RunState;
  name: string;
  description: string;
  createdAt: string;
  runAt: string;
  batch: number;
  api: IMigrationApi;

  public constructor(description: string, api?: IMigrationApi) {
    this.name = '';
    this.description = description;
    this.upDownState = UpDownState.Down;
    this.runState = RunState.Pending;
    this.api = api;
    this.createdAt = '';
    this.runAt = '';
  }

  public async up(db: DbConnection): Promise<any> {
    return this.api.up(db);
  }

  public async down(db: DbConnection): Promise<any> {
    return this.api.down(db);
  }

  public hasApi(): boolean {
    return !!this.api;
  }

  public static create(desc: string, api: IMigrationApi): Migration {
    return new Migration(desc, api);
  }
}

async function withDb<T = any>(transaction: boolean, callback: (db: DbConnection) => Promise<T>): Promise<T> {
  let db = await DbConnection.create();
  await ensureMigrationSchemaExists(db);

  try {
    if (transaction) {
      await db.sql('begin');
    }

    let result: T = await callback(db);

    if (transaction) {
      await db.sql('commit');
    }

    return result;
  } catch(err) {
    if (transaction) {
      await db.sql('abort');
    }
    throw err;
  } finally {
    db.end();
  }
}

export async function migrateUp(opts: IMigrateOpts = {}): Promise<Job> {
  let stream = process.stderr;

  let job = new Job({
    progress: 'Migrating',
    stream: stream,
  });

  let migrations: Migration[] = [];
  try {
    await withDb<void>(!opts.noTransaction, async function(db: DbConnection) {
      let allMigrations = await getAllMigrations(db);
      let nextBatchNumber = await getNextBatch(db);
      migrations = allMigrations.filter(m => m.upDownState == UpDownState.Down && m.hasApi());

      for (let idx = 0; idx < migrations.length; idx++) {
        let migration = migrations[idx];
        job.progress(`Migrating Up: ${migration.description}`);

        try {
          // run the migration up
          await migration.up(db);
        } catch (err) {
          migration.runState = RunState.Error;
          throw new MigrationError(migration, err.toString());
        }

        // insert the migration db row
        let insertMigrationResult = await db.sql(`
          insert into elements.migrations (
            name,
            description,
            batch,
            created_at
          ) values ($1, $2, $3, $4)
          returning *
        `, [
          migration.name,
          migration.description,
          nextBatchNumber,
          migration.createdAt,
        ]);

        migration.runAt = getDateString(insertMigrationResult.first().runAt);
        migration.upDownState = UpDownState.Up;
        migration.runState = RunState.Completed;
      }
    });
    job.summary(getJobSummary('up', migrations, job, opts));
  } catch (err) {
    job.addError(err);
    if (err instanceof MigrationError) {
      job.summary(getJobSummary('up', migrations, job, opts));
    } else {
      job.summary(getErrSummary(err));
    }
  }

  return job.finish();
}

export async function migrateDown(opts: IMigrateOpts = {}): Promise<Job> {
  let stream = process.stderr;

  let job = new Job({
    progress: 'Migrating',
    stream: stream,
  });

  let migrations: Migration[] = [];

  try {
    await withDb<void>(!opts.noTransaction, async function(db: DbConnection) {
      let allMigrations = await getAllMigrations(db);
      let lastBatch = await getLastBatch(db);
      migrations = allMigrations.filter(m => m.upDownState == UpDownState.Up && m.batch == lastBatch && m.hasApi());

      for (let idx = migrations.length - 1; idx >= 0; idx--) {
        let migration = migrations[idx];
        job.progress(`Migrating Down: ${migration.description}`);

        try {
          // run the migration down
          await migration.down(db);
        } catch (err) {
          migration.runState = RunState.Error;
          throw new MigrationError(migration, err.toString());
        }

        // delete the migration row
        await db.sql('delete from elements.migrations where name = $1;', [migration.name]);

        // set the migration state
        migration.upDownState = UpDownState.Down;
        migration.runState = RunState.Completed;
        migration.runAt = '';
      }
    });
    job.summary(getJobSummary('down', migrations, job, opts));
  } catch (err) {
    job.addError(err);
    if (err instanceof MigrationError) {
      job.summary(getJobSummary('down', migrations, job, opts));
    } else {
      job.summary(getErrSummary(err));
    }
  }

  return job.finish();
}

export async function migrateStatus(opts: IMigrateStatusOpts = {}): Promise<Job> {
  let stream = process.stderr;

  let job = new Job({
    progress: 'Computing Status',
    stream: stream,
  });

  try {
    await withDb<void>(false, async function(db: DbConnection) {
      let allMigrations = await getAllMigrations(db);
      let migrations: Migration[];

      if (opts.up) {
        migrations = allMigrations.filter(m => m.upDownState == UpDownState.Up);
      } else if (opts.down) {
        migrations = allMigrations.filter(m => m.upDownState == UpDownState.Down);
      } else {
        migrations = allMigrations;
      }

      job.summary(getUpDownStateTable(migrations));
    });
  } catch (err) {
    job.addError(err);
    job.summary(getErrSummary(err));
  }

  return job.finish();
}

/**
 * Returns a sorted array of migrations from disk and the database.
 */
async function getAllMigrations(db: DbConnection): Promise<Migration[]> {
  let allMigrations: Migration[] = [];
  let diskMigrations = await getDiskMigrations();
  let dbMigrations = await getDbMigrations(db);

  // add all the disk migrations
  diskMigrations.forEach((diskMigration, name) => allMigrations.push(diskMigration));

  // add any missing db migrations and set the completed state of disk
  // migrations that are in the db.
  dbMigrations.forEach((dbMigration, name) => {
    if (diskMigrations.has(name)) {
      // already have the migration from disk? use that one since it will have
      // the up/down apis attached to it. copy over the db migration attributes.
      let diskMigration = diskMigrations.get(name);
      diskMigration.upDownState = UpDownState.Up;
      diskMigration.createdAt = dbMigration.createdAt;
      diskMigration.runAt = dbMigration.runAt;
      diskMigration.batch = dbMigration.batch;
    } else {
      // don't have the migration on disk? add the db migration to the list so
      // we can still see its status (but we won't be able to call the up/down
      // api methods since we don't have those in the db version).
      allMigrations.push(dbMigration);
    }
  });

  // return the migrations sorted in ascending order by name which should
  // lexographically be sorted by created at date.
  return allMigrations.sort((a, b) => a.name.localeCompare(b.name));
}

async function getDiskMigrations(): Promise<Map<string, Migration>> {
  let migrations = new Map();
  let migrationsPath = getMigrationsPath();
  fs.readdirSync(migrationsPath).forEach(fileName => {
    let match = reMigrationFileName.exec(fileName);
    if (match) {
      let migration: Migration = require(path.join(migrationsPath, fileName)).default;
      migration.name = path.basename(match[0], '.js');
      migration.createdAt = match[1];
      migrations.set(migration.name, migration);
    }
  });
  return migrations;
}

async function getDbMigrations(db: DbConnection): Promise<Map<string, Migration>> {
  let migrations = new Map();
  let result = await db.sql(`select name, description, batch, created_at::timestamp::date, run_at::timestamp::date from elements.migrations`);
  result.forEach(row => {
    let migration = new Migration(row.description);
    migration.upDownState = UpDownState.Up;
    migration.name = row.name;
    migration.batch = row.batch;
    migration.createdAt = getDateString(row.createdAt);
    migration.runAt = getDateString(row.runAt);
    migrations.set(migration.name, migration);
  });
  return migrations;
}

async function getNextBatch(db: DbConnection): Promise<number> {
  let result = await db.sql(`select max(batch) as batch from elements.migrations limit 1`);
  let batch = result.first().batch;
  return batch ? Number.parseInt(batch) + 1 : 1;
}

async function getLastBatch(db: DbConnection): Promise<number> {
  let result = await db.sql(`select max(batch) as batch from elements.migrations limit 1`);
  return result.size > 0 ? result.first().batch : -1;
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
      run_at timestamp default current_timestamp,
      created_at timestamp default current_timestamp,
      updated_at timestamp default current_timestamp
    );
  `);
}

function getMigrationsPath(): string {
  return path.join(process.cwd(), 'app', 'migrations');
}

function getJobSummary(direction: string, migrations: Migration[], job: Job, opts: IMigrateOpts): string {
  let result: string;
  if (migrations.length == 0) {
    result = style('There are no migrations to run ' + direction + '.', FontColor.Gray) + '\n';
    return result;
  } else {
    if (opts.noTransaction !== true && job.hasErrors()) {
      // reset all completed migrations to pending state since they were rolled
      // back.
      migrations.forEach(m => m.runState == RunState.Completed ? m.runState = RunState.Pending : m.runState);
    }

    result = getRunStateTable(migrations) + '\n';
    if (job.hasErrors()) {
      let errMigration = job.getErrors()[0];
      if (opts.noTransaction) {
        result += style(`This migration failed:\n${errMigration.migration.name} ${errMigration.migration.description}.`, FontColor.Gray) + '\n\n';
      } else {
        result += style(`All migrations in the transaction were rolled back.\n\nThis migration failed:\n${errMigration.migration.name} ${errMigration.migration.description}.`, FontColor.Gray) + '\n\n';
      }

      result += errMigration.message + '\n';
    } else {
      result += style(`You ran ${migrations.length} ${pluralize(migrations.length, 'migration', 'migrations')} ${direction}.`, FontColor.Gray) + '\n';
    }

    return result;
  }
}

function getUpDownStateTable(migrations: Migration[]): string {
  let rows: string[][] = [];

  if (migrations.length == 0) {
    rows.push([style('No migrations.', FontColor.Gray)]);
    return table(rows);
  }

  rows.push([
    style('Migration', FontColor.Gray, FontStyle.Bold),
    style('Created', FontColor.Gray, FontStyle.Bold),
    style('Run', FontColor.Gray, FontStyle.Bold),
    style('State', FontColor.Gray, FontStyle.Bold),
  ]);

  for (let idx = 0; idx < migrations.length; idx++) {
    let migration = migrations[idx];
    rows.push([
      style(migration.description, FontColor.Gray, FontStyle.Dim),
      style(migration.createdAt, FontColor.Blue, FontStyle.Dim),
      style(migration.runAt, FontColor.Blue, FontStyle.Dim),
      style(migration.upDownState, getColorForUpDownState(migration.upDownState), FontStyle.None),
    ]);
  }

  return table(rows);
}

function getRunStateTable(migrations: Migration[]): string {
  let rows: string[][] = [];

  if (migrations.length == 0) {
    rows.push([style('No migrations.', FontColor.Gray)]);
    return table(rows);
  }

  rows.push([
    style('Migration', FontColor.Gray, FontStyle.Bold),
    style('Created', FontColor.Gray, FontStyle.Bold),
    style('State', FontColor.Gray, FontStyle.Bold),
  ]);

  for (let idx = 0; idx < migrations.length; idx++) {
    let migration = migrations[idx];
    rows.push([
      style(migration.description, FontColor.Default, FontStyle.Dim),
      style(migration.createdAt, FontColor.Blue, FontStyle.Dim),
      style(migration.runState, getColorForRunState(migration.runState), FontStyle.None),
    ]);
  }

  return table(rows);
}

function getErrSummary(err: any): string {
  return String(err) + '\n';
}
