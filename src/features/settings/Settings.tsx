import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronRight, ExternalLink, Lightbulb, XCircle } from 'lucide-react';
import evalScore from '@/core/ai/evalScore.json';
import { PROVIDER_DEFAULTS } from '@/core/ai/types';
import { LlmError } from '@/core/ai/types';
import { OpenAiCompatProvider } from '@/core/ai/providers/openaiCompat';
import { db } from '@/core/db/client';
import { getSecret, maskKey, setSecret } from '@/core/util/secrets';
import { chromeMajor, isNative, platform } from '@/core/util/platform';
import { formatDate } from '@/core/util/dates';
import { applyTheme, useSettings, type ProviderId, type VoiceEngineSetting } from '@/app/settings';
import { keyName } from '@/app/services';
import { useDb } from '@/app/hooks';
import { toast } from '@/app/store';
import { Button, Card, Field, Input, PageHeader, SectionTitle, Segmented, Select, Toggle } from '@/app/ui';

/** Paste-and-test for the API key. Shared by onboarding and settings. */
export function KeyField({ onTested }: { onTested?: (ok: boolean) => void }) {
  const s = useSettings();
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [state, setState] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; msg?: string }>({ status: 'idle' });
  useEffect(() => { void getSecret(keyName(s.provider)).then((k) => setSaved(k)); }, [s.provider]);

  async function test(): Promise<void> {
    const k = key.trim() || saved || '';
    if (!k) { setState({ status: 'fail', msg: 'Paste your key first.' }); return; }
    setState({ status: 'testing' });
    try {
      const p = new OpenAiCompatProvider(s.provider, PROVIDER_DEFAULTS[s.provider].baseUrl, () => k);
      const models = await p.listModels();
      await setSecret(keyName(s.provider), k);
      setSaved(k); setKey('');
      s.set({ hasKey: true });
      const missing = !models.includes(s.planModel);
      if (missing) { const alt = models.find((m) => /gpt-oss-120b|qwen|gemini.*flash/.test(m)); if (alt) s.set({ planModel: alt }); }
      setState({ status: 'ok', msg: `Key works. ${models.length} models available.${missing ? ' The default model was not offered, so another was chosen.' : ''}` });
      onTested?.(true);
    } catch (e) {
      const msg = e instanceof LlmError && e.kind === 'auth' ? 'That key was rejected. Copy it again from the provider\'s website.' : e instanceof Error ? e.message : String(e);
      setState({ status: 'fail', msg });
      onTested?.(false);
    }
  }
  async function removeKey(): Promise<void> { await setSecret(keyName(s.provider), null); setSaved(null); s.set({ hasKey: false }); setState({ status: 'idle' }); toast('Key removed', 'ok'); }
  return (
    <div data-testid="key-field">
      <Field label={`${s.provider === 'groq' ? 'Groq' : 'Gemini'} API key`} hint={saved ? `Saved: ${maskKey(saved)}. It stays on this device and is never included in backups or exports.` : 'Stored only on this device.'}>
        <div className="flex gap-2">
          <Input type="password" autoComplete="off" value={key} onChange={(e) => { setKey(e.target.value); setState({ status: 'idle' }); }} placeholder={saved ? 'Paste a new key to replace it' : s.provider === 'groq' ? 'gsk_…' : 'AIza…'} data-testid="api-key-input" />
          <Button onClick={test} busy={state.status === 'testing'} data-testid="api-key-test">Test</Button>
        </div>
      </Field>
      {state.status === 'ok' && <p className="flex items-center gap-2 text-pos font-medium -mt-1 mb-2" data-testid="key-ok"><CheckCircle2 className="size-5" aria-hidden />{state.msg}</p>}
      {state.status === 'fail' && <p className="flex items-center gap-2 text-neg font-medium -mt-1 mb-2" role="alert"><XCircle className="size-5" aria-hidden />{state.msg}</p>}
      <div className="flex gap-2 flex-wrap">
        <a href={PROVIDER_DEFAULTS[s.provider].keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 min-h-10 text-accent font-semibold">Get a free key <ExternalLink className="size-4" aria-hidden /></a>
        {saved && <Button size="sm" variant="ghost" onClick={removeKey}>Remove key</Button>}
      </div>
    </div>
  );
}

