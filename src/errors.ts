import { StandardError } from '@elements/error';
import { json } from '@elements/json';

@json
export class SqlError extends StandardError {}
