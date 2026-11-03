import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts';
import { Package, Globe, Clock, ShoppingCart, PackageCheck, Wallet, TrendingUp, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { money, ago } from '../lib/format';
import { useSession } from '../lib/session';
import { Badge, Card, Empty, ErrorBox, Notice, PageHeader, Skeleton, Stat, statusTone, useApiData } from '../components/ui';

export default function Overview() {
  const { store } = useSession();
  const { data, error, loading, reload } = useApiData(() => api('/overview'), [store?.id]);
  const c = data?.cards;
  const cur = store?.currency || 'KES';
  const axis = { fontSize: 11, fill: '#94a3b8' };

  return (
    <div>
      <PageHeader title="Overview" subtitle={`${store?.name} · last 30 days`} />
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data?.shopError && <div className="mb-4"><Notice tone="warning">Could not load orders from the shop: {data.shopError}</Notice></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading && !c ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />) : c && <>
          <Stat label="Total Products" value={c.totalProducts} icon={<Package className="h-4 w-4" />} />
          <Stat label="Published Products" value={c.publishedProducts} icon={<Globe className="h-4 w-4" />} />
          <Stat label="Pending Imports" value={c.pendingImports} icon={<Clock className="h-4 w-4" />} />
          <Stat label="Total Orders" value={c.totalOrders} icon={<ShoppingCart className="h-4 w-4" />} />
          <Stat label="Pending Supplier Orders" value={c.pendingSupplierOrders} hint={c.pendingSupplierOrders ? <Link className="text-brand-600" to="/supplier-orders">Place them now →</Link> : 'All caught up'} icon={<PackageCheck className="h-4 w-4" />} />
          <Stat label="Total Sales" value={money(c.totalSales, cur)} hint="Paid, not cancelled" icon={<Wallet className="h-4 w-4" />} />
          <Stat label="Estimated Profit" value={money(c.estimatedProfit, cur)} hint="Sales minus supplier cost (estimate)" icon={<TrendingUp className="h-4 w-4" />} />
          <Stat label="Synchronization Errors" value={c.syncErrors} hint={c.syncErrors ? <Link className="text-brand-600" to="/sync">Review →</Link> : 'None'} icon={<AlertTriangle className="h-4 w-4" />} />
        </>}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Sales (KES, paid orders)">
          {data ? (
            <div className="h-56"><ResponsiveContainer>
              <AreaChart data={data.salesByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="day" tick={axis} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={axis} width={60} />
                <Tooltip formatter={(v) => money(Number(v), cur)} />
                <Area dataKey="sales" stroke="#4f46e5" fill="#6366f133" />
              </AreaChart>
            </ResponsiveContainer></div>
          ) : <Skeleton className="h-56" />}
        </Card>
        <Card title="Order activity">
          {data ? (
            <div className="h-56"><ResponsiveContainer>
              <BarChart data={data.salesByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="day" tick={axis} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={axis} allowDecimals={false} width={30} />
                <Tooltip />
                <Bar dataKey="orders" fill="#4f46e5" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer></div>
          ) : <Skeleton className="h-56" />}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Recent imports" actions={<Link className="text-xs text-brand-600" to="/import">Importer →</Link>}>
          {data?.recentImports?.length ? data.recentImports.map((j: any) => (
            <div key={j.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
              <span className="truncate">#{j.supplierProductId}</span><Badge tone={statusTone(j.status)}>{j.status}</Badge>
            </div>
          )) : <Empty title="No imports yet" action={<Link className="text-sm text-brand-600" to="/import">Import your first product</Link>} />}
        </Card>
        <Card title="Recent orders" actions={<Link className="text-xs text-brand-600" to="/orders">All orders →</Link>}>
          {data?.recentOrders?.length ? data.recentOrders.map((o: any) => (
            <div key={o.code} className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
              <span className="font-mono text-xs">{o.code}</span><span className="flex-1 truncate">{o.name}</span>
              <span>{money(o.total, cur)}</span><Badge tone={statusTone(o.payment_status)}>{o.payment_status}</Badge>
            </div>
          )) : <Empty title="No orders yet" />}
        </Card>
        <Card title="Supplier alerts">
          {data?.alerts?.length ? data.alerts.map((n: any) => (
            <div key={n.id} className="border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
              <div className="font-medium">{n.title}</div><div className="text-slate-500">{n.body}</div><div className="text-xs text-slate-400">{ago(n.at)}</div>
            </div>
          )) : <Empty title="No alerts" text="Price changes and out-of-stock warnings appear here." />}
        </Card>
      </div>
    </div>
  );
}
