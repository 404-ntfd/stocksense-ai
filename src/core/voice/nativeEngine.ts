// Android's SpeechRecognizer through @capgo/capacitor-speech-recognition: free, low power, live partial results.
// Not verified on a physical phone in this build (see docs/PRODUCT_DOCUMENT.md, Known issues).
import type { PluginListenerHandle } from '@capacitor/core';
import type { EngineError, EngineEvent, SpeechEngine, Unsubscribe } from './controller';
import { Emitter } from './emitter';

const FATAL = /permission|not.?allowed|insufficient|unavailable|missing|not.?supported|language/i;

export class NativeEngine implements SpeechEngine {
  id = 'native' as const;
  private em = new Emitter();
  private handles: PluginListenerHandle[] = [];
  private lastPartial = '';
  private active = false;

  private async plugin() { return (await import('@capgo/capacitor-speech-recognition')).SpeechRecognition; }

  async available(): Promise<boolean> {
    try { return (await (await this.plugin()).available()).available; } catch { return false; }
  }
  /** 'granted' | 'denied' | 'prompt'. Asked only when the mic is first used. */
  async permission(request: boolean): Promise<string> {
    const p = await this.plugin();
    const st = request ? await p.requestPermissions() : await p.checkPermissions();
    return st.speechRecognition;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on(e: EngineEvent, cb: Function): Unsubscribe { return this.em.on(e, cb); }

  private async listen(): Promise<void> {
    if (this.handles.length) return;
    const p = await this.plugin();
    this.handles.push(await p.addListener('partialResults', (ev) => {
      const t = (ev.accumulatedText ?? ev.accumulated ?? ev.matches?.[0] ?? '').trim();
      if (t) { this.lastPartial = t; this.em.fire('partial', t); }
    }));
    this.handles.push(await p.addListener('segmentResults', (ev) => {
      const t = (ev.matches?.[0] ?? '').trim();
      this.lastPartial = '';
      if (t) this.em.fire('final', t);
    }));
    this.handles.push(await p.addListener('listeningState', (ev) => {
      if (ev.status === 'started') { this.em.fire('state', 'listening'); return; }
      if (ev.status === 'stopped') {
        if (this.lastPartial) { const t = this.lastPartial; this.lastPartial = ''; this.em.fire('final', t); }
        if (this.active) { this.active = false; this.em.fire('state', 'idle'); }
      }
    }));
    this.handles.push(await p.addListener('error', (ev) => {
      const fatal = FATAL.test(`${ev.code} ${ev.message}`);
      const message = /language|offline|model/i.test(ev.message) ? 'Speech recognition for this language is not available offline. Download offline English in Google settings, or type your question.'
        : fatal ? 'Speech recognition is not available on this phone. Switch to Whisper mode in Settings, or type your question.' : ev.message;
      this.em.fire('error', { code: ev.code, message, fatal } satisfies EngineError);
    }));
    this.handles.push(await p.addListener('audioLevel', (ev) => this.em.fire('level', Math.max(0, Math.min(1, ev.level > 1 ? ev.level / 10 : ev.level)))));
  }

  start(opts: { lang: string; continuous: boolean }): void {
    void (async () => {
      try {
        const p = await this.plugin();
        await this.listen();
        this.lastPartial = '';
        this.active = true;
        // partialResults:true makes start() resolve at once; text then arrives through the listeners above
        await p.start({ language: opts.lang, maxResults: 3, partialResults: true, popup: false, muteRecognizerBeep: opts.continuous });
      } catch (e) {
        this.active = false;
        const msg = e instanceof Error ? e.message : String(e);
        this.em.fire('error', { code: 'start_failed', message: FATAL.test(msg) ? 'Speech recognition is not available on this phone. Switch to Whisper mode in Settings, or type your question.' : msg, fatal: FATAL.test(msg) } satisfies EngineError);
        this.em.fire('state', 'idle');
      }
    })();
  }

  async stop(): Promise<string> {
    this.active = false;
    let tail = '';
    try {
      const p = await this.plugin();
      await p.stop();
      tail = this.lastPartial;
    } catch { /* already stopped */ }
    this.lastPartial = '';
    for (const h of this.handles) { try { await h.remove(); } catch { /* ignore */ } }
    this.handles = [];
    return tail;
  }
}
