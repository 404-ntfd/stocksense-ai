// API keys live in the platform keystore on Android (via the secure-storage plugin) and never in the
// database, logs, exports or backups. On the web there is no keystore, so the key stays in this browser
// profile's local storage (documented in the product document).
import { isNative } from './platform';

const PREFIX = 'stocksense.secret.';
const cache = new Map<string, string | null>();

export async function getSecret(name: string): Promise<string | null> {
  if (cache.has(name)) return cache.get(name) ?? null;
  let value: string | null = null;
  try {
    if (isNative()) {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
      const v = await SecureStorage.get(PREFIX + name);
      value = typeof v === 'string' && v ? v : null;
    } else value = localStorage.getItem(PREFIX + name);
  } catch {
    try { value = localStorage.getItem(PREFIX + name); } catch { value = null; }
  }
  cache.set(name, value);
  return value;
}

export async function setSecret(name: string, value: string | null): Promise<void> {
  const v = value?.trim() || null;
  cache.set(name, v);
  try {
    if (isNative()) {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
      if (v) await SecureStorage.set(PREFIX + name, v); else await SecureStorage.remove(PREFIX + name);
      return;
    }
  } catch { /* fall through to local storage */ }
  try { if (v) localStorage.setItem(PREFIX + name, v); else localStorage.removeItem(PREFIX + name); } catch { /* storage unavailable: the key lives for this session only */ }
}

/** "gsk_abc…wxyz" for display. The full key is never rendered after it is saved. */
export function maskKey(key: string | null): string {
  if (!key) return '';
  return key.length <= 10 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}
