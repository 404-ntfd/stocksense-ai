// Picks the speech engine: native on Android, Web Speech in Chrome/Edge, Whisper as manual or automatic fallback.
// E2E tests can install a scripted engine on window.__SS_MOCK_SPEECH__ to drive the microphone.
import { ScriptedEngine, type SpeechEngine } from '@/core/voice/controller';
import { NativeEngine } from '@/core/voice/nativeEngine';
import { WebSpeechEngine } from '@/core/voice/webSpeechEngine';
import { WhisperEngine } from '@/core/voice/whisperEngine';
import { isNative } from '@/core/util/platform';
import { getProvider } from './services';
import { settings } from './settings';

declare global { interface Window { __SS_MOCK_SPEECH__?: ScriptedEngine | boolean } }

export async function pickEngine(): Promise<{ engine: SpeechEngine; note?: string } | { engine: null; reason: string }> {
  if (typeof window !== 'undefined' && window.__SS_MOCK_SPEECH__) {
    if (!(window.__SS_MOCK_SPEECH__ instanceof ScriptedEngine)) window.__SS_MOCK_SPEECH__ = new ScriptedEngine();
    return { engine: window.__SS_MOCK_SPEECH__ };
  }
  const pref = settings().voiceEngine;
  const whisper = new WhisperEngine(getProvider, () => settings().whisperModel, () => settings().businessName || '');
  if (pref === 'whisper') return (await whisper.available()) ? { engine: whisper } : { engine: null, reason: 'Whisper mode needs a Groq key in Settings and microphone access.' };
  if (isNative() && (pref === 'auto' || pref === 'native')) {
    const n = new NativeEngine();
    if (await n.available()) {
      const perm = await n.permission(true).catch(() => 'denied');
      if (perm !== 'granted') return { engine: null, reason: 'Microphone permission is off. Allow it in Android Settings → Apps → StockSense AI → Permissions, or type your question.' };
      return { engine: n };
    }
    if (await whisper.available()) return { engine: whisper, note: 'No speech service on this phone, so Whisper mode is used.' };
    return { engine: null, reason: 'This phone has no speech recognition service. Add a Groq key to use Whisper mode, or type your question.' };
  }
  const w = new WebSpeechEngine();
  if (pref !== 'native' && (await w.available())) return { engine: w };
  if (await whisper.available()) return { engine: whisper, note: 'This browser has no built-in speech recognition, so Whisper mode is used.' };
  return { engine: null, reason: 'Voice needs Chrome or Edge, or a Groq key for Whisper mode. You can type your question instead.' };
}
