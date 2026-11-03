import { Link } from 'react-router-dom';
import { ShieldOff, RefreshCw, Calculator, EyeOff, PackageCheck, Truck, Bell, Download, CheckSquare } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Badge, Card, Notice, PageHeader, Skeleton, useApiData } from '../components/ui';

export default function Automation() {
  const { store } = useSession();
  const { data: s } = useApiData(() => api('/settings'), [store?.id]);
  if (!s) return <Skeleton className="h-96" />;

  const rules = [
    { icon: RefreshCw, name: 'Scheduled price synchronization', trigger: `Every ${s.sync.everyHours} h`, action: 'Check supplier price & stock', on: s.sync.enabled, available: true, where: '/settings' },
    { icon: RefreshCw, name: 'Scheduled stock checks', trigger: `Every ${s.sync.everyHours} h (same run)`, action: 'Mark products available/unavailable', on: s.sync.enabled, available: true, where: '/settings' },
    { icon: Calculator, name: 'Automatic selling-price recalculation', trigger: 'Supplier price or exchange rate changes', action: 'Recalculate (locked prices are skipped)', on: s.sync.autoRecalculate, available: true, where: '/settings' },
    { icon: EyeOff, name: 'Automatic product unpublishing', trigger: 'Supplier out of stock', action: s.sync.onUnavailable === 'unpublish' ? 'Remove from shop + alert' : 'Alert only', on: s.sync.enabled && s.sync.onUnavailable === 'unpublish', available: true, where: '/settings' },
    { icon: Bell, name: 'Admin alerts', trigger: `Price change ≥ ${s.sync.priceChangeThresholdPercent}% / out of stock / sync errors`, action: 'Notification in dashboard', on: true, available: true },
    { icon: Download, name: 'Automatic product imports', trigger: 'Saved searches', action: 'Queue new products', on: false, available: false, phase: 'needs AliExpress search API approval' },
    { icon: CheckSquare, name: 'Automatic order validation', trigger: 'Order paid', action: 'Check availability, price, shipping', on: false, available: false, phase: 'Phase 6' },
    { icon: PackageCheck, name: 'Automatic supplier-order placement', trigger: 'Order validated', action: 'Place AliExpress order', on: false, available: false, phase: 'Phase 6 — needs ordering API + payment method' },
    { icon: Truck, name: 'Tracking updates', trigger: 'Every few hours', action: 'Fetch tracking from AliExpress', on: false, available: false, phase: 'Phase 6' },
    { icon: Bell, name: 'Customer notifications (SMS/email)', trigger: 'Order shipped/delivered', action: 'Send message', on: false, available: false, phase: 'needs SMS/email provider' },
  ];

  return (
    <div>
      <PageHeader title="Automation Center" subtitle="What runs on its own, and what still needs you." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Dropshipping mode" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            {[['manual', 'Manual', 'Payment verified → you buy on AliExpress and paste the order number.'], ['semi_automatic', 'Semi-automatic', 'System validates payment, stock, price & shipping, then asks you to confirm.'], ['fully_automatic', 'Fully automatic', 'System places supplier orders within your purchase limits.']].map(([k, label, text]) => (
              <div key={k} className={`rounded-lg border p-3 text-sm ${s.dropshipMode === k ? 'border-brand-600 bg-brand-50 dark:bg-brand-700/20' : 'border-slate-200 opacity-60 dark:border-slate-800'}`}>
                <div className="flex items-center justify-between font-medium">{label}{s.dropshipMode === k ? <Badge tone="green">active</Badge> : <Badge>Phase 6</Badge>}</div>
                <p className="mt-1 text-xs text-slate-500">{text}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Semi- and fully-automatic modes unlock once your AliExpress app is approved for the ordering APIs and Phase 6 is built and tested in a sandbox. Live purchases are never made during testing.</p>
        </Card>
        <Card title={<span className="flex items-center gap-2"><ShieldOff className="h-4 w-4" />Emergency switch</span>}>
          <div className="flex items-center justify-between"><span className="text-sm">Automated supplier purchasing</span><Badge tone="red">OFF</Badge></div>
          <p className="mt-2 text-xs text-slate-500">Master switch is locked off in this version. When automation arrives, this switch stops every automatic purchase instantly, and purchase limits (max order value, minimum profit) must be set first.</p>
        </Card>
      </div>
      <div className="mt-4"><Notice>Automatic sync runs inside the importer server once an hour. On Render's free plan the server sleeps when nobody uses it, so schedules only run while it is awake — use a paid instance (or an uptime pinger) for reliable automation.</Notice></div>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px]"><thead className="bg-slate-50 dark:bg-slate-800/50"><tr><th className="th">Rule</th><th className="th">Trigger</th><th className="th">Action</th><th className="th">Status</th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.name} className="border-t border-slate-100 dark:border-slate-800">
              <td className="td"><span className="flex items-center gap-2"><r.icon className="h-4 w-4 text-slate-400" />{r.name}</span></td>
              <td className="td text-xs">{r.trigger}</td><td className="td text-xs">{r.action}</td>
              <td className="td">{r.available ? <span className="flex items-center gap-2"><Badge tone={r.on ? 'green' : 'slate'}>{r.on ? 'enabled' : 'disabled'}</Badge>{r.where && <Link className="text-xs text-brand-600" to={r.where}>Configure</Link>}</span> : <Badge tone="amber">Unavailable — {r.phase}</Badge>}</td>
            </tr>
          ))}</tbody></table>
      </div>
      <p className="mt-3 text-xs text-slate-500">Execution and error history for sync runs is in <Link className="text-brand-600" to="/sync">Inventory Synchronization</Link>; every admin action is in Settings → Audit log.</p>
    </div>
  );
}
