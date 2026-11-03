import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Download, RefreshCw, Copy } from 'lucide-react';
import { api } from '../lib/api';
import { money, date, downloadCsv } from '../lib/format';
import { useSession } from '../lib/session';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Notice, PageHeader, Skeleton, Stat, statusTone, useUi } from '../components/ui';
import type { ShopOrder } from '../../../shared/types';

const STATUSES = ['new', 'processing', 'shipped', 'delivered', 'cancelled'];
const isPaid = (o: ShopOrder) => o.payment_status === 'paid';
const needsSupplierOrder = (o: ShopOrder) => o.items.some((i) => i.dropship) && !o.supplier_order_no && o.status !== 'cancelled';

function useOrders() {
  const s = useSession();
  useEffect(() => { void s.loadOrders(); }, [s.store?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { orders: s.orders, error: s.ordersError, reload: () => s.loadOrders(true), cur: s.store?.currency || 'KES' };
}

function OrdersShell({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: (o: ShopOrder[]) => React.ReactNode; actions?: React.ReactNode }) {
  const { orders, error, reload } = useOrders();
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={<>{actions}<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy} onClick={async () => { setBusy(true); await reload(); setBusy(false); }}>Refresh</Button></>} />
      {error && <div className="mb-4"><ErrorBox error={error} onRetry={reload} /></div>}
      {!orders && !error && <Skeleton className="h-64" />}
      {orders && children(orders)}
    </div>
  );
}

