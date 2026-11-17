/// <reference lib="webworker" />
// Analytics worker: runs the forecasts for every SKU off the UI thread and off the DB thread.
import * as Comlink from 'comlink';
import { forecastAll, forecastProduct } from './forecast';
import type { ForecastInput } from '../types';

const api = {
  forecastAll: (input: ForecastInput) => {
    const t0 = performance.now();
    const results = forecastAll(input).map((r) => ({ ...r, daily: undefined }));
    return { results, ms: Math.round(performance.now() - t0) };
  },
  forecastOne: (p: ForecastInput['products'][number], today: string) => forecastProduct(p, today),
};
export type AnalyticsApi = typeof api;
Comlink.expose(api);
