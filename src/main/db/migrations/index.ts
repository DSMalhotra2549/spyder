// Bundled migrations (Vite `?raw` import). Scripts run under tsx use loadMigrationsFromDisk() instead.
import init from './001_init.sql?raw';
import scopeReset from './002_scope_reset.sql?raw';
import blocks from './003_blocks.sql?raw';
import tags from './004_tags.sql?raw';
import type { Migration } from '../migrate';

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: init },
  { version: 2, sql: scopeReset },
  { version: 3, sql: blocks },
  { version: 4, sql: tags },
];
