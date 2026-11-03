import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { money, downloadCsv } from '../lib/format';
import { useSession } from '../lib/session';
import { Button, Card, Empty, ErrorBox, Notice, PageHeader, Skeleton, Stat } from '../components/ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Analytics() {
  const s = useSession();
  useEffect(() => { void s.loadOrders(); }, [s.store?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [mpesaFee, setMpesaFee] = useState(Number(localStorage.getItem('mpesaFeePct') || '0'));
  const cur = s.store?.currency || 'KES';

  const r = useMemo(() => {
    const inRange = (s.orders || []).filter((o) => o.created.slice(0, 10) >= from && o.created.slice(0, 10) <= to);
    const paid = inRange.filter((o) => o.payment_status === 'paid' && o.status !== 'cancelled');
    const sales = paid.reduce((a, o) => a + o.total, 0);
    const supplier = paid.reduce((a, o) => a + o.items.filter((i) => i.dropship).reduce((b, i) => b + i.supplier_cost * i.qty, 0), 0);
    const delivery = paid.reduce((a, o) => a + o.delivery, 0);
    const fees = Math.round((sales * mpesaFee) / 100);
    const products = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
    for (const o of paid) for (const i of o.items) {
      const p = products.get(i.name) || { name: i.name, qty: 0, revenue: 0, cost: 0 };
      p.qty += i.qty; p.revenue += i.price * i.qty; p.cost += i.supplier_cost * i.qty; products.set(i.name, p);
    }
    const list = [...products.values()].map((p) => ({ ...p, profit: p.revenue - p.cost }));
    const days: Record<string, { day: string; sales: number; profit: number }> = {};
    for (const o of paid) {
      const d = o.created.slice(0, 10); days[d] ||= { day: d, sales: 0, profit: 0 };
      days[d].sales += o.total; days[d].profit += o.total - o.items.reduce((b, i) => b + i.supplier_cost * i.qty, 0);
    }
    return {
      inRange, paid, sales, supplier, delivery, fees, gross: sales - supplier, net: sales - supplier - fees,
      cancelled: inRange.filter((o) => o.status === 'cancelled').length,
      failedPay: inRange.filter((o) => o.payment_status === 'failed').length,
      best: [...list].sort((a, b) => b.qty - a.qty).slice(0, 10),
      profitable: [...list].sort((a, b) => b.profit - a.profit).slice(0, 10),
      chart: Object.values(days).sort((a, b) => a.day.localeCompare(b.day)),
    };
  }, [s.orders, from, to, mpesaFee]);

  return (
    <div>
      <PageHeader title="Analytics & Reports" subtitle="Revenue is not profit: supplier costs and charges are shown separately."
        actions={<>
          <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!r.paid.length} onClick={() => downloadCsv(`sales_${from}_${to}.csv`, r.paid.map((o) => ({ code: o.code, date: o.created, total: o.total, delivery_fee: o.delivery, supplier_cost_estimate: o.items.reduce((b, i) => b + i.supplier_cost * i.qty, 0), payment: o.payment_method, receipt: o.mpesa_receipt })))}>Export CSV</Button>
        </>} />
      {s.ordersError && <ErrorBox error={s.ordersError} onRetry={() => s.loadOrders(true)} />}
      {!s.orders && !s.ordersError ? <Skeleton className="h-96" /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total sales (paid)" value={money(r.sales, cur)} hint={`${r.paid.length} orders · incl. ${money(r.delivery, cur)} delivery fees`} />
          <Stat label="Supplier expenses (estimated)" value={money(r.supplier, cur)} hint="Item cost + supplier shipping at time of order" />
          <Stat label="Gross profit (estimated)" value={money(r.gross, cur)} />
          <Stat label="Estimated net profit" value={money(r.net, cur)} hint={`after ${mpesaFee}% payment charges`} />
          <Stat label="Order volume" value={r.inRange.length} hint="All orders in range" />
          <Stat label="Payment charges (estimated)" value={money(r.fees, cur)} />
          <Stat label="Cancelled orders" value={r.cancelled} />
          <Stat label="Failed payments" value={r.failedPay} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          M-Pesa charge %: <input type="number" min="0" max="10" step="0.1" className="input !w-20 !py-1" value={mpesaFee} onChange={(e) => { setMpesaFee(Number(e.target.value)); localStorage.setItem('mpesaFeePct', e.target.value); }} />
          <span>All costs are <b>estimates</b> from the supplier cost saved when the product was published. Confirmed AliExpress charges are not tracked yet (needs order API).</span>
        </div>
        <Card title="Sales vs estimated gross profit" className="mt-4">
          {r.chart.length ? <div className="h-64"><ResponsiveContainer><BarChart data={r.chart}><CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" /><XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} /><YAxis tick={{ fontSize: 11 }} width={60} /><Tooltip formatter={(v) => money(Number(v), cur)} /><Legend /><Bar dataKey="sales" name="Sales" fill="#4f46e5" /><Bar dataKey="profit" name="Est. gross profit" fill="#10b981" /></BarChart></ResponsiveContainer></div> : <Empty title="No paid orders in this period" />}
        </Card>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[['Best-selling products', r.best, 'qty'], ['Most profitable products (est.)', r.profitable, 'profit']].map(([title, list, key]) => (
            <Card key={title as string} title={title as string}>
              {(list as any[]).length ? (list as any[]).map((p) => <div key={p.name} className="flex justify-between gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-800"><span className="truncate">{p.name}</span><b className="shrink-0">{key === 'qty' ? `${p.qty} sold` : money(p.profit, cur)}</b></div>) : <Empty title="No data" />}
            </Card>
          ))}
        </div>
        <div className="mt-4"><Notice>Refund, inventory-change and failed-supplier-order reports appear once refunds and automated supplier orders are tracked (Phase 6). Sync changes are listed in Inventory Synchronization.</Notice></div>
      </>}
    </div>
  );
}
