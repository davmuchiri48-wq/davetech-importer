import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { useSession } from '../lib/session';
import { Badge, Button, Card, Empty, ErrorBox, Notice, PageHeader, Skeleton, Stat, statusTone, useApiData, useUi } from '../components/ui';

export default function Sync() {
  const { store } = useSession();
  const { toast } = useUi();
  const hist = useApiData(() => api<{ history: any[] }>('/sync/history'), [store?.id]);
  const settings = useApiData(() => api('/settings'), [store?.id]);
  const prods = useApiData(() => api<{ products: any[] }>('/products'), [store?.id]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const run = async () => {
    setBusy(true);
    try { const r = await api('/sync/run', { body: {} }); setSummary(r); toast(r.failed ? 'error' : 'success', `Checked ${r.checked} products`); void hist.reload(); void prods.reload(); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  const p = prods.data?.products || [];
  const s = settings.data?.sync;
  const names = Object.fromEntries(p.map((x) => [x.id, x.name]));

  return (
    <div>
      <PageHeader title="Inventory Synchronization" subtitle="Checks supplier prices and availability for products imported through the AliExpress API."
        actions={<Button icon={<RefreshCw className="h-4 w-4" />} loading={busy} onClick={run}>Synchronize now</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Synced via API" value={p.filter((x) => x.supplier?.source === 'aliexpress_api').length} />
        <Stat label="Manual imports (not auto-checked)" value={p.filter((x) => x.supplier?.source === 'manual').length} />
        <Stat label="Unavailable" value={p.filter((x) => x.availability === 'unavailable').length} />
        <Stat label="Sync errors" value={p.filter((x) => x.syncError).length} />
      </div>
      <div className="mt-4 space-y-3">
        {s && <Notice>Automatic schedule: <b>{s.enabled ? `every ${s.everyHours} hours` : 'off'}</b> · alert when price changes ≥ {s.priceChangeThresholdPercent}% · when out of stock: <b>{s.onUnavailable === 'unpublish' ? 'remove from shop' : 'mark only'}</b>. Change this in <Link className="underline" to="/settings">Settings</Link>.</Notice>}
        {summary && <Card title="Last run">Checked {summary.checked}, changed {summary.changed}, unavailable {summary.unavailable}, failed {summary.failed}, manual skipped {summary.skippedManual}.{summary.errors.slice(0, 3).map((e: string) => <p key={e} className="mt-1 text-sm text-red-600">{e}</p>)}</Card>}
      </div>
      <Card title="Synchronization history" className="mt-4">
        {hist.error && <ErrorBox error={hist.error} onRetry={hist.reload} />}
        {hist.loading && !hist.data && <Skeleton className="h-32" />}
        {hist.data?.history.length === 0 && <Empty title="No synchronization yet" />}
        <div className="overflow-x-auto">
          {hist.data && hist.data.history.length > 0 && (
            <table className="w-full min-w-[600px]"><thead><tr><th className="th">When</th><th className="th">Product</th><th className="th">Result</th><th className="th">Details</th></tr></thead>
              <tbody>{hist.data.history.map((h) => <tr key={h.id} className="border-t border-slate-100 dark:border-slate-800"><td className="td whitespace-nowrap">{date(h.at)}</td><td className="td"><Link className="text-brand-600" to={`/products/${h.productId}`}>{names[h.productId] || h.productId}</Link></td><td className="td"><Badge tone={statusTone(h.result)}>{h.result}</Badge></td><td className="td text-xs">{h.error || h.changes?.join('. ') || `availability: ${h.availability}`}</td></tr>)}</tbody></table>
          )}
        </div>
      </Card>
    </div>
  );
}
