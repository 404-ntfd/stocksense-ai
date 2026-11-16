import { useApp } from './store';
import { cx } from './ui';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="fixed inset-x-0 bottom-24 md:bottom-6 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} data-testid="toast"
          className={cx('pointer-events-auto max-w-md w-full rounded-xl px-4 py-3 shadow-lg flex items-center gap-3 text-white',
            t.tone === 'error' ? 'bg-red-700' : t.tone === 'ok' ? 'bg-emerald-700' : 'bg-slate-800')}>
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button type="button" className="font-bold underline min-h-10 px-2" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}
