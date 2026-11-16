import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/theme.css';
import { App } from './app/App';
import { isNative } from './core/util/platform';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker gives the web build offline support. Inside the APK the assets are
// already local, so registering one there would only add a stale-cache risk.
if (!isNative() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
