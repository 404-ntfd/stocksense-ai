// Whisper mode: records in the WebView/browser, cuts the audio at pauses with a simple RMS voice-activity
// detector (about 1 s of silence, 30 s maximum per chunk) and sends each chunk to the provider's
// /audio/transcriptions endpoint. Works where the system recogniser is missing (some Xiaomi/Huawei/AOSP builds).
import type { LlmProvider } from '../ai/types';
import type { EngineError, EngineEvent, SpeechEngine, Unsubscribe } from './controller';
import { Emitter } from './emitter';

export const WHISPER_LIMITS = { silenceMs: 1000, maxChunkMs: 30_000, minSpeechMs: 250, rmsThreshold: 0.018, maxChunksPerMinute: 15 };

export class WhisperEngine implements SpeechEngine {
  id = 'whisper' as const;
  private em = new Emitter();
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private raf: ReturnType<typeof setInterval> | null = null;
  private rec: MediaRecorder | null = null;
  private parts: Blob[] = [];
  private pending: Array<Promise<void>> = [];
  private sent: number[] = [];
  private listening = false;
  private lang = 'en';

  constructor(private provider: () => Promise<LlmProvider | null>, private model: () => string, private hint: () => string = () => '') {}

  async available(): Promise<boolean> {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && !!(await this.provider())?.transcribe;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on(e: EngineEvent, cb: Function): Unsubscribe { return this.em.on(e, cb); }

  start(opts: { lang: string; continuous: boolean }): void {
    this.lang = opts.lang.slice(0, 2);
    void this.begin();
  }

  private async begin(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (e) {
      const denied = (e as { name?: string })?.name === 'NotAllowedError';
      this.em.fire('error', { code: denied ? 'not-allowed' : 'audio-capture', message: denied ? 'Microphone access was blocked. Allow it in your phone or browser settings, or type your question.' : 'No microphone could be opened.', fatal: true } satisfies EngineError);
      this.em.fire('state', 'idle');
      return;
    }
    this.listening = true;
    this.em.fire('state', 'listening');
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC!();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let speechMs = 0, silenceMs = 0, chunkMs = 0;
    const STEP = 60;
    this.startRecorder();
    this.raf = setInterval(() => {
      if (!this.listening) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      this.em.fire('level', Math.min(1, rms * 8));
      chunkMs += STEP;
      if (rms > WHISPER_LIMITS.rmsThreshold) { speechMs += STEP; silenceMs = 0; } else silenceMs += STEP;
      const endOfPhrase = speechMs >= WHISPER_LIMITS.minSpeechMs && silenceMs >= WHISPER_LIMITS.silenceMs;
      if (endOfPhrase || chunkMs >= WHISPER_LIMITS.maxChunkMs) {
        const hadSpeech = speechMs >= WHISPER_LIMITS.minSpeechMs;
        speechMs = 0; silenceMs = 0; chunkMs = 0;
        this.cut(hadSpeech, true);
      }
    }, STEP);
  }

  private startRecorder(): void {
    if (!this.stream) return;
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    this.parts = [];
    this.rec = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data.size) this.parts.push(e.data); };
    this.rec.start();
  }

  /** Ends the current chunk; when it held speech it is transcribed, otherwise it is dropped (silence makes Whisper invent text). */
  private cut(hadSpeech: boolean, restart: boolean): Promise<void> {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') return Promise.resolve();
    const done = new Promise<void>((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.parts, { type: rec.mimeType || 'audio/webm' });
        if (restart && this.listening) this.startRecorder();
        if (!hadSpeech || blob.size < 1500) { resolve(); return; }
        void this.transcribe(blob).finally(resolve);
      };
    });
    rec.stop();
    this.pending.push(done);
    return done;
  }

  private async transcribe(blob: Blob): Promise<void> {
    const now = Date.now();
    this.sent = this.sent.filter((t) => now - t < 60_000);
    if (this.sent.length >= WHISPER_LIMITS.maxChunksPerMinute) await new Promise((r) => setTimeout(r, 60_000 - (now - this.sent[0])));
    this.sent.push(Date.now());
    this.em.fire('partial', '…');
    try {
      const p = await this.provider();
      if (!p?.transcribe) throw new Error('No API key is set for Whisper mode.');
      const text = await p.transcribe(blob, { model: this.model(), language: this.lang, prompt: this.hint() });
      this.em.fire('final', text);
    } catch (e) {
      this.em.fire('final', '');
      this.em.fire('error', { code: 'transcribe_failed', message: e instanceof Error ? e.message : 'Transcription failed.', fatal: false } satisfies EngineError);
    }
  }

  async stop(): Promise<string> {
    const wasListening = this.listening;
    this.listening = false;
    if (this.raf) { clearInterval(this.raf); this.raf = null; }
    if (wasListening) await this.cut(true, false);
    await Promise.allSettled(this.pending);
    this.pending = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try { await this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null;
    this.rec = null;
    return '';
  }
}
