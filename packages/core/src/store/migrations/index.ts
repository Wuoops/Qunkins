import type { Database } from '../sqlite';
import { up as migration001 } from './001_initial';

export function runMigrations(db: Database): void {
  migration001(db);
}
