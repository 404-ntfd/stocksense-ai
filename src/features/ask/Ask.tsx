import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, KeyRound, Mic, RotateCcw, Send, Square, Trash2, WifiOff } from 'lucide-react';
import { db } from '@/core/db/client';
import { toTurn } from '@/core/ask/pipeline';
import { OFFLINE_EXAMPLES } from '@/core/ai/intents/engine';
import type { ActionCard } from '@/core/ask/actions';
import { VOICE_DEFAULTS, VoiceController, type VoiceSnapshot } from '@/core/voice/controller';
import { MAX_QUESTION_CHARS } from '@/core/ai/plan';
import { haptic } from '@/core/util/platform';
import { askPipeline, speak, stopSpeaking } from '@/app/services';
import { pickEngine } from '@/app/voice';
import { useSettings } from '@/app/settings';
import { toast, useApp } from '@/app/store';
import { Button, Card, Chip, cx, IconButton, Spinner, Toggle } from '@/app/ui';
import { AnswerView, FollowupChips } from './AnswerView';
import { useChat, type Message } from './chat';

const STAGE: Record<string, string> = { understanding: 'Understanding…', thinking: 'Asking the AI…', querying: 'Looking at your data…', repairing: 'Fixing the query…', forecasting: 'Estimating from past sales…', writing: 'Writing the answer…' };
const fmtTime = (ms: number): string => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function Ask() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const s = useSettings();
  const online = useApp((x) => x.online);
  const bump = useApp((x) => x.bumpData);
  const setMicLive = useApp((x) => x.setMicLive);
  const { messages, history, push, update, remove, addTurn, clear } = useChat();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<VoiceSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const ctl = useRef<VoiceController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listening = !!voice && voice.state !== 'idle';

  useEffect(() => { setMicLive(listening); }, [listening, setMicLive]);
  useEffect(() => () => setMicLive(false), [setMicLive]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages.length, busy]);
  useEffect(() => { if (!listening) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [listening]);
  useEffect(() => () => { void ctl.current?.stop(); void stopSpeaking(); }, []);
  useEffect(() => {
    const onPause = (): void => { void ctl.current?.stop(); };
    window.addEventListener('stocksense:pause', onPause);
    return () => window.removeEventListener('stocksense:pause', onPause);
  }, []);

  const ask = useCallback(async (raw: string): Promise<void> => {
    const q = raw.trim();
    if (!q || busy) return;
    if (q.length > MAX_QUESTION_CHARS) toast('That is very long: only the first 2,000 characters are used.', 'info');
    setText('');
    push({ kind: 'user', text: q });
    const pid = push({ kind: 'pending', stage: 'Understanding…' });
    setBusy(true);
    try {
      for await (const ev of askPipeline().ask({ text: q, lang: s.lang, history })) {
        if (ev.type === 'stage') update(pid, { stage: STAGE[ev.stage] ?? '…' } as Partial<Message>);
        else if (ev.type === 'answer') {
          remove(pid); push({ kind: 'answer', answer: ev.answer }); addTurn(toTurn(ev.answer));
          if (s.readAloud) void speak(ev.answer.text, s.lang);
        } else if (ev.type === 'action') { remove(pid); push({ kind: 'action', card: ev.card, status: 'open' }); }
        else if (ev.type === 'clarify') { remove(pid); push({ kind: 'clarify', question: ev.question, options: ev.options }); }
        else if (ev.type === 'error') { remove(pid); push({ kind: 'error', code: ev.code, message: ev.message, suggestions: ev.suggestions }); }
      }
    } catch (e) {
      remove(pid);
      push({ kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e), suggestions: [] });
    } finally { setBusy(false); }
  }, [busy, history, push, update, remove, addTurn, s.lang, s.readAloud]);

  // questions handed over from other screens (?q=...)
  useEffect(() => {
    const q = params.get('q');
    if (q) { setParams({}, { replace: true }); void ask(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const toggleRef = useRef<() => void>(() => {});
  toggleRef.current = () => { void (listening ? stopVoice() : busy ? Promise.resolve() : startVoice()); };
  useEffect(() => {
    const h = (): void => toggleRef.current();
    window.addEventListener('stocksense:mic', h);
    return () => window.removeEventListener('stocksense:mic', h);
  }, []);

  async function startVoice(): Promise<void> {
    void stopSpeaking();
    const picked = await pickEngine();
    if (!picked.engine) { toast(picked.reason, 'error'); inputRef.current?.focus(); return; }
    if (picked.note) toast(picked.note, 'info');
    void haptic();
    const c = new VoiceController(picked.engine, {
      lang: s.lang, autoSendMs: s.autoSendMs, silenceStopMs: VOICE_DEFAULTS.silenceStopMs, maxTotalMs: VOICE_DEFAULTS.maxTotalMs, restartDelayMs: VOICE_DEFAULTS.restartDelayMs,
      onUpdate: (snap) => { setVoice(snap); if (snap.state === 'idle') setText(snap.text); },
      onSubmit: (t) => { setVoice(null); void ask(t); },
      onAutoStop: (reason, t) => { setText(t); toast(reason === 'silence' ? (t ? 'Stopped listening after a long pause. Edit and send when ready.' : 'I did not hear anything.') : reason === 'max' ? 'Dictation stops after 10 minutes. Your text is kept.' : 'The microphone stopped. Your text is kept.', 'info'); },
    });
    ctl.current = c;
    c.start(s.continuous ? 'continuous' : 'tap', s.continuous ? text : '');
  }
  async function stopVoice(): Promise<void> {
    const c = ctl.current;
    if (!c) return;
    void haptic();
    const t = await c.stop();
    setVoice(null);
    setText(t);
    if (!s.continuous && t) void ask(t); // tap-to-talk: Stop means "done, send it"
  }

  async function confirmAction(id: number, card: ActionCard): Promise<void> {
    try {
      let result = '';
      if (card.kind === 'purchase') { await db.savePurchase({ product_id: card.productId!, qty: card.qty!, unit_cost: card.unitAmount ?? null, date: card.date, supplier: card.party ?? null }); result = 'Stock added'; }
      else if (card.kind === 'sale') { await db.saveSale({ product_id: card.productId!, qty: card.qty!, unit_price: card.unitAmount ?? null, date: card.date, customer: card.party ?? null }); result = 'Sale recorded'; }
      else if (card.kind === 'price') { await db.updatePrice(card.productId!, card.unitAmount!); result = 'Price updated'; }
      else if (card.kind === 'count' || card.kind === 'damage') { const n = await db.adjustStock(card.productId!, card.kind, card.qty!, 'By voice', card.date); result = `Stock is now ${n}`; }
      else if (card.kind === 'expense') { await db.saveExpense({ date: card.date, category: card.category!, amount: card.amount! }); result = 'Expense recorded'; }
      update(id, { status: 'done', result } as Partial<Message>);
      bump(); void haptic();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save', 'error'); }
  }

  const empty = messages.length === 0;
  return (
    <div className="h-full flex flex-col" data-testid="page-ask">
      <div className="flex items-center justify-between pb-2">
        <h1 className="text-2xl font-bold">Ask</h1>
        {!empty && <IconButton label="Clear conversation" onClick={clear}><Trash2 className="size-5" /></IconButton>}
      </div>
      {!s.hasKey && (
        <button type="button" onClick={() => nav('/settings')} className="mb-2 rounded-xl bg-info-soft text-info px-3 py-2.5 text-left text-sm flex gap-2 items-center" data-testid="banner-no-key">
          <KeyRound className="size-4 shrink-0" aria-hidden /> Common questions work offline. Add a free Groq key in Settings to ask anything.
        </button>
      )}
      {!online && <div className="mb-2 rounded-xl bg-warn-soft text-warn px-3 py-2.5 text-sm flex gap-2 items-center" data-testid="banner-offline"><WifiOff className="size-4 shrink-0" aria-hidden /> You're offline, so I can only answer the common questions.</div>}

      <div className="flex-1 overflow-y-auto -mx-4 px-4 pb-4 space-y-3" aria-live="polite" data-testid="chat">
        {empty && (
          <div className="pt-4">
            <p className="text-muted mb-3">Tap the mic and ask about your sales, stock, profit or what to reorder. Or try one of these:</p>
            <div className="flex flex-wrap gap-2">{OFFLINE_EXAMPLES.slice(0, 10).map((q) => <Chip key={q} onClick={() => void ask(q)} testId="suggestion">{q}</Chip>)}</div>
            <p className="text-sm text-muted mt-4">You can also make changes, for example "sold 2 Sugar 1kg at 46" or "received 24 Tata Salt 1kg". You will always be asked to confirm first.</p>
          </div>
        )}
        {messages.map((m) => {
          if (m.kind === 'user') return <div key={m.id} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent text-accent-ink px-4 py-2.5 whitespace-pre-wrap break-words" data-testid="user-msg">{m.text}</div></div>;
          if (m.kind === 'pending') return <div key={m.id}><Card className="!py-3"><Spinner label={m.stage} /></Card></div>;
          if (m.kind === 'answer') return <Card key={m.id}><AnswerView answer={m.answer} /><FollowupChips items={m.answer.followups} onPick={(q) => void ask(q)} /></Card>;
          if (m.kind === 'clarify') return <Card key={m.id} testId="clarify"><p className="font-medium">{m.question}</p><FollowupChips items={m.options} onPick={(q) => void ask(q)} /></Card>;
          if (m.kind === 'error') return (
            <Card key={m.id} testId="ask-error" className={m.code === 'no_key' || m.code === 'offline' ? '' : '!border-neg/40'}>
              <div className="flex gap-2"><AlertCircle className={cx('size-5 shrink-0 mt-0.5', m.code === 'no_key' || m.code === 'offline' ? 'text-info' : 'text-neg')} aria-hidden /><p>{m.message}</p></div>
              {m.code === 'no_key' && <Button size="sm" variant="secondary" className="mt-2" onClick={() => nav('/settings')}>Add a key</Button>}
              {m.suggestions.length > 0 && <><p className="text-sm text-muted mt-3">Questions I can answer:</p><FollowupChips items={m.suggestions} onPick={(q) => void ask(q)} /></>}
            </Card>
          );
          return (
            <Card key={m.id} testId="action-card" className="!border-accent">
              <p className="text-sm font-semibold text-accent mb-1">Confirm this change</p>
              <p className="text-base" data-testid="action-summary">{m.card.summary}</p>
              {m.card.didYouMean && <p className="text-sm text-muted mt-1">Matched product: <b>{m.card.didYouMean}</b></p>}
              {m.status === 'open' ? (
                <div className="flex gap-2 mt-3">
                  <Button onClick={() => void confirmAction(m.id, m.card)} data-testid="action-confirm">Confirm</Button>
                  <Button variant="secondary" onClick={() => update(m.id, { status: 'cancelled' } as Partial<Message>)}>Cancel</Button>
                </div>
              ) : <p className={cx('mt-2 font-semibold', m.status === 'done' ? 'text-pos' : 'text-muted')} data-testid="action-status">{m.status === 'done' ? `✓ ${m.result}` : 'Cancelled, nothing was changed.'}</p>}
            </Card>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="shrink-0 border-t border-line bg-bg -mx-4 px-4 pt-2" style={{ paddingBottom: 'calc(5rem + var(--sab))' }} data-testid="composer">
        {listening && voice && (
          <div className="mb-2 rounded-2xl bg-surface border border-line p-3" data-testid="live-transcript">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="flex items-center gap-2 font-semibold text-neg"><span className="size-2.5 rounded-full bg-neg animate-pulse" />{voice.state === 'restarting' ? 'Still listening…' : 'Listening'}{voice.mode === 'continuous' ? ' · continuous' : ''}</span>
              <span className="num text-muted">{fmtTime(now - voice.startedAt)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface2 overflow-hidden mb-2" aria-hidden><div className="h-full bg-neg transition-[width] duration-150" style={{ width: `${Math.round(voice.level * 100)}%` }} /></div>
            <p className="min-h-6"><span>{voice.text}</span>{voice.partial && <span className="text-muted"> {voice.partial}</span>}{!voice.text && !voice.partial && <span className="text-muted">Speak now…</span>}</p>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={listening ? '' : 'Ask about sales, stock, profit…'} disabled={listening} aria-label="Question"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text); } }} data-testid="ask-input"
            className="flex-1 min-h-12 max-h-36 rounded-2xl border border-line bg-surface px-4 py-3 resize-none focus:border-accent focus:outline-none" />
          {text.trim() && !listening ? (
            <button type="button" aria-label="Send" onClick={() => void ask(text)} disabled={busy} className="size-12 shrink-0 rounded-full bg-accent text-accent-ink flex items-center justify-center disabled:opacity-50" data-testid="ask-send"><Send className="size-5" /></button>
          ) : null}
          <button type="button" aria-label={listening ? (voice?.mode === 'continuous' ? 'Stop dictation' : 'Stop and send') : 'Start voice input'} onClick={() => void (listening ? stopVoice() : startVoice())} disabled={busy && !listening}
            className={cx('hidden md:flex size-14 shrink-0 rounded-full items-center justify-center shadow-md disabled:opacity-50', listening ? 'bg-neg text-white mic-live' : 'bg-ink text-bg')} data-testid="mic-desktop">
            {listening ? <Square className="size-6" /> : <Mic className="size-7" />}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1"><Toggle label="Continuous dictation" checked={s.continuous} onChange={(v) => s.set({ continuous: v })} testId="continuous-toggle" /></div>
          {listening && voice?.mode === 'continuous' && voice.text && <Button size="sm" icon={<Send className="size-4" />} onClick={async () => { const t = await ctl.current?.stop(); setVoice(null); if (t) void ask(t); }} data-testid="dictation-send">Send</Button>}
          {!listening && history.length > 0 && <IconButton label="Ask again" onClick={() => void ask(history[history.length - 1].question)}><RotateCcw className="size-5" /></IconButton>}
        </div>
      </div>
    </div>
  );
}
