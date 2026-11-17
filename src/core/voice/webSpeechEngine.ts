// Web Speech API (Chrome and Edge on desktop and Android Chrome). Needs a network connection.
import type { EngineError, EngineEvent, SpeechEngine, Unsubscribe } from './controller';
import { Emitter } from './emitter';

interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRInstance {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SRInstance;
const ctor = (): SRCtor | null => {
  const w = globalThis as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export class WebSpeechEngine implements SpeechEngine {
  id = 'webspeech' as const;
  private em = new Emitter();
  private rec: SRInstance | null = null;
  private interim = '';

  async available(): Promise<boolean> { return !!ctor(); }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on(e: EngineEvent, cb: Function): Unsubscribe { return this.em.on(e, cb); }

  start(opts: { lang: string; continuous: boolean }): void {
    const C = ctor();
    if (!C) { this.em.fire('error', { code: 'unsupported', message: 'This browser has no speech recognition. Use Chrome or Edge, or switch to Whisper mode in Settings.', fatal: true } satisfies EngineError); this.em.fire('state', 'idle'); return; }
    const rec = new C();
    this.rec = rec;
    this.interim = '';
    rec.lang = opts.lang;
    rec.continuous = opts.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => this.em.fire('state', 'listening');
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) { this.interim = ''; this.em.fire('final', t.trim()); } else interim += t;
      }
      if (interim) { this.interim = interim.trim(); this.em.fire('partial', this.interim); }
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // just a pause: onend follows
      const fatal = e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture' || e.error === 'language-not-supported';
      const message = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone access was blocked. Allow the microphone for this site, or type your question.'
        : e.error === 'audio-capture' ? 'No microphone was found.' : e.error === 'network' ? 'Speech recognition needs an internet connection. Type your question instead.' : `Speech recognition error: ${e.error}`;
      this.em.fire('error', { code: e.error, message, fatal: fatal || e.error === 'network' } satisfies EngineError);
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      if (this.interim) { const t = this.interim; this.interim = ''; this.em.fire('final', t); }
      this.em.fire('state', 'idle');
    };
    try { rec.start(); } catch (err) {
      this.rec = null;
      this.em.fire('error', { code: 'start_failed', message: err instanceof Error ? err.message : 'Could not start the microphone.', fatal: false } satisfies EngineError);
      this.em.fire('state', 'idle');
    }
  }

  async stop(): Promise<string> {
    const rec = this.rec;
    this.rec = null;
    const tail = this.interim;
    this.interim = '';
    if (rec) { rec.onresult = null; rec.onend = null; rec.onerror = null; try { rec.stop(); } catch { /* not running */ } }
    return tail;
  }
}
