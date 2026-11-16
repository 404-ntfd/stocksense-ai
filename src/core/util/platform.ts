import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platform = (): string => Capacitor.getPlatform();
export const isOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** Chrome major version of the WebView/browser, or 0 when unknown. */
export function chromeMajor(): number {
  const m = typeof navigator !== 'undefined' ? /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent) : null;
  return m ? Number(m[1]) : 0;
}

export async function haptic(kind: 'light' | 'medium' = 'light'): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: kind === 'light' ? ImpactStyle.Light : ImpactStyle.Medium });
  } catch { /* haptics are a nicety */ }
}