// ------------------------------------------------------------------ order drawer (manual supplier workflow)
function OrderDrawer({ order, onClose }: { order: ShopOrder | null; onClose: () => void }) {
  const { toast } = useUi();
  const { loadOrders, store } = useSession();
  const [f, setF] = useState({ supplier_order_no: '', tracking_no: '', status: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (order) setF({ supplier_order_no: order.supplier_order_no, tracking_no: order.tracking_no, status: order.status }); }, [order]);
  if (!order) return null;
  const cur = store?.currency || 'KES';
  const canOrder = isPaid(order) || order.payment_method === 'cod';

  const save = async () => {
    setBusy(true);
    try {
      const patch: any = {};
      if (f.supplier_order_no !== order.supplier_order_no) patch.supplier_order_no = f.supplier_order_no;
      if (f.tracking_no !== order.tracking_no) patch.tracking_no = f.tracking_no;
      if (f.status !== order.status) patch.status = f.status;
      if (!Object.keys(patch).length) { onClose(); return; }
      await api(`/orders/${order.code}`, { method: 'PATCH', body: patch });
      toast('success', 'Order updated in the shop'); await loadOrders(true); onClose();
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  const copy = (t: string) => { void navigator.clipboard.writeText(t); toast('info', 'Copied'); };
  const address = `${order.name}\n${order.phone}\n${order.address}`;

  return (
    <Drawer open onClose={onClose} title={`Order ${order.code}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={save}>Save to shop</Button></>}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2"><Badge tone={statusTone(order.status)}>{order.status}</Badge><Badge tone={statusTone(order.payment_status)}>payment: {order.payment_status}</Badge><Badge>{order.payment_method === 'cod' ? 'Pay on delivery' : 'M-Pesa'}</Badge>{order.mpesa_receipt && <Badge tone="green">Receipt {order.mpesa_receipt}</Badge>}</div>
        <Card title="Customer & delivery" actions={<Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(address)}>Copy address</Button>}>
          <p className="whitespace-pre-line">{address}</p>{order.email && <p className="text-slate-500">{order.email}</p>}{order.notes && <p className="mt-2 rounded bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Note: {order.notes}</p>}
        </Card>
        <Card title="Items">
          {order.items.map((i, n) => (
            <div key={n} className="flex items-start justify-between gap-2 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800">
              <div><div className="font-medium">{i.qty} × {i.name}</div><div className="text-xs text-slate-500">{money(i.price, cur)} each · supplier cost {money(i.supplier_cost, cur)}</div></div>
              {i.dropship && i.supplier_url && <a href={i.supplier_url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-brand-600"><ExternalLink className="h-3.5 w-3.5" /> AliExpress</a>}
            </div>
          ))}
          <div className="mt-2 space-y-0.5 text-right"><div>Subtotal {money(order.subtotal, cur)}</div><div>Delivery {money(order.delivery, cur)}</div><div className="font-semibold">Total {money(order.total, cur)}</div></div>
        </Card>
        {order.items.some((i) => i.dropship) && (
          <Card title="Supplier order (manual)">
            {!canOrder && <div className="mb-3"><Notice tone="warning">Customer payment is <b>not verified</b>. Do not buy from the supplier yet.</Notice></div>}
            {canOrder && !order.supplier_order_no && <div className="mb-3"><Notice>1. Open each AliExpress link above. 2. Buy the item and use the customer's delivery address (Copy address). 3. Paste the AliExpress order number here and save.</Notice></div>}
            <div className="grid gap-3">
              <Field label="AliExpress order number"><input className="input" disabled={!canOrder} value={f.supplier_order_no} onChange={(e) => setF({ ...f, supplier_order_no: e.target.value })} /></Field>
              <Field label="Tracking number" hint="Adding a tracking number marks the order as shipped"><input className="input" value={f.tracking_no} onChange={(e) => setF({ ...f, tracking_no: e.target.value })} /></Field>
            </div>
          </Card>
        )}
        <Field label="Order status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <p className="text-xs text-slate-500">Placed {date(order.created)}. Payment status comes from the shop's M-Pesa verification and can't be changed here.</p>
      </div>
    </Drawer>
  );
}

function OrdersTable({ orders, onOpen, cur, cols = 'all' }: { orders: ShopOrder[]; onOpen: (o: ShopOrder) => void; cur: string; cols?: 'all' | 'shipping' }) {
  if (!orders.length) return <Empty title="Nothing here" />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead className="bg-slate-50 dark:bg-slate-800/50"><tr><th className="th">Order</th><th className="th">Date</th><th className="th">Customer</th><th className="th">Total</th><th className="th">Payment</th><th className="th">Status</th>{cols === 'shipping' ? <><th className="th">Supplier order</th><th className="th">Tracking</th></> : <th className="th">Items</th>}</tr></thead>
        <tbody>{orders.map((o) => (
          <tr key={o.code} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40" onClick={() => onOpen(o)}>
            <td className="td font-mono text-xs">{o.code}</td><td className="td whitespace-nowrap">{date(o.created)}</td><td className="td">{o.name}<div className="text-xs text-slate-500">{o.phone}</div></td>
            <td className="td">{money(o.total, cur)}</td><td className="td"><Badge tone={statusTone(o.payment_status)}>{o.payment_status}</Badge></td><td className="td"><Badge tone={statusTone(o.status)}>{o.status}</Badge></td>
            {cols === 'shipping' ? <><td className="td font-mono text-xs">{o.supplier_order_no || '—'}</td><td className="td font-mono text-xs">{o.tracking_no || '—'}</td></> : <td className="td text-xs">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ').slice(0, 60)}</td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ pages
export function Orders() {
  const [open, setOpen] = useState<ShopOrder | null>(null);
  const [q, setQ] = useState(''); const [st, setSt] = useState(''); const [pay, setPay] = useState('');
  const { orders, cur } = useOrders();
  const rows = useMemo(() => (orders || []).filter((o) => (!st || o.status === st) && (!pay || o.payment_status === pay) &&
    (!q || `${o.code} ${o.name} ${o.phone} ${o.email}`.toLowerCase().includes(q.toLowerCase()))), [orders, q, st, pay]);
  const exportCsv = () => downloadCsv('orders.csv', rows.map((o) => ({ code: o.code, date: o.created, customer: o.name, phone: o.phone, address: o.address, subtotal: o.subtotal, delivery: o.delivery, total: o.total, payment_method: o.payment_method, payment_status: o.payment_status, mpesa_receipt: o.mpesa_receipt, status: o.status, supplier_order_no: o.supplier_order_no, tracking_no: o.tracking_no, items: o.items.map((i) => `${i.qty}x ${i.name}`).join('; ') })));
  return (
    <OrdersShell title="Orders" subtitle="Customer orders from your shop. Historical prices are kept exactly as the customer paid." actions={<Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}>
      {() => <>
        <Card className="mb-4"><div className="grid gap-2 sm:grid-cols-4">
          <input className="input sm:col-span-2" placeholder="Search code, name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <select className="input" value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Payment"><option value="">All payments</option>{['paid', 'pending', 'unpaid', 'failed'].map((s) => <option key={s}>{s}</option>)}</select>
        </div></Card>
        <OrdersTable orders={rows} onOpen={setOpen} cur={cur} />
        <OrderDrawer order={open} onClose={() => setOpen(null)} />
      </>}
    </OrdersShell>
  );
}

export function SupplierOrders() {
  const [open, setOpen] = useState<ShopOrder | null>(null);
  const { cur } = useOrders();
  return (
    <OrdersShell title="Supplier Orders" subtitle="Dropship orders that still need to be bought on AliExpress.">
      {(orders) => {
        const ready = orders.filter((o) => needsSupplierOrder(o) && (isPaid(o) || o.payment_method === 'cod'));
        const waiting = orders.filter((o) => needsSupplierOrder(o) && !isPaid(o) && o.payment_method !== 'cod');
        const placed = orders.filter((o) => o.supplier_order_no && o.status !== 'delivered');
        return <>
          <Notice>Mode: <b>Manual</b>. Automatic AliExpress ordering is switched off until your app has the ordering API approved and Phase 6 is enabled — see Automation Center.</Notice>
          <h2 className="mb-2 mt-5 font-semibold">Ready to order — payment verified ({ready.length})</h2>
          <OrdersTable orders={ready} onOpen={setOpen} cur={cur} />
          <h2 className="mb-2 mt-6 font-semibold">Waiting for payment ({waiting.length})</h2>
          <OrdersTable orders={waiting} onOpen={setOpen} cur={cur} />
          <h2 className="mb-2 mt-6 font-semibold">Ordered from supplier, not yet delivered ({placed.length})</h2>
          <OrdersTable orders={placed} onOpen={setOpen} cur={cur} cols="shipping" />
          <OrderDrawer order={open} onClose={() => setOpen(null)} />
        </>;
      }}
    </OrdersShell>
  );
}

export function Shipping() {
  const [open, setOpen] = useState<ShopOrder | null>(null);
  const { cur } = useOrders();
  return (
    <OrdersShell title="Shipping & Tracking" subtitle="Supplier shipment (tracking number) is shown separately from final delivery to the customer.">
      {(orders) => {
        const noTracking = orders.filter((o) => o.supplier_order_no && !o.tracking_no && o.status !== 'cancelled');
        const inTransit = orders.filter((o) => o.tracking_no && o.status === 'shipped');
        const delivered = orders.filter((o) => o.status === 'delivered');
        return <>
          <div className="grid grid-cols-3 gap-3"><Stat label="Awaiting tracking number" value={noTracking.length} /><Stat label="Shipped by supplier" value={inTransit.length} /><Stat label="Delivered to customer" value={delivered.length} /></div>
          <Notice>Tracking numbers are entered manually from your AliExpress order page. Automatic tracking sync needs the AliExpress logistics API (Phase 6). Mark an order <b>delivered</b> only when the customer has received it.</Notice>
          <h2 className="mb-2 mt-5 font-semibold">Awaiting tracking number</h2><OrdersTable orders={noTracking} onOpen={setOpen} cur={cur} cols="shipping" />
          <h2 className="mb-2 mt-6 font-semibold">In transit</h2><OrdersTable orders={inTransit} onOpen={setOpen} cur={cur} cols="shipping" />
          <h2 className="mb-2 mt-6 font-semibold">Delivered</h2><OrdersTable orders={delivered.slice(0, 50)} onOpen={setOpen} cur={cur} cols="shipping" />
          <OrderDrawer order={open} onClose={() => setOpen(null)} />
        </>;
      }}
    </OrdersShell>
  );
}

export function Customers() {
  const { cur } = useOrders();
  const [q, setQ] = useState('');
  return (
    <OrdersShell title="Customers" subtitle="Built from your shop orders (grouped by phone number).">
      {(orders) => {
        const map = new Map<string, { name: string; phone: string; email: string; orders: number; spent: number; last: string; address: string }>();
        for (const o of orders) {
          const key = o.phone.replace(/\D/g, '').replace(/^0/, '254');
          const c = map.get(key) || { name: o.name, phone: o.phone, email: o.email, orders: 0, spent: 0, last: o.created, address: o.address };
          c.orders++; if (isPaid(o) && o.status !== 'cancelled') c.spent += o.total; if (o.created > c.last) { c.last = o.created; c.address = o.address; }
          map.set(key, c);
        }
        const list = [...map.values()].filter((c) => !q || `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.spent - a.spent);
        return <>
          <div className="mb-4 flex gap-2"><input className="input max-w-sm" placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!list.length} onClick={() => downloadCsv('customers.csv', list)}>Export</Button></div>
          {!list.length ? <Empty title="No customers yet" /> : (
            <div className="card overflow-x-auto"><table className="w-full min-w-[640px]"><thead className="bg-slate-50 dark:bg-slate-800/50"><tr><th className="th">Name</th><th className="th">Phone</th><th className="th">Orders</th><th className="th">Paid total</th><th className="th">Last order</th><th className="th">Last address</th></tr></thead>
              <tbody>{list.map((c) => <tr key={c.phone} className="border-t border-slate-100 dark:border-slate-800"><td className="td">{c.name}<div className="text-xs text-slate-500">{c.email}</div></td><td className="td">{c.phone}</td><td className="td">{c.orders}</td><td className="td">{money(c.spent, cur)}</td><td className="td">{date(c.last)}</td><td className="td max-w-xs truncate text-xs">{c.address}</td></tr>)}</tbody></table></div>
          )}
        </>;
      }}
    </OrdersShell>
  );
}

