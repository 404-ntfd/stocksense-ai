// Voice controller: one state machine over any SpeechEngine.
//   tap-to-talk: stops at the end of the utterance and submits after a short silence
//   continuous dictation: the mic stays on across pauses; every final segment is appended and nothing is
//     submitted until the user taps Send. Recognisers end their session after each silence, so the controller
//     restarts them within 250 ms, backs off when errors repeat, and always stops after 60 s of silence
//     or 10 minutes in total.
export type Unsubscribe = () => void;
export type EngineEvent = 'partial' | 'final' | 'error' | 'state' | 'level';
export interface EngineError { code: string; message: string; fatal: boolean }

export interface SpeechEngine {
  id: 'native' | 'webspeech' | 'whisper' | 'mock';
  available(): Promise<boolean>;
  start(opts: { lang: string; continuous: boolean }): void;
  /** Stops capture and resolves with any text that was still pending. */
  stop(): Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on(e: EngineEvent, cb: Function): Unsubscribe;
}

export type VoiceState = 'idle' | 'listening' | 'restarting' | 'stopping';
export interface VoiceSnapshot {
  state: VoiceState;
  mode: 'tap' | 'continuous';
  /** Finalised text so far. */
  text: string;
  /** Words still being recognised (shown greyed out). */
  partial: string;
  level: number;
  startedAt: number;
  engine: string;
  error: string | null;
  restarts: number;
}
export interface VoiceOptions {
  lang: string;
  autoSendMs: number;
  silenceStopMs: number;
  maxTotalMs: number;
  restartDelayMs: number;
  onUpdate: (s: VoiceSnapshot) => void;
  /** Tap-to-talk finished an utterance: the transcript should be sent. */
  onSubmit: (text: string) => void;
  /** Continuous mode ended on its own (silence, time cap or repeated errors). */
  onAutoStop?: (reason: 'silence' | 'max' | 'errors' | 'fatal', text: string) => void;
  now?: () => number;
}

export const VOICE_DEFAULTS = { autoSendMs: 1200, silenceStopMs: 60_000, maxTotalMs: 10 * 60_000, restartDelayMs: 250 };

const join = (a: string, b: string): string => (a && b ? `${a.replace(/\s+$/, '')} ${b.replace(/^\s+/, '')}` : a || b).trim();

export class VoiceController {
  private s: VoiceSnapshot;
  private offs: Unsubscribe[] = [];
  private wanted = false;
  private timers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
  private errorTimes: number[] = [];
  private lastActivity = 0;
  private now: () => number;

  constructor(private engine: SpeechEngine, private opts: VoiceOptions) {
    this.now = opts.now ?? Date.now;
    this.s = { state: 'idle', mode: 'tap', text: '', partial: '', level: 0, startedAt: 0, engine: engine.id, error: null, restarts: 0 };
  }

  get snapshot(): VoiceSnapshot { return this.s; }
  private emit(patch: Partial<VoiceSnapshot>): void { this.s = { ...this.s, ...patch }; this.opts.onUpdate(this.s); }
  private clear(name?: string): void {
    for (const k of name ? [name] : Object.keys(this.timers)) { if (this.timers[k]) clearTimeout(this.timers[k]); this.timers[k] = undefined; }
  }
  private timer(name: string, ms: number, fn: () => void): void { this.clear(name); this.timers[name] = setTimeout(fn, ms); }

  start(mode: 'tap' | 'continuous', initialText = ''): void {
    if (this.s.state !== 'idle') return;
    this.wanted = true;
    this.errorTimes = [];
    this.lastActivity = this.now();
    this.offs = [
      this.engine.on('partial', (t: string) => this.onPartial(t)),
      this.engine.on('final', (t: string) => this.onFinal(t)),
      this.engine.on('error', (e: EngineError) => this.onError(e)),
      this.engine.on('state', (st: 'listening' | 'idle') => this.onEngineState(st)),
      this.engine.on('level', (l: number) => { if (this.s.state === 'listening') this.emit({ level: Math.max(0, Math.min(1, l)) }); }),
    ];
    this.emit({ state: 'listening', mode, text: initialText.trim(), partial: '', level: 0, startedAt: this.now(), error: null, restarts: 0, engine: this.engine.id });
    this.timer('max', this.opts.maxTotalMs, () => void this.autoStop('max'));
    this.armSilence();
    this.engine.start({ lang: this.opts.lang, continuous: mode === 'continuous' });
  }

  private armSilence(): void {
    if (this.s.mode !== 'continuous') { this.timer('silence', 15_000, () => { if (!this.s.text && !this.s.partial) void this.autoStop('silence'); }); return; }
    this.timer('silence', this.opts.silenceStopMs, () => void this.autoStop('silence'));
  }

