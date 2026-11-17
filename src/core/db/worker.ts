/// <reference lib="webworker" />
// The DB worker: owns SQLite (sql.js WASM), imports and KPI queries, and persists the database to
// IndexedDB after every change. Nothing here runs on a timer except the short save debounce.
import * as Comlink from 'comlink';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { DbEngine } from './engine';
import { buildApi, type DbApi } from './api';

const IDB_NAME = 'stocksense';
const STORE = 'kv';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const d = await openIdb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally { d.close(); }
}
async function idbSet(key: string, value: unknown): Promise<void> {
  const d = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Storage write was aborted'));
    });
  } finally { d.close(); }
}

let engine: DbEngine;
let api: DbApi;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let saveError: string | null = null;
let bootWarning: string | null = null;
let lastSavedAt = 0;
let saveCount = 0;

async function flush(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = undefined; }
  if (!dirty) return;
  dirty = false;
  try {
    await idbSet('db', engine.snapshot());
    saveError = null;
    lastSavedAt = Date.now();
    saveCount++;
  } catch (e) {
    // IndexedDB keeps the previous snapshot when a write fails (quota), so nothing already saved is lost.
    dirty = true;
    const name = (e as { name?: string } | null)?.name ?? '';
    saveError = name === 'QuotaExceededError' ? 'Storage is full. Your latest changes are not saved yet: free some space, then export a backup.' : 'Saving failed. Export a backup from the Data screen to be safe.';
  }
}
function scheduleSave(): void {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, 400);
}

const ready: Promise<void> = (async () => {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let bytes: Uint8Array | undefined;
  try { bytes = await idbGet<Uint8Array>('db'); } catch { bootWarning = 'Browser storage is not available, so data will not be kept after you close the app.'; }
  const beforeMigrate = (from: number, old: Uint8Array): void => { void idbSet(`db-backup-v${from}`, old).catch(() => {}); };
  try {
    engine = new DbEngine(SQL, bytes ?? null, beforeMigrate);
  } catch (e) {
    if (bytes) { try { await idbSet('db-unreadable', bytes); } catch { /* best effort */ } }
    bootWarning = `Your saved data could not be opened (${e instanceof Error ? e.message : 'unknown error'}). A copy was kept; the app started empty.`;
    engine = new DbEngine(SQL, null);
  }
  engine.onChange = scheduleSave;
  api = buildApi(engine);
})();

const host = {
  async call(name: string, args: unknown[]): Promise<unknown> {
    await ready;
    const fn = (api as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    if (typeof fn !== 'function') throw new Error(`Unknown database call: ${name}`);
    return fn(...args);
  },
  async flush(): Promise<void> { await ready; await flush(); },
  async status(): Promise<{ saveError: string | null; bootWarning: string | null; lastSavedAt: number; saveCount: number; dirty: boolean }> {
    await ready;
    return { saveError, bootWarning, lastSavedAt, saveCount, dirty };
  },
};
export type DbHost = typeof host;
Comlink.expose(host);
