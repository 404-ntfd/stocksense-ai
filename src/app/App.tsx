import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { PageHeader } from './ui';

function Placeholder({ title }: { title: string }) {
  return (
    <div data-testid={`page-${title.toLowerCase()}`}>
      <PageHeader title={title} subtitle={`StockSense AI v${__APP_VERSION__} skeleton build`} />
      <p className="text-muted">This screen arrives in the next build.</p>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Placeholder title="Home" />} />
          <Route path="inventory" element={<Placeholder title="Inventory" />} />
          <Route path="ask" element={<Placeholder title="Ask" />} />
          <Route path="data" element={<Placeholder title="Data" />} />
          <Route path="more" element={<Placeholder title="More" />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
