import { Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Layout } from './Layout';
import { useSettings } from './settings';
import { useApp } from './store';
import { Button, Card, Spinner } from './ui';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { popBack } from '@/core/util/backstack';
import { isNative } from '@/core/util/platform';
// Every screen is bundled eagerly: the app must open any screen offline, even before the service worker has cached it.
import { Inventory } from '@/features/inventory/Inventory';
import { ProductDetail } from '@/features/inventory/ProductDetail';
import { Ask } from '@/features/ask/Ask';
import { DataScreen } from '@/features/data/DataScreen';
import { ImportWizard } from '@/features/data/ImportWizard';
import { TableView } from '@/features/data/TableView';
import { Insights } from '@/features/insights/Insights';
import { Settings } from '@/features/settings/Settings';
import { Onboarding } from '@/features/onboarding/Onboarding';


/** Android back button: close the open sheet first, then go back; on Home, a second press within 2 s exits. */
function BackButton() {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (!isNative()) return;
    let lastHomeBack = 0;
    let remove: (() => void) | undefined;
    void import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => {
      if (popBack()) return;
      if (loc.pathname === '/' || loc.pathname === '/welcome') {
        if (Date.now() - lastHomeBack < 2000) void App.exitApp();
        else { lastHomeBack = Date.now(); useApp.getState().toast('Press back again to exit'); }
        return;
      }
      nav(-1);
    })).then((h) => { remove = () => void h.remove(); });
    return () => remove?.();
  }, [loc.pathname, nav]);
  return null;
}

function Guard({ children }: { children: React.ReactNode }) {
  const onboarded = useSettings((s) => s.onboarded);
  return onboarded ? <>{children}</> : <Navigate to="/welcome" replace />;
}

function Boot({ children }: { children: React.ReactNode }) {
  const ready = useApp((s) => s.dbReady);
  const err = useApp((s) => s.dbError);
  if (err) return <div className="p-6"><Card><p className="font-bold mb-2">StockSense could not start its database</p><p className="text-muted mb-3">{err}</p><Button onClick={() => location.reload()}>Try again</Button></Card></div>;
  if (!ready) return <div className="h-full flex items-center justify-center"><Spinner label="Opening your data…" /></div>;
  return <>{children}</>;
}

export function App() {
  return (
    <HashRouter>
      <BackButton />
      <Boot>
        <Suspense fallback={<div className="p-6"><Spinner /></div>}>
          <Routes>
            <Route path="welcome" element={<div className="h-full overflow-y-auto px-4" style={{ paddingTop: 'var(--sat)' }}><Onboarding /></div>} />
            <Route element={<Guard><Layout /></Guard>}>
              <Route index element={<Dashboard />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="inventory/:id" element={<ProductDetail />} />
              <Route path="ask" element={<Ask />} />
              <Route path="data" element={<DataScreen />} />
              <Route path="data/import" element={<ImportWizard />} />
              <Route path="data/table/:name" element={<TableView />} />
              <Route path="insights" element={<Insights />} />
              <Route path="more" element={<Settings />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </Boot>
    </HashRouter>
  );
}
