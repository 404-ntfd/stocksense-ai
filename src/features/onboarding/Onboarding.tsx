import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, FileUp, Sparkles } from 'lucide-react';
import { db } from '@/core/db/client';
import { todayISO } from '@/core/util/dates';
import { useSettings } from '@/app/settings';
import { toast, useApp } from '@/app/store';
import { Button, Card, cx, Field, Input, Select } from '@/app/ui';
import { KeyField } from '@/features/settings/Settings';

export function Onboarding() {
  const nav = useNavigate();
  const s = useSettings();
  const bump = useApp((x) => x.bumpData);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(s.businessName);
  const [type, setType] = useState(s.businessType || 'General store');
  const [busy, setBusy] = useState(false);
  const [dataChoice, setDataChoice] = useState<'demo' | 'import' | 'empty' | null>(null);

  async function chooseData(c: 'demo' | 'import' | 'empty'): Promise<void> {
    setDataChoice(c);
    if (c === 'demo') {
      setBusy(true);
      try {
        const t0 = performance.now();
        await db.loadDemo(todayISO());
        if (!name.trim()) { setName('Sree Krishna Stores'); s.set({ businessName: 'Sree Krishna Stores' }); }
        bump();
        toast(`Demo shop loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'ok');
      } catch (e) { toast(e instanceof Error ? e.message : 'Could not load demo data', 'error'); setDataChoice(null); setBusy(false); return; }
      setBusy(false);
    }
    setStep(2);
  }
  function finish(): void {
    s.set({ onboarded: true });
    nav(dataChoice === 'import' ? '/data/import' : '/', { replace: true });
  }
  return (
    <div className="min-h-full flex flex-col max-w-lg mx-auto py-4" data-testid="onboarding">
      <div className="flex items-center gap-3 mb-6">
        <img src="./icon.svg" alt="" className="size-12 rounded-2xl" />
        <div><h1 className="text-2xl font-bold">StockSense AI</h1><p className="text-muted">Ask your shop anything</p></div>
      </div>
      <div className="flex gap-1.5 mb-5" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className={cx('h-1.5 flex-1 rounded-full', i <= step ? 'bg-accent' : 'bg-line')} />)}</div>
      {step === 0 && (
        <Card>
          <h2 className="text-lg font-bold mb-3">About your business</h2>
          <Field label="Business name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lakshmi Stores" data-testid="onb-name" /></Field>
          <Field label="Type of business">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {['General store', 'Kirana / grocery', 'Hardware', 'Pharmacy', 'Stationery', 'Distributor', 'Other'].map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <div className="flex justify-between mt-2">
            <Button variant="ghost" onClick={() => { s.set({ onboarded: true }); nav('/', { replace: true }); }} data-testid="onb-skip">Skip</Button>
            <Button onClick={() => { s.set({ businessName: name.trim(), businessType: type }); setStep(1); }} data-testid="onb-next">Next</Button>
          </div>
        </Card>
      )}
      {step === 1 && (
        <Card>
          <h2 className="text-lg font-bold mb-1">Your data</h2>
          <p className="text-muted mb-3">Everything stays on this device.</p>
          <div className="space-y-2">
            <button type="button" onClick={() => void chooseData('demo')} disabled={busy} data-testid="onb-demo" className="w-full rounded-xl border border-line p-4 text-left flex gap-3 hover:bg-surface2">
              <Sparkles className="size-6 text-accent shrink-0" aria-hidden /><span><span className="block font-semibold">Try with demo data</span><span className="text-sm text-muted">A general store with 150 products and 18 months of sales</span></span>
            </button>
            <button type="button" onClick={() => void chooseData('import')} disabled={busy} className="w-full rounded-xl border border-line p-4 text-left flex gap-3 hover:bg-surface2">
              <FileUp className="size-6 text-accent shrink-0" aria-hidden /><span><span className="block font-semibold">Import my file</span><span className="text-sm text-muted">An Excel or CSV stock list or sales register</span></span>
            </button>
            <button type="button" onClick={() => void chooseData('empty')} disabled={busy} className="w-full rounded-xl border border-line p-4 text-left flex gap-3 hover:bg-surface2">
              <Database className="size-6 text-accent shrink-0" aria-hidden /><span><span className="block font-semibold">Start empty</span><span className="text-sm text-muted">Add products by hand</span></span>
            </button>
          </div>
          {busy && <p className="text-muted mt-3">Loading the demo shop…</p>}
        </Card>
      )}
      {step === 2 && (
        <Card>
          <h2 className="text-lg font-bold mb-1">Ask anything (optional)</h2>
          <p className="text-muted mb-3">Common questions such as "low stock items" work offline with no key. For any other question, add a free Groq key: sign up at console.groq.com, create a key and paste it here.</p>
          <KeyField />
          <div className="flex justify-between mt-4">
            <Button variant="ghost" onClick={finish}>Later</Button>
            <Button onClick={finish} data-testid="onb-finish">Start</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
