import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Boxes, Database, Home, Menu, Mic } from 'lucide-react';
import { cx } from './ui';
import { Toasts } from './Toasts';

const tabs = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/inventory', label: 'Inventory', icon: Boxes },
  { to: '/ask', label: 'Ask', icon: Mic, centre: true },
  { to: '/data', label: 'Data', icon: Database },
  { to: '/more', label: 'More', icon: Menu },
];

export function Layout() {
  const nav = useNavigate();
  const loc = useLocation();
  const onAsk = loc.pathname.startsWith('/ask');
  return (
    <div className="h-full flex flex-col md:flex-row" style={{ paddingTop: 'var(--sat)', paddingLeft: 'var(--sal)', paddingRight: 'var(--sar)' }}>
      {/* Side rail on wide screens (Windows / tablets) */}
      <nav aria-label="Main" className="hidden md:flex flex-col w-56 shrink-0 border-r border-line bg-surface p-3 gap-1">
        <div className="flex items-center gap-2 px-2 py-3 mb-2">
          <img src="./icon.svg" alt="" className="size-9 rounded-xl" />
          <span className="font-bold text-lg">StockSense AI</span>
        </div>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} data-testid={`rail-${t.label.toLowerCase()}`}
            className={({ isActive }) => cx('flex items-center gap-3 min-h-12 px-3 rounded-xl font-medium', isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface2')}>
            <t.icon className="size-5" aria-hidden /> {t.label}
          </NavLink>
        ))}
      </nav>

      <main id="main" className="flex-1 min-h-0 overflow-y-auto">
        <div className={cx('mx-auto w-full max-w-5xl px-4 pt-4', onAsk ? 'h-full pb-0' : 'pb-28 md:pb-10')}>
          <Outlet />
        </div>
      </main>

      {/* Bottom navigation on phones */}
      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line" style={{ paddingBottom: 'var(--sab)' }}>
        <div className="grid grid-cols-5 h-16 items-center">
          {tabs.map((t) =>
            t.centre ? (
              <div key={t.to} className="flex justify-center">
                <button type="button" aria-label="Ask by voice or text" data-testid="tab-ask" onClick={() => nav('/ask')}
                  className={cx('-mt-7 size-16 rounded-full flex items-center justify-center shadow-lg border-4 border-bg', onAsk ? 'bg-ink text-bg' : 'bg-accent text-accent-ink')}>
                  <Mic className="size-7" aria-hidden />
                </button>
              </div>
            ) : (
              <NavLink key={t.to} to={t.to} end={t.end} data-testid={`tab-${t.label.toLowerCase()}`}
                className={({ isActive }) => cx('flex flex-col items-center justify-center gap-0.5 h-16 text-xs font-medium', isActive ? 'text-accent' : 'text-muted')}>
                <t.icon className="size-6" aria-hidden />
                {t.label}
              </NavLink>
            ),
          )}
        </div>
      </nav>
      <Toasts />
    </div>
  );
}
