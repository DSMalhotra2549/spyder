// Bundled migrations (Vite `?raw` import). Scripts run under tsx use loadMigrationsFromDisk() instead.
import init from './001_init.sql?raw';
import scopeReset from './002_scope_reset.sql?raw';
import type { Migration } from '../migrate';

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: init },
  { version: 2, sql: scopeReset },
];
