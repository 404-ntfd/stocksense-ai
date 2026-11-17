import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { DbEngine } from '@/core/db/engine';

let SQL: SqlJsStatic | null = null;
export async function sqlJs(): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}
export async function makeEngine(bytes?: Uint8Array): Promise<DbEngine> {
  return new DbEngine(await sqlJs(), bytes ?? null);
}
/** The fixed "today" every deterministic test uses. */
export const TODAY = '2026-11-17';
