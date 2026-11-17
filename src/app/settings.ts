import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { PROVIDER_DEFAULTS } from '@/core/ai/types';

export type ProviderId = 'groq' | 'gemini';
export type VoiceEngineSetting = 'auto' | 'native' | 'webspeech' | 'whisper';

export interface Settings {
  onboarded: boolean;
  businessName: string;
  businessType: string;
  provider: ProviderId;
  planModel: string;
  narrateModel: string;
  fallbackModel: string;
  whisperModel: string;
  /** True once a key has been saved for the current provider (the key itself is in secure storage). */
  hasKey: boolean;
  privacyMode: boolean;
  aiNarration: boolean;
  voiceEngine: VoiceEngineSetting;
  lang: string;
  continuous: boolean;
  autoSendMs: number;
  readAloud: boolean;
  dayFirst: boolean;
  theme: 'system' | 'light' | 'dark';
  hindiLab: boolean;
  period: string;
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  setProvider: (p: ProviderId) => void;
  reset: () => void;
}

const defaults: Settings = {
  onboarded: false, businessName: '', businessType: 'General store',
  provider: 'groq', planModel: PROVIDER_DEFAULTS.groq.planModel, narrateModel: PROVIDER_DEFAULTS.groq.narrateModel, fallbackModel: PROVIDER_DEFAULTS.groq.fallbackModel, whisperModel: PROVIDER_DEFAULTS.groq.whisperModel,
  hasKey: false, privacyMode: false, aiNarration: true,
  voiceEngine: 'auto', lang: 'en-IN', continuous: false, autoSendMs: 1200, readAloud: false,
  dayFirst: true, theme: 'system', hindiLab: false, period: '30d',
};

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
      setProvider: (p) => set({ provider: p, planModel: PROVIDER_DEFAULTS[p].planModel, narrateModel: PROVIDER_DEFAULTS[p].narrateModel, fallbackModel: PROVIDER_DEFAULTS[p].fallbackModel, whisperModel: PROVIDER_DEFAULTS[p].whisperModel, hasKey: false }),
      reset: () => set({ ...defaults }),
    }),
    { name: 'stocksense-settings', version: 1 },
  ),
);

export const settings = (): SettingsStore => useSettings.getState();

export function applyTheme(theme: Settings['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0f14' : '#0f766e');
  // Android draws the app edge to edge: keep status/navigation bar icons readable on the app background.
  if (Capacitor.isNativePlatform()) void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}