  private onPartial(t: string): void {
    if (!this.wanted || !t) return;
    this.lastActivity = this.now();
    this.clear('send');
    this.armSilence();
    this.emit({ partial: t });
  }

  private onFinal(t: string): void {
    if (!this.wanted) return;
    const clean = (t ?? '').trim();
    if (!clean) { this.emit({ partial: '' }); return; }
    this.lastActivity = this.now();
    this.armSilence();
    this.emit({ text: join(this.s.text, clean), partial: '' });
    if (this.s.mode === 'tap') this.timer('send', this.opts.autoSendMs, () => void this.finishTap());
  }

  private async finishTap(): Promise<void> {
    const text = await this.stop();
    if (text) this.opts.onSubmit(text);
  }

  private onEngineState(st: 'listening' | 'idle'): void {
    if (!this.wanted) return;
    if (st === 'listening') { if (this.s.state === 'restarting') this.emit({ state: 'listening' }); return; }
    // the recogniser ended its session (it does after every pause)
    if (this.s.partial) this.emit({ text: join(this.s.text, this.s.partial), partial: '' });
    if (this.s.mode === 'tap') {
      if (this.s.text) { if (!this.timers.send) this.timer('send', Math.min(this.opts.autoSendMs, 300), () => void this.finishTap()); }
      else void this.autoStop('silence');
      return;
    }
    this.restart();
  }

  private restart(): void {
    if (!this.wanted || this.s.mode !== 'continuous') return;
    this.emit({ state: 'restarting', level: 0, restarts: this.s.restarts + 1 });
    this.timer('restart', this.opts.restartDelayMs, () => {
      if (!this.wanted) return;
      this.engine.start({ lang: this.opts.lang, continuous: true });
      this.emit({ state: 'listening' });
    });
  }

  private onError(e: EngineError): void {
    if (!this.wanted) return;
    if (e.fatal) { this.emit({ error: e.message }); void this.autoStop('fatal'); return; }
    const t = this.now();
    this.errorTimes = [...this.errorTimes.filter((x) => t - x < 10_000), t];
    if (this.errorTimes.length >= 3) { // a restart loop must never spin
      this.emit({ error: 'The microphone keeps failing. Dictation was stopped; your text is kept.' });
      void this.autoStop('errors');
    }
    // otherwise wait for the engine's own "idle" state, which triggers the restart
  }

  private async autoStop(reason: 'silence' | 'max' | 'errors' | 'fatal'): Promise<void> {
    if (this.s.state === 'idle' || this.s.state === 'stopping') return;
    const text = await this.stop();
    this.opts.onAutoStop?.(reason, text);
  }

  /** Stops listening and returns the full transcript. Safe to call in any state. */
  async stop(): Promise<string> {
    if (this.s.state === 'idle') return this.s.text;
    this.wanted = false;
    this.clear();
    this.emit({ state: 'stopping', level: 0 });
    let tail = '';
    try { tail = (await this.engine.stop()) ?? ''; } catch { /* the engine was already stopped */ }
    for (const off of this.offs) off();
    this.offs = [];
    const text = join(join(this.s.text, this.s.partial && !tail.includes(this.s.partial) ? this.s.partial : ''), tail.trim());
    this.emit({ state: 'idle', text, partial: '', level: 0 });
    return text;
  }

  setText(text: string): void { this.emit({ text }); }
  dispose(): void { void this.stop(); }
}

/** A scriptable engine: drives the controller in unit tests, and stands in for the microphone in E2E tests. */
export class ScriptedEngine implements SpeechEngine {
  id = 'mock' as const;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private handlers = new Map<EngineEvent, Set<Function>>();
  starts = 0;
  running = false;
  pendingTail = '';
  async available(): Promise<boolean> { return true; }
  start(): void { this.starts++; this.running = true; this.fire('state', 'listening'); }
  async stop(): Promise<string> { this.running = false; const t = this.pendingTail; this.pendingTail = ''; return t; }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on(e: EngineEvent, cb: Function): Unsubscribe {
    if (!this.handlers.has(e)) this.handlers.set(e, new Set());
    this.handlers.get(e)!.add(cb);
    return () => this.handlers.get(e)?.delete(cb);
  }
  fire(e: EngineEvent, payload?: unknown): void { for (const cb of [...(this.handlers.get(e) ?? [])]) cb(payload); }
  /** Simulates one spoken phrase followed by the recogniser ending its session. */
  say(text: string, endSession = true): void { this.fire('partial', text); this.fire('final', text); if (endSession) { this.running = false; this.fire('state', 'idle'); } }
}
