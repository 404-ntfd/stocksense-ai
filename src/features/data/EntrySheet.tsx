import { useEffect, useState } from 'react';
import { db } from '@/core/db/client';
import { todayISO } from '@/core/util/dates';
import { matchProducts } from '@/core/util/fuzzy';
import { toast, useApp } from '@/app/store';
import { useDb } from '@/app/hooks';
import { Button, Field, Input, Segmented, Sheet } from '@/app/ui';

export type EntryKind = 'sale' | 'purchase' | 'expense';
const num = (s: string): number | null => { const v = Number(s.replace(/[₹,\s]/g, '')); return s.trim() !== '' && Number.isFinite(v) ? v : null; };

/** Add (or edit, when `editId` is set) a sale, purchase or expense row. */
export function EntrySheet({ kind, onClose, onKind, editId }: { kind: EntryKind | null; onClose: () => void; onKind?: (k: EntryKind) => void; editId?: number | null }) {
  const bump = useApp((s) => s.bumpData);
  const products = useDb(() => db.productNames(), []);
  const [f, setF] = useState({ product: '', productId: 0, qty: '', amount: '', date: todayISO(), ref: '', party: '', category: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!kind) return;
    setErr(null);
    if (!editId) { setF({ product: '', productId: 0, qty: '', amount: '', date: todayISO(), ref: '', party: '', category: '', note: '' }); return; }
    const table = kind === 'sale' ? 'sales' : kind === 'purchase' ? 'purchases' : 'expenses';
    void db.getEditRow(table, editId).then((r) => {
      if (!r) return;
      const name = products.data?.find((p) => p.id === r.product_id)?.name ?? '';
      setF({ product: name, productId: Number(r.product_id ?? 0), qty: String(r.qty ?? ''), amount: String(r.unit_price ?? r.unit_cost ?? r.amount ?? ''), date: String(r.date ?? todayISO()),
        ref: String(r.invoice_no ?? r.bill_no ?? ''), party: String(r.customer ?? r.supplier ?? ''), category: String(r.category ?? ''), note: String(r.note ?? '') });
    });
  }, [kind, editId, products.data]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const suggestions = f.product && !f.productId ? matchProducts(f.product, products.data ?? [], 5) : [];

  async function save(): Promise<void> {
    setErr(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { setErr('Choose a date.'); return; }
    setBusy(true);
    try {
      if (kind === 'expense') {
        const amount = num(f.amount);
        if (!amount || amount <= 0) throw new Error('Enter an amount.');
        await db.saveExpense({ date: f.date, category: f.category, amount, note: f.note }, editId);
      } else {
        const pid = f.productId || products.data?.find((p) => p.name.toLowerCase() === f.product.trim().toLowerCase())?.id;
        if (!pid) throw new Error('Choose a product from the list.');
        const qty = num(f.qty);
        if (!qty || qty <= 0) throw new Error('Enter a quantity more than zero.');
        if (kind === 'sale') await db.saveSale({ product_id: pid, qty, unit_price: num(f.amount), date: f.date, invoice_no: f.ref, customer: f.party }, editId);
        else await db.savePurchase({ product_id: pid, qty, unit_cost: num(f.amount), date: f.date, bill_no: f.ref, supplier: f.party }, editId);
      }
      bump();
      toast(editId ? 'Entry updated' : 'Entry added', 'ok');
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  if (!kind) return null;
  return (
    <Sheet open={!!kind} onClose={onClose} title={editId ? 'Edit entry' : 'Add an entry'} testId="entry-sheet"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} busy={busy} data-testid="entry-save">Save</Button></>}>
      {!editId && onKind && <div className="mb-3"><Segmented options={[{ value: 'sale', label: 'Sale' }, { value: 'purchase', label: 'Purchase' }, { value: 'expense', label: 'Expense' }]} value={kind} onChange={onKind} testId="entry-kind" /></div>}
      {err && <p className="text-neg mb-2" role="alert">{err}</p>}
      <Field label="Date"><Input type="date" value={f.date} max={todayISO()} onChange={set('date')} /></Field>
      {kind === 'expense' ? (
        <>
          <Field label="Category"><Input value={f.category} onChange={set('category')} list="exp-cats" placeholder="e.g. Rent" data-testid="entry-category" /><datalist id="exp-cats">{['Rent', 'Salary', 'Electricity', 'Transport', 'Packaging', 'Phone & Internet', 'Maintenance', 'Other'].map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Amount (₹)"><Input inputMode="decimal" value={f.amount} onChange={set('amount')} data-testid="entry-amount" /></Field>
          <Field label="Note"><Input value={f.note} onChange={set('note')} /></Field>
        </>
      ) : (
        <>
          <Field label="Product">
            <Input value={f.product} onChange={(e) => setF((s) => ({ ...s, product: e.target.value, productId: 0 }))} placeholder="Start typing a product name" data-testid="entry-product" autoComplete="off" />
            {suggestions.length > 0 && (
              <ul className="mt-1 rounded-xl border border-line divide-y divide-line overflow-hidden">
                {suggestions.map((s) => <li key={s.item.id}><button type="button" className="w-full text-left px-3 min-h-11 hover:bg-surface2" onClick={() => setF((x) => ({ ...x, product: s.item.name, productId: s.item.id }))}>{s.item.name} <span className="text-sm text-muted">{s.item.sku}</span></button></li>)}
              </ul>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity"><Input inputMode="decimal" value={f.qty} onChange={set('qty')} data-testid="entry-qty" /></Field>
            <Field label={kind === 'sale' ? 'Unit price (₹)' : 'Unit cost (₹)'} hint="Empty = the product's price"><Input inputMode="decimal" value={f.amount} onChange={set('amount')} data-testid="entry-amount" /></Field>
            <Field label={kind === 'sale' ? 'Invoice no.' : 'Bill no.'}><Input value={f.ref} onChange={set('ref')} /></Field>
            <Field label={kind === 'sale' ? 'Customer' : 'Supplier'}><Input value={f.party} onChange={set('party')} /></Field>
          </div>
        </>
      )}
    </Sheet>
  );
}
