// DbClient: the only way the UI talks to SQLite. Every call is forwarded to the DB worker.
// AI-written queries (readOnly) get a hard timeout: if SQLite is still busy after 3 s the worker is
// terminated and restarted from the last saved snapshot, which is safe because such queries never write.
import * as Comlink from 'comlink';
import type { DbApi } from './api';
import type { DbHost } from './worker';
import type { ImportMode, ImportReport, ImportTarget, QueryOpts, QueryResult, Row } from '../types';

export class QueryTimeoutError extends Error {
  constructor() { super('That question needs too much work. Try narrowing the period.'); this.name = 'QueryTimeoutError'; }
}

type Asyncify<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };
export interface Tx { exec(sql: string, params?: unknown[]): void }

export interface DbClient extends Asyncify<Omit<DbApi, 'query'>> {
  query<T = Row>(sql: string, params?: unknown[], opts?: QueryOpts): Promise<QueryResult<T>>;
  transaction(fn: (tx: Tx) => void | Promise<void>): Promise<void>;
  importRows(target: ImportTarget, rows: AsyncIterable<Row[]> | Iterable<Row[]>, mode: ImportMode, batchId: string): Promise<ImportReport>;
  flush(): Promise<void>;
  status(): ReturnType<DbHost['status']>;
  restart(): void;
}

let worker: Worker | null = null;
let remote: Comlink.Remote<DbHost> | null = null;

function start(): Comlink.Remote<DbHost> {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'stocksense-db' });
  remote = Comlink.wrap<DbHost>(worker);
  return remote;
}
const host = (): Comlink.Remote<DbHost> => remote ?? start();
function restart(): void {
  worker?.terminate();
  worker = null;
  remote = null;
  start();
}

function call(name: string, args: unknown[]): Promise<unknown> {
  const cbIndex = args.findIndex((a) => typeof a === 'function');
  const prepared = args.map((a) => (typeof a === 'function' ? null : a));
  const transfers: Transferable[] = [];
  if (name === 'parseFile' || name === 'restore') for (const a of prepared) if (a instanceof Uint8Array) transfers.push(a.buffer as ArrayBuffer);
  const payload = transfers.length ? Comlink.transfer(prepared, transfers) : prepared;
  if (cbIndex >= 0) return host().call(name, payload, cbIndex, Comlink.proxy(args[cbIndex] as (...x: unknown[]) => unknown)) as Promise<unknown>;
  return host().call(name, payload) as Promise<unknown>;
}

const special = {
  async query<T = Row>(sql: string, params?: unknown[], opts: QueryOpts = {}): Promise<QueryResult<T>> {
    if (!opts.readOnly) return call('query', [sql, params, opts]) as Promise<QueryResult<T>>;
    await host().flush(); // make sure a restart after a timeout cannot lose anything
    const timeoutMs = opts.timeoutMs ?? 3000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { restart(); reject(new QueryTimeoutError()); }, timeoutMs); });
    try {
      return await Promise.race([call('query', [sql, params, opts]) as Promise<QueryResult<T>>, timeout]);
    } finally { if (timer) clearTimeout(timer); }
  },
  async transaction(fn: (tx: Tx) => void | Promise<void>): Promise<void> {
    const statements: Array<{ sql: string; params?: unknown[] }> = [];
    await fn({ exec: (sql, params) => { statements.push({ sql, params }); } });
    if (statements.length) await call('execBatch', [statements]);
  },
  async importRows(target: ImportTarget, rows: AsyncIterable<Row[]> | Iterable<Row[]>, mode: ImportMode, batchId: string): Promise<ImportReport> {
    await call('importBegin', [target, mode, batchId, 'manual import']);
    for await (const chunk of rows as AsyncIterable<Row[]>) await call('importChunk', [batchId, chunk]);
    return call('importEnd', [batchId]) as Promise<ImportReport>;
  },
  flush: (): Promise<void> => host().flush() as Promise<void>,
  status: () => host().status(),
  restart,
};

export const db = new Proxy(special as unknown as DbClient, {
  get(target, prop: string) {
    if (prop in target) return (target as unknown as Record<string, unknown>)[prop];
    return (...args: unknown[]) => call(prop, args);
  },
});