export function Payments() {
  const { cur } = useOrders();
  const [open, setOpen] = useState<ShopOrder | null>(null);
  return (
    <OrdersShell title="Payments" subtitle="M-Pesa payments are verified by the shop server with Safaricom (callback + STK status query + amount check).">
      {(orders) => {
        const by = (s: string) => orders.filter((o) => o.payment_status === s);
        const sum = (l: ShopOrder[]) => l.reduce((a, o) => a + o.total, 0);
        return <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Successful (paid)" value={money(sum(by('paid')), cur)} hint={`${by('paid').length} payments`} />
            <Stat label="Pending" value={money(sum(by('pending')), cur)} hint={`${by('pending').length} waiting`} />
            <Stat label="Failed" value={by('failed').length} />
            <Stat label="Pay on delivery (unpaid)" value={money(sum(orders.filter((o) => o.payment_method === 'cod' && o.payment_status === 'unpaid')), cur)} />
          </div>
          <Notice>Refunds: M-Pesa refunds are sent from your M-Pesa business portal. Afterwards set the order to <b>cancelled</b> and add a note in the shop admin. Automated refunds need the Daraja B2C/Reversal API (not set up yet).</Notice>
          <div className="mt-4 card overflow-x-auto"><table className="w-full min-w-[640px]"><thead className="bg-slate-50 dark:bg-slate-800/50"><tr><th className="th">Order</th><th className="th">Date</th><th className="th">Method</th><th className="th">Amount</th><th className="th">Status</th><th className="th">M-Pesa receipt</th></tr></thead>
            <tbody>{orders.map((o) => <tr key={o.code} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40" onClick={() => setOpen(o)}><td className="td font-mono text-xs">{o.code}</td><td className="td">{date(o.created)}</td><td className="td">{o.payment_method === 'cod' ? 'On delivery' : 'M-Pesa'}</td><td className="td">{money(o.total, cur)}</td><td className="td"><Badge tone={statusTone(o.payment_status)}>{o.payment_status}</Badge></td><td className="td font-mono text-xs">{o.mpesa_receipt || '—'}</td></tr>)}</tbody></table>
            {!orders.length && <Empty title="No payments yet" />}
          </div>
          <OrderDrawer order={open} onClose={() => setOpen(null)} />
        </>;
      }}
    </OrdersShell>
  );
}
