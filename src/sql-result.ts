import { json } from '@elements/json';
import { NotAuthorizedError, NotFoundError } from '@elements/error';

type ErrorConstructor = new (...args: any[]) => any;

@json
export class SqlResult<T = any> {
  public rows: T[];

  /**
   * Returns the number of rows in the sql result.
   */
  public get size(): number {
    return this.rows.length;
  }

  /**
   * Creates a new SqlResult.
   */
  public constructor(rows?: T[]) {
    if (Array.isArray(rows)) {
      this.rows = rows;
    } else {
      this.rows = [];
    }
  }

  /**
   * Returns the first row in the result set.
   */
  public first(): T {
    return this.size > 0 ? this.rows[0] : undefined;
  }

  /**
   * Returns the first record in the result set and throws a NotAuthorized error
   * if the record does not exist.
   */
  public firstOrThrowNotAuthorizedError(msg: string = ''): T {
    return this.firstOrThrowError(NotAuthorizedError, msg);
  }

  /**
   * Returns the first record in the result set and throws a NotFoundError if
   * the record does not exist.
   */
  public firstOrThrowNotFoundError(msg: string = ''): T {
    return this.firstOrThrowError(NotFoundError, msg);
  }

  /**
   * Returns the first record in the result set and throws the specified error
   * if the first row does not exist.
   */
  public firstOrThrowError(errorClass: ErrorConstructor = Error, msg: string = 'Not found.'): T {
    let result = this.first();
    if (typeof result === 'undefined') {
      let err = new errorClass(msg);
      throw err;
    }
    return result;
  }

  /**
   * Returns the last row in the result set.
   */
  public last(): T {
    return this.size > 0 ? this.rows[this.size - 1] : undefined;
  }

  /**
   * Map over the rows to return a new SqlResult containing the mapped values.
   *
   */
  public map<V = any>(callback: (row: T) => V): V[] {
    return this.rows.map(callback);
  }

  /**
   * Filter the row set by a predicate function that returns true to include the
   * row in the filtered result set, or false to exclude the row from the result
   * set.
   */
  public filter(callback: (row: T) => boolean): SqlResult<T> {
    return new SqlResult(this.rows.filter(callback));
  }

  /**
   * Sums a set of rows by column or composite column. The callback will be
   * called for each row in the result set. The callback should return a number
   * to be added to the sum. The number can come from a particular column, or be
   * a composite value.
   *
   */
  public sum(callback: (row: T) => number): number {
    let total = 0;
    this.rows.forEach(row => total += callback(row));
    return total;
  }

  /**
   * This function will call the provided callback once for each row in the
   * result.
   */
  public forEach(callback: (row: T) => void): this {
    this.rows.forEach(callback);
    return this;
  }

  /**
   * Group the rows by a single or composite column. Pass a callback function to
   * this function that returns the key for the given row. The return value of
   * this function is an object where the keys are those returned from the
   * callback function, and the value is an array of rows for that key.
   *
   * Example:
   *
   *   sql('select id, is_active from subscriptions').group(row => row.is_active);
   */
  public group(callback: <R extends any = any>(row: T) => R): {[key: string]: T[]} {
    let result: {[key: string]: T[]} = {};

    this.forEach((row: T) => {
      let key = callback(row);
      let rows = result[key];

      if (!rows) {
        rows = [];
        result[key] = rows;
      }

      rows.push(row);
    });

    return result;
  }

  /**
   * Returns the SqlResult raw rows.
   */
  public toArray(): T[] {
    return this.rows;
  }

  /**
   * Iterate over the rows.
   */
  public *[Symbol.iterator](): IterableIterator<T> {
    for (let row of this.rows) {
      yield row;
    }
  }
}
