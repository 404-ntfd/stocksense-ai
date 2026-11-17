import { useEffect, useState } from 'react';
import { db } from '@/core/db/client';
import type { AdjustKind, ProductRow } from '@/core/types';
import { formatQty } from '@/core/util/money';
import { todayISO } from '@/core/util/dates';
import { haptic } from '@/core/util/platform';
import { toast, useApp } from '@/app/store';
import { Button, Field, Input, Segmented, Select, Sheet } from '@/app/ui';

const numOrNull = (s: string): number | null => { const v = Number(s.replace(/[₹,\s]/g, '')); return s.trim() !== '' && Number.isFinite(v) ? v : null; };

export function ProductFormSheet({ open, onClose, product, categories, onSaved }: { open: boolean; onClose: () => void; product?: ProductRow | null; categories: string[]; onSaved?: (id: number) => void }) {
  const bump = useApp((s) => s.bumpData);
  const [f, setF] = useState({ name: '', sku: '', category: '', unit: 'pcs', cost: '', price: '', reorder: '', lead: '7', supplier: '', opening: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(product
      ? { name: product.name, sku: product.sku, category: product.category, unit: product.unit, cost: String(product.cost ?? ''), price: String(product.price ?? ''), reorder: String(product.reorder_level ?? ''), lead: String(product.lead_time_days ?? 7), supplier: product.supplier ?? '', opening: '' }
      : { name: '', sku: '', category: '', unit: 'pcs', cost: '', price: '', reorder: '', lead: '7', supplier: '', opening: '' });
  }, [open, product]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(): Promise<void> {
    if (!f.name.trim()) { setErr('Enter a product name.'); return; }
    const cost = numOrNull(f.cost), price = numOrNull(f.price);
    if ((f.cost.trim() && cost == null) || (f.price.trim() && price == null)) { setErr('Cost and price must be numbers.'); return; }
    setBusy(true);
    try {
      const id = await db.saveProduct({ name: f.name, sku: f.sku || undefined, category: f.category || undefined, unit: f.unit || undefined, cost: cost ?? 0, price: price ?? 0, reorder_level: numOrNull(f.reorder) ?? 0, lead_time_days: numOrNull(f.lead) ?? 7, supplier: f.supplier || undefined, opening_stock: product ? undefined : numOrNull(f.opening) ?? undefined }, product?.id ?? null, todayISO());
      bump();
      toast(product ? 'Product updated' : 'Product added', 'ok');
      onSaved?.(id);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save the product.'); }
    finally { setBusy(false); }
  }
  const warnBelowCost = numOrNull(f.price) != null && numOrNull(f.cost) != null && numOrNull(f.price)! > 0 && numOrNull(f.price)! < numOrNull(f.cost)!;
  return (
    <Sheet open={open} onClose={onClose} title={product ? 'Edit product' : 'Add product'} testId="product-form"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} busy={busy} data-testid="product-save">Save</Button></>}>
      <Field label="Product name" error={err}><Input value={f.name} onChange={set('name')} placeholder="e.g. Sugar 1kg" data-testid="product-name" autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU / code" hint={product ? undefined : 'Leave empty to generate'}><Input value={f.sku} onChange={set('sku')} data-testid="product-sku" /></Field>
        <Field label="Unit"><Select value={f.unit} onChange={set('unit')}>{['pcs', 'pkt', 'kg', 'g', 'l', 'ml', 'btl', 'box', 'dozen'].concat(['pcs', 'pkt', 'kg', 'g', 'l', 'ml', 'btl', 'box', 'dozen'].includes(f.unit) ? [] : [f.unit]).map((u) => <option key={u}>{u}</option>)}</Select></Field>
      </div>
      <Field label="Category"><Input value={f.category} onChange={set('category')} list="cat-list" placeholder="e.g. Sugar & Salt" data-testid="product-category" /><datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cost price (₹)"><Input inputMode="decimal" value={f.cost} onChange={set('cost')} data-testid="product-cost" /></Field>
        <Field label="Selling price (₹)" hint={warnBelowCost ? 'Below cost price' : undefined}><Input inputMode="decimal" value={f.price} onChange={set('price')} data-testid="product-price" /></Field>
        <Field label="Reorder level"><Input inputMode="decimal" value={f.reorder} onChange={set('reorder')} data-testid="product-reorder" /></Field>
        <Field label="Lead time (days)"><Input inputMode="numeric" value={f.lead} onChange={set('lead')} /></Field>
      </div>
      <Field label="Supplier"><Input value={f.supplier} onChange={set('supplier')} /></Field>
      {!product && <Field label="Opening stock" hint="How many you have right now"><Input inputMode="decimal" value={f.opening} onChange={set('opening')} data-testid="product-opening" /></Field>}
    </Sheet>
  );
}

const KINDS: Array<{ value: AdjustKind; label: string }> = [
  { value: 'count', label: 'Count' }, { value: 'damage', label: 'Damage' }, { value: 'return_in', label: 'Return in' }, { value: 'return_out', label: 'Return out' },
];
const KIND_HELP: Record<string, string> = {
  count: 'Set the stock to what you counted. The difference is recorded as a movement.',
  damage: 'Remove damaged, expired or lost stock.',
  return_in: 'A customer returned goods: stock goes up.',
  return_out: 'You returned goods to the supplier: stock goes down.',
};

export function AdjustSheet({ open, onClose, product }: { open: boolean; onClose: () => void; product: Pick<ProductRow, 'id' | 'name' | 'stock' | 'unit'> | null }) {
  const bump = useApp((s) => s.bumpData);
  const [kind, setKind] = useState<AdjustKind>('count');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setKind('count'); setQty(''); setNote(''); setErr(null); } }, [open, product?.id]);
  if (!product) return null;
  const q = numOrNull(qty);
  const after = q == null ? null : kind === 'count' ? q : kind === 'return_in' ? product.stock + Math.abs(q) : product.stock - Math.abs(q);
  async function save(): Promise<void> {
    if (q == null || q < 0) { setErr('Enter a quantity of zero or more.'); return; }
    setBusy(true);
    try {
      const now = await db.adjustStock(product!.id, kind, q, note || null, todayISO());
      bump(); void haptic();
      toast(`${product!.name}: stock is now ${formatQty(now)} ${product!.unit}`, 'ok');
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not adjust the stock.'); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title={`Adjust stock: ${product.name}`} testId="adjust-sheet"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} busy={busy} data-testid="adjust-save">Save</Button></>}>
      <p className="mb-3">In stock now: <b className={product.stock < 0 ? 'text-neg' : ''}>{formatQty(product.stock)} {product.unit}</b></p>
      <Segmented options={KINDS} value={kind} onChange={setKind} testId="adjust-kind" />
      <p className="text-sm text-muted mt-2 mb-3">{KIND_HELP[kind]}</p>
      <Field label={kind === 'count' ? 'Counted quantity' : 'Quantity'} error={err} hint={after == null ? undefined : `Stock after saving: ${formatQty(Math.round(after * 1000) / 1000)} ${product.unit}`}>
        <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="adjust-qty" autoFocus />
      </Field>
      <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly count" /></Field>
    </Sheet>
  );
}
