import type { EngineEvent, Unsubscribe } from './controller';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type Fn = Function;
export class Emitter {
  private handlers = new Map<EngineEvent, Set<Fn>>();
  on(e: EngineEvent, cb: Fn): Unsubscribe {
    if (!this.handlers.has(e)) this.handlers.set(e, new Set());
    this.handlers.get(e)!.add(cb);
    return () => this.handlers.get(e)?.delete(cb);
  }
  fire(e: EngineEvent, payload?: unknown): void { for (const cb of [...(this.handlers.get(e) ?? [])]) { try { cb(payload); } catch { /* a listener must not break the engine */ } } }
}
