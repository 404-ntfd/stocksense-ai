import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptedEngine, VoiceController, type VoiceSnapshot } from '@/core/voice/controller';

function setup(mode: 'tap' | 'continuous') {
  const engine = new ScriptedEngine();
  const submits: string[] = [];
  const stops: Array<[string, string]> = [];
  let snap: VoiceSnapshot | null = null;
  const c = new VoiceController(engine, { lang: 'en-IN', autoSendMs: 1200, silenceStopMs: 60_000, maxTotalMs: 600_000, restartDelayMs: 250,
    onUpdate: (s) => { snap = s; }, onSubmit: (t) => submits.push(t), onAutoStop: (r, t) => stops.push([r, t]) });
  c.start(mode);
  return { engine, c, submits, stops, snap: () => snap! };
}

describe('voice controller', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('tap-to-talk submits after the utterance and a short silence', async () => {
    const { engine, submits, snap } = setup('tap');
    engine.fire('partial', 'total sales');
    expect(snap().partial).toBe('total sales');
    engine.say('total sales last month');
    await vi.advanceTimersByTimeAsync(1300);
    expect(submits).toEqual(['total sales last month']);
    expect(snap().state).toBe('idle');
    expect(engine.starts).toBe(1);
  });

  it('continuous dictation restarts after each pause and keeps every segment', async () => {
    const { engine, c, submits } = setup('continuous');
    const parts = ['received twenty packets of sugar', 'and ten packets of salt', 'and five bottles of oil'];
    for (const p of parts) { engine.say(p); await vi.advanceTimersByTimeAsync(300); }
    expect(engine.starts).toBe(4); // first start + one restart after each segment
    expect(submits).toEqual([]); // nothing is sent until the user taps Send
    const text = await c.stop();
    expect(text).toBe(parts.join(' '));
  });

  it('continuous dictation survives 2+ minutes of speech with pauses', async () => {
    const { engine, c } = setup('continuous');
    for (let i = 0; i < 40; i++) { engine.say(`segment ${i}`); await vi.advanceTimersByTimeAsync(3500); }
    const text = await c.stop();
    expect(text.split('segment').length - 1).toBe(40);
  });

  it('stops after 60 s of silence', async () => {
    const { engine, stops, snap } = setup('continuous');
    engine.say('hello');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(stops[0]?.[0]).toBe('silence');
    expect(snap().state).toBe('idle');
    expect(snap().text).toBe('hello');
  });

  it('stops after 10 minutes in total', async () => {
    const { engine, stops } = setup('continuous');
    for (let i = 0; i < 25; i++) { engine.say(`x${i}`); await vi.advanceTimersByTimeAsync(25_000); }
    expect(stops[0]?.[0]).toBe('max');
  });

  it('backs off when the recogniser keeps failing (no spin loop)', async () => {
    const { engine, stops } = setup('continuous');
    for (let i = 0; i < 3; i++) { engine.fire('error', { code: 'busy', message: 'busy', fatal: false }); engine.fire('state', 'idle'); await vi.advanceTimersByTimeAsync(300); }
    expect(stops[0]?.[0]).toBe('errors');
    const starts = engine.starts;
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.starts).toBe(starts);
  });

  it('a fatal error (permission denied) stops immediately with a message', async () => {
    const { engine, stops, snap } = setup('tap');
    engine.fire('error', { code: 'not-allowed', message: 'Microphone access was blocked.', fatal: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(stops[0]?.[0]).toBe('fatal');
    expect(snap().error).toMatch(/blocked/);
  });

  it('keeps text that was still being recognised when stopped', async () => {
    const { engine, c } = setup('continuous');
    engine.say('first');
    await vi.advanceTimersByTimeAsync(300);
    engine.fire('partial', 'second part');
    expect(await c.stop()).toBe('first second part');
  });
});