export function Settings() {
  const nav = useNavigate();
  const s = useSettings();
  const qa = useDb(() => db.qaLog(30), []);
  const stats = useDb(() => db.stats(), []);
  const [diag, setDiag] = useState(false);
  const score = evalScore as Record<string, { scorePct: number; passed: number; total: number; date: string; model: string } | undefined>;
  useEffect(() => { applyTheme(s.theme); }, [s.theme]);

  return (
    <div data-testid="page-settings">
      <PageHeader title="More" />
      <Card onClick={() => nav('/insights')} className="!p-4 flex items-center justify-between" testId="more-insights">
        <span className="flex items-center gap-3"><Lightbulb className="size-6 text-accent" aria-hidden /><span><span className="block font-bold">Insights</span><span className="text-sm text-muted">Reorder list, dead stock, ABC, busy days, expenses</span></span></span>
        <ChevronRight className="size-5 text-muted" aria-hidden />
      </Card>

      <SectionTitle>AI</SectionTitle>
      <Card>
        <Field label="Provider">
          <Segmented options={[{ value: 'groq', label: 'Groq (recommended)' }, { value: 'gemini', label: 'Gemini' }]} value={s.provider} onChange={(p: ProviderId) => { s.setProvider(p); void getSecret(keyName(p)).then((k) => s.set({ hasKey: !!k })); }} />
        </Field>
        <KeyField />
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold min-h-10 flex items-center">Models</summary>
          <Field label="Question → SQL model"><Input value={s.planModel} onChange={(e) => s.set({ planModel: e.target.value.trim() })} /></Field>
          <Field label="Answer-writing model"><Input value={s.narrateModel} onChange={(e) => s.set({ narrateModel: e.target.value.trim() })} /></Field>
          <Field label="Fallback model" hint="Used automatically if the main model is retired"><Input value={s.fallbackModel} onChange={(e) => s.set({ fallbackModel: e.target.value.trim() })} /></Field>
          {s.provider === 'groq' && <Field label="Whisper model"><Input value={s.whisperModel} onChange={(e) => s.set({ whisperModel: e.target.value.trim() })} /></Field>}
          <Button size="sm" variant="secondary" onClick={() => s.setProvider(s.provider)}>Reset to defaults</Button>
        </details>
        <Toggle label="Privacy mode" hint="Never send data values or results to the AI. Only the question and the table layout are sent; answers use local wording." checked={s.privacyMode} onChange={(v) => s.set({ privacyMode: v })} testId="privacy-toggle" />
        <Toggle label="AI-written answers" hint="Let the AI phrase the answer sentence. Every number is checked against the result; if one does not match, a local sentence is used." checked={s.aiNarration} onChange={(v) => s.set({ aiNarration: v })} />
      </Card>

      <SectionTitle>Voice</SectionTitle>
      <Card>
        <Field label="Speech engine" hint={isNative() ? 'Auto uses the phone\'s speech service, and Whisper if there is none.' : 'Auto uses the browser\'s speech recognition (Chrome/Edge), and Whisper if there is none.'}>
          <Select value={s.voiceEngine} onChange={(e) => s.set({ voiceEngine: e.target.value as VoiceEngineSetting })} data-testid="voice-engine">
            <option value="auto">Auto</option>
            {isNative() ? <option value="native">Phone speech service</option> : <option value="webspeech">Browser speech recognition</option>}
            <option value="whisper">Whisper (Groq, needs a key)</option>
          </Select>
        </Field>
        <Field label="Language">
          <Select value={s.lang} onChange={(e) => s.set({ lang: e.target.value })}>
            <option value="en-IN">English (India)</option><option value="en-US">English (US)</option>
            {s.hindiLab && <option value="hi-IN">Hindi (experimental)</option>}
          </Select>
        </Field>
        <Toggle label="Continuous dictation" hint="Keep the mic on across pauses; nothing is sent until you tap Send. Stops after 60 s of silence or 10 minutes." checked={s.continuous} onChange={(v) => s.set({ continuous: v })} />
        <Field label={`Auto-send after a pause: ${(s.autoSendMs / 1000).toFixed(1)} s`} hint="Tap-to-talk mode only">
          <input type="range" min={600} max={3000} step={100} value={s.autoSendMs} onChange={(e) => s.set({ autoSendMs: Number(e.target.value) })} className="w-full accent-[var(--accent)] min-h-10" aria-label="Auto-send delay" />
        </Field>
        <Toggle label="Read answers aloud" checked={s.readAloud} onChange={(v) => s.set({ readAloud: v })} />
      </Card>

      <SectionTitle>Business</SectionTitle>
      <Card>
        <Field label="Business name"><Input value={s.businessName} onChange={(e) => s.set({ businessName: e.target.value })} data-testid="business-name" /></Field>
        <Field label="Type of business"><Input value={s.businessType} onChange={(e) => s.set({ businessType: e.target.value })} /></Field>
        <Toggle label="Dates are day first (India)" hint="Used when importing files: 03/04/2026 = 3 April 2026" checked={s.dayFirst} onChange={(v) => s.set({ dayFirst: v })} />
        <p className="text-sm text-muted">Currency: Indian rupee (₹). Financial year: April to March.</p>
      </Card>

      <SectionTitle>Appearance</SectionTitle>
      <Card><Segmented options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} value={s.theme} onChange={(v) => s.set({ theme: v })} testId="theme" /></Card>

      <SectionTitle>Data</SectionTitle>
      <Card onClick={() => nav('/data')} className="!p-4 flex items-center justify-between"><span>Backup, restore, import and export</span><ChevronRight className="size-5 text-muted" aria-hidden /></Card>

      <SectionTitle>Diagnostics</SectionTitle>
      <Card testId="diagnostics">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Version</dt><dd data-testid="app-version">{__APP_VERSION__}</dd>
          <dt className="text-muted">Platform</dt><dd>{platform()}{chromeMajor() ? ` · Chrome ${chromeMajor()}` : ''}</dd>
          <dt className="text-muted">AI eval score</dt><dd data-testid="eval-score">{score.llm ? `${score.llm.scorePct}% (${score.llm.passed}/${score.llm.total}, ${score.llm.model}, ${formatDate(score.llm.date)})` : 'not run'}</dd>
          <dt className="text-muted">As shipped</dt><dd>{score.pipeline ? `${score.pipeline.scorePct}% with the offline engine first` : '–'}</dd>
          <dt className="text-muted">Data</dt><dd>{stats.data ? `${stats.data.products} products, ${stats.data.sales} sale lines` : '…'}</dd>
        </dl>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setDiag((v) => !v)}>{diag ? 'Hide' : 'Show'} recent questions</Button>
        {diag && (
          <ul className="mt-3 text-sm divide-y divide-line max-h-96 overflow-auto" data-testid="qa-log">
            {(qa.data ?? []).map((r) => (
              <li key={String(r.id)} className="py-2">
                <p><span className={r.ok ? 'text-pos' : 'text-neg'}>{r.ok ? '✓' : '✗'}</span> {String(r.question)} <span className="text-muted">· {String(r.route)} · {String(r.ms)} ms{r.feedback === -1 ? ' · 👎' : r.feedback === 1 ? ' · 👍' : ''}</span></p>
                {r.sql ? <code className="block text-xs text-muted break-all">{String(r.sql).slice(0, 300)}</code> : null}
                {r.error ? <p className="text-xs text-neg">{String(r.error)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SectionTitle>Labs</SectionTitle>
      <Card>
        <Toggle label="Hindi (experimental)" hint="Adds Hindi as a voice language. Questions are sent to the AI as spoken; accuracy is not yet measured." checked={s.hindiLab} onChange={(v) => s.set({ hindiLab: v, lang: v ? s.lang : s.lang === 'hi-IN' ? 'en-IN' : s.lang })} />
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => { s.set({ onboarded: false }); nav('/welcome'); }}>Show the welcome screens again</Button>
      </Card>
      <p className="text-xs text-muted text-center mt-6">StockSense AI {__APP_VERSION__} · your data stays on this device</p>
    </div>
  );
}
