import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/theme.css';
import { App } from './app/App';
import { applyTheme, useSettings } from './app/settings';
import { useApp } from './app/store';
import { db } from './core/db/client';
import { getSecret } from './core/util/secrets';
import { chromeMajor, isNative } from './core/util/platform';
import { ensureForecasts, keyName, restoreNativeSnapshotIfEmpty, writeNativeSnapshot } from './app/services';

applyTheme(useSettings.getState().theme);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(useSettings.getState().theme));
useSettings.subscribe((s, prev) => { if (s.theme !== prev.theme) applyTheme(s.theme); });

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

const app = useApp.getState();
window.addEventListener('online', () => app.setOnline(true));
window.addEventListener('offline', () => app.setOnline(false));

(async () => {
  try {
    await db.ping();
    if (await restoreNativeSnapshotIfEmpty()) app.toast('Your data was restored from the on-device backup copy.', 'ok');
    const st = await db.status();
    if (st.bootWarning) app.toast(st.bootWarning, 'error');
    app.setDbReady(true);
    const key = await getSecret(keyName(useSettings.getState().provider));
    useSettings.getState().set({ hasKey: !!key });
    if (chromeMajor() && chromeMajor() < 100) app.toast('Your Android System WebView is old. Update "Android System WebView" in the Play Store for the best experience.', 'error');
    // forecasts: once the app is idle, and only when sales changed or the day rolled over
    setTimeout(() => { void ensureForecasts().catch(() => {}); }, 1500);
  } catch (e) {
    app.setDbReady(false, e instanceof Error ? e.message : String(e));
  }
})();

// Persist whenever data changes, and flush on pause so a killed app loses nothing.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useApp.subscribe((s, prev) => {
  if (s.dataVersion === prev.dataVersion) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void db.flush().then(writeNativeSnapshot).catch(() => {}); }, 1500);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { window.dispatchEvent(new Event('stocksense:pause')); void db.flush(); } });
if (isNative()) {
  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('pause', () => { window.dispatchEvent(new Event('stocksense:pause')); void db.flush().then(writeNativeSnapshot); });
    void App.addListener('resume', () => { void ensureForecasts().catch(() => {}); });
  });
  void import('@capacitor/keyboard').then(({ Keyboard }) => Keyboard.setResizeMode?.({ mode: 'native' as never }).catch(() => {})).catch(() => {});
}

// Offline support for the web build. The APK already has its assets locally.
if (!isNative() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
