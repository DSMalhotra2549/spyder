// For Node scripts/tests that can't use Vite's ?raw import.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Migration } from './migrate';

export function loadMigrationsFromDisk(dir = join(__dirname, 'migrations')): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .map((f) => ({ version: parseInt(f, 10), sql: readFileSync(join(dir, f), 'utf8') }));
}
