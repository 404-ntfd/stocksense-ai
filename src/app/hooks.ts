import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './store';

export interface Loadable<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** Runs an async read against the database and re-runs it whenever data changes. */
export function useDb<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { watchForecast?: boolean } = {}): Loadable<T> {
  const ready = useApp((s) => s.dbReady);
  const version = useApp((s) => s.dataVersion);
  const fver = useApp((s) => (opts.watchForecast ? s.forecastVersion : 0));
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef.current().then(
      (data) => { if (alive) setState({ data, error: null, loading: false }); },
      (e: unknown) => { if (alive) setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e), loading: false })); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, version, fver, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** True when the dark theme is active (re-renders charts when the theme flips). */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
