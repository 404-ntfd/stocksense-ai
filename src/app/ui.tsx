import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { pushBack } from '@/core/util/backstack';

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

export function Card({ className, children, onClick, testId, label }: { className?: string; children: ReactNode; onClick?: () => void; testId?: string; label?: string }) {
  const base = 'rounded-2xl bg-surface border border-line p-4';
  if (onClick) {
    return (
      <button type="button" onClick={onClick} data-testid={testId} aria-label={label} className={cx(base, 'text-left w-full active:bg-surface2 transition-colors', className)}>
        {children}
      </button>
    );
  }
  return <div data-testid={testId} className={cx(base, className)}>{children}</div>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; icon?: ReactNode; busy?: boolean };
export function Button({ variant = 'primary', size = 'md', icon, busy, className, children, disabled, ...rest }: BtnProps) {
  const styles = {
    primary: 'bg-accent text-accent-ink hover:opacity-90',
    secondary: 'bg-surface text-ink border border-line hover:bg-surface2',
    ghost: 'bg-transparent text-accent hover:bg-accent-soft',
    danger: 'bg-neg text-white hover:opacity-90',
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'md' ? 'min-h-12 px-4 text-base' : 'min-h-10 px-3 text-sm', styles, className)}
    >
      {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={cx('inline-flex items-center justify-center size-12 rounded-full text-muted hover:bg-surface2 active:bg-surface2 disabled:opacity-40', className)}>
      {children}
    </button>
  );
}

export function Chip({ active, children, onClick, testId, className }: { active?: boolean; children: ReactNode; onClick?: () => void; testId?: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-pressed={active}
      className={cx('shrink-0 min-h-10 px-4 rounded-full text-sm font-medium border transition-colors',
        active ? 'bg-accent text-accent-ink border-accent' : 'bg-surface text-ink border-line hover:bg-surface2', className)}>
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'pos' | 'neg' | 'warn' | 'info' | 'accent'; children: ReactNode }) {
  const t = {
    neutral: 'bg-surface2 text-muted', pos: 'bg-pos-soft text-pos', neg: 'bg-neg-soft text-neg', warn: 'bg-warn-soft text-warn',
    info: 'bg-info-soft text-info', accent: 'bg-accent-soft text-accent',
  }[tone];
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', t)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label ?? 'Loading…'}</span>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-10 px-6" data-testid="empty-state">
      {icon && <div className="text-muted [&>svg]:size-10">{icon}</div>}
      <p className="text-lg font-semibold">{title}</p>
      {text && <p className="text-muted max-w-sm">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-neg/40 bg-neg-soft p-4 flex gap-3 items-start" role="alert">
      <AlertTriangle className="size-5 text-neg shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">{message}</p>
        {onRetry && <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>Try again</Button>}
      </div>
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on wide screens. Back button / Escape / backdrop close it. */
export function Sheet({ open, onClose, title, children, footer, wide, testId }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; testId?: string }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const pop = pushBack(() => closeRef.current());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { pop(); window.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className={cx('sheet-in relative bg-surface w-full rounded-t-3xl md:rounded-3xl max-h-[92dvh] flex flex-col shadow-2xl', wide ? 'md:max-w-3xl' : 'md:max-w-lg')}
        style={{ paddingBottom: 'var(--sab)' }}>
        <div className="flex items-center justify-between pl-5 pr-2 pt-3 pb-1 shrink-0">
          <h2 className="text-lg font-bold">{title}</h2>
          <IconButton label="Close" onClick={onClose}><X className="size-5" /></IconButton>
        </div>
        <div className="overflow-y-auto px-5 pb-4 flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line shrink-0 flex gap-2 justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-semibold mb-1">{label}</span>
      {children}
      {hint && !error && <span className="block text-sm text-muted mt-1">{hint}</span>}
      {error && <span className="block text-sm text-neg mt-1" role="alert">{error}</span>}
    </label>
  );
}

const inputCls = 'w-full min-h-12 rounded-xl border border-line bg-surface px-3 text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none';
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, 'pr-8', props.className)} />;
}

export function Toggle({ checked, onChange, label, hint, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-12 py-2">
      <div>
        <p className="font-medium">{label}</p>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} data-testid={testId} onClick={() => onChange(!checked)}
        className={cx('relative shrink-0 w-12 h-7 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line')}>
        <span className={cx('absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, testId }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="inline-flex rounded-xl bg-surface2 p-1 gap-1" role="tablist" data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={cx('min-h-9 px-3 rounded-lg text-sm font-semibold transition-colors', o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-6 mb-2">
      <h2 className="text-base font-bold">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold truncate">{title}</h1>
        {subtitle && <p className="text-muted text-sm mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-1 shrink-0">{right}</div>}
    </header>
  );
}
