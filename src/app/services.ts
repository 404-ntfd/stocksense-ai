// App-level wiring: the LLM provider for the saved key, the Ask pipeline, forecasts and native lifecycle.
import * as Comlink from 'comlink';
import golden from '../../tests/eval/golden.json';
import { db } from '@/core/db/client';
import { OpenAiCompatProvider } from '@/core/ai/providers/openaiCompat';
import { PROVIDER_DEFAULTS, type LlmProvider } from '@/core/ai/types';
import type { GoldenItem } from '@/core/ai/fewshot';
import { createAskPipeline, type AskPipeline } from '@/core/ask/pipeline';
import type { AnalyticsApi } from '@/core/analytics/worker';
import { getSecret } from '@/core/util/secrets';
import { todayISO } from '@/core/util/dates';
import { isNative } from '@/core/util/platform';
import { settings } from './settings';
import { useApp } from './store';

export const keyName = (provider: string): string => `apikey.${provider}`;

export async function getProvider(): Promise<LlmProvider | null> {
  const s = settings();
  const key = await getSecret(keyName(s.provider));
  if (!key) return null;
  return new OpenAiCompatProvider(s.provider, PROVIDER_DEFAULTS[s.provider].baseUrl, () => getSecret(keyName(s.provider)));
}

let analytics: Comlink.Remote<AnalyticsApi> | null = null;
function analyticsWorker(): Comlink.Remote<AnalyticsApi> {
  if (!analytics) analytics = Comlink.wrap<AnalyticsApi>(new Worker(new URL('../core/analytics/worker.ts', import.meta.url), { type: 'module', name: 'stocksense-analytics' }));
  return analytics;
}

let forecasting: Promise<void> | null = null;
/** Recomputes forecasts when sales changed or the date rolled over. Runs in the analytics worker. */
export function ensureForecasts(): Promise<void> {
  if (forecasting) return forecasting;
  forecasting = (async () => {
    try {
      const today = todayISO();
      const st = await db.forecastState(today);
      if (!st.stale) return;
      const input = await db.forecastInput(today);
      const { results } = await analyticsWorker().forecastAll(input);
      await db.saveForecasts(results, today);
      useApp.getState().bumpForecast();
    } finally { forecasting = null; }
  })();
  return forecasting;
}

let pipeline: AskPipeline | null = null;
export function askPipeline(): AskPipeline {
  pipeline ??= createAskPipeline({
    db, llm: getProvider, today: todayISO, online: () => useApp.getState().online && navigator.onLine !== false, golden: golden as GoldenItem[], ensureForecasts,
    settings: () => { const s = settings(); return { planModel: s.planModel, narrateModel: s.narrateModel, fallbackModel: s.fallbackModel, privacyMode: s.privacyMode, aiNarration: s.aiNarration, businessName: s.businessName }; },
  });
  return pipeline;
}

// ---- native snapshot (a second copy of the database outside IndexedDB) ----
const SNAPSHOT = 'stocksense-latest.stocksense';
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export async function writeNativeSnapshot(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const bytes = await db.snapshot();
    if (bytes.length > 40 * 1024 * 1024) return; // too large to copy safely in one piece
    await Filesystem.writeFile({ path: SNAPSHOT, directory: Directory.Data, data: toBase64(bytes) });
  } catch { /* IndexedDB remains the primary copy */ }
}
/** If IndexedDB came up empty but a snapshot file exists (storage was cleared by the OS), bring the data back. */
export async function restoreNativeSnapshotIfEmpty(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const st = await db.stats();
    if (st.products || st.sales || st.expenses) return false;
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const f = await Filesystem.readFile({ path: SNAPSHOT, directory: Directory.Data });
    if (typeof f.data !== 'string' || !f.data) return false;
    await db.restore(fromBase64(f.data));
    return true;
  } catch { return false; }
}

/** Saves a file for the user: a browser download on the web, the system share sheet on Android. */
export async function saveFile(name: string, data: Uint8Array | string, mime: string): Promise<void> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const res = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: toBase64(bytes) });
    await Share.share({ title: name, files: [res.uri], dialogTitle: `Save or share ${name}` });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function shareText(text: string, title: string): Promise<void> {
  if (isNative()) { const { Share } = await import('@capacitor/share'); await Share.share({ title, text, dialogTitle: title }); return; }
  if (navigator.share) { try { await navigator.share({ title, text }); return; } catch { /* cancelled: fall back to copy */ } }
  await navigator.clipboard?.writeText(text);
  useApp.getState().toast('Copied to the clipboard', 'ok');
}

export async function speak(text: string, lang: string): Promise<void> {
  try {
    if (isNative()) { const { TextToSpeech } = await import('@capacitor-community/text-to-speech'); await TextToSpeech.stop().catch(() => {}); await TextToSpeech.speak({ text, lang, rate: 1 }); return; }
    if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = lang; window.speechSynthesis.speak(u); }
  } catch { /* read-aloud is optional */ }
}
export async function stopSpeaking(): Promise<void> {
  try {
    if (isNative()) { const { TextToSpeech } = await import('@capacitor-community/text-to-speech'); await TextToSpeech.stop(); }
    else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } catch { /* nothing was playing */ }
}
