import { getAppSettings } from './utils';
import { ConnectionsPool } from './connections-pool';

const DbConnections = new ConnectionsPool();
export { DbConnections };
