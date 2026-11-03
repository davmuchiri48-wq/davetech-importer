import { useEffect, useState } from 'react';
import { Save, RefreshCw, UserPlus, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { useSession } from '../lib/session';
import { Badge, Button, Card, ErrorBox, Field, Notice, PageHeader, Skeleton, useApiData, useUi } from '../components/ui';

export default function SettingsPage() {
  const { store, isAdmin, user } = useSession();
  const { toast } = useUi();
  const settings = useApiData(() => api('/settings'), [store?.id]);
  const team = useApiData(() => (isAdmin ? api('/team') : Promise.resolve(null)), [store?.id, isAdmin]);
  const logs = useApiData(() => (isAdmin ? api('/audit') : Promise.resolve(null)), [store?.id, isAdmin]);
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newCur, setNewCur] = useState('');
  const [invite, setInvite] = useState({ email: '', role: 'staff' });
  useEffect(() => { if (settings.data) setS(settings.data); }, [settings.data]);

  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); try { await fn(); toast('success', ok); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); } };
  const save = () => run('save', async () => { const r = await api('/settings', { method: 'PUT', body: { exchange: { provider: s.exchange.provider, manualRates: s.exchange.manualRates }, sync: s.sync } }); setS(r); }, 'Settings saved');

  if (settings.error) return <ErrorBox error={settings.error} onRetry={settings.reload} />;
  if (!s) return <Skeleton className="h-96" />;
  const sync = (k: string, v: unknown) => setS({ ...s, sync: { ...s.sync, [k]: v } });
  const dis = !isAdmin;

  return (
    <div>
      <PageHeader title="Settings" subtitle={dis ? 'Only administrators can change settings.' : undefined} actions={isAdmin && <Button icon={<Save className="h-4 w-4" />} loading={busy === 'save'} onClick={save}>Save settings</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Currency & exchange rates">
          <p className="mb-3 text-sm">Store currency: <b>{s.storeCurrency}</b> (supplier currencies are kept as they are and converted for pricing).</p>
          <Field label="Exchange rate source">
            <select className="input" disabled={dis} value={s.exchange.provider} onChange={(e) => setS({ ...s, exchange: { ...s.exchange, provider: e.target.value } })}>
              <option value="manual">Manual rates (you type them)</option><option value="open_er_api">Automatic daily rates (open.er-api.com, free)</option>
            </select>
          </Field>
          <div className="mt-3 space-y-2">
            <span className="label">{s.exchange.provider === 'manual' ? 'Manual rates' : 'Fallback rates (used if the service is down)'} — 1 unit = ? {s.storeCurrency}</span>
            {Object.entries(s.exchange.manualRates).filter(([c]) => c !== s.storeCurrency).map(([c, v]) => (
              <div key={c} className="flex items-center gap-2"><span className="w-12 font-mono text-sm">{c}</span>
                <input className="input" type="number" step="0.0001" min="0.0001" disabled={dis} value={v as number} onChange={(e) => setS({ ...s, exchange: { ...s.exchange, manualRates: { ...s.exchange.manualRates, [c]: Number(e.target.value) } } })} />
                {!dis && <Button size="sm" variant="ghost" aria-label="Remove" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { const m = { ...s.exchange.manualRates }; delete m[c]; setS({ ...s, exchange: { ...s.exchange, manualRates: m } }); }} />}
              </div>
            ))}
            {!dis && <div className="flex gap-2"><input className="input !w-24 uppercase" maxLength={3} placeholder="EUR" value={newCur} onChange={(e) => setNewCur(e.target.value.toUpperCase())} /><Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} disabled={!/^[A-Z]{3}$/.test(newCur)} onClick={() => { setS({ ...s, exchange: { ...s.exchange, manualRates: { ...s.exchange.manualRates, [newCur]: 1 } } }); setNewCur(''); }}>Add currency</Button></div>}
          </div>
          {s.exchange.provider === 'open_er_api' && (
            <div className="mt-3 flex items-center justify-between gap-2 text-sm">
              <span>Last fetched: {date(s.exchange.lastFetchedAt)}{s.exchange.lastRates?.USD && <> · 1 USD = {s.exchange.lastRates.USD} {s.storeCurrency}</>}</span>
              {!dis && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy === 'rates'} onClick={() => run('rates', async () => { await api('/settings/rates/refresh', { body: {} }); await settings.reload(); }, 'Rates updated')}>Fetch now</Button>}
            </div>
          )}
        </Card>

        <Card title="Synchronization">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={dis} checked={s.sync.enabled} onChange={(e) => sync('enabled', e.target.checked)} /> Check supplier prices & stock automatically</label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Every (hours)"><input className="input" type="number" min="1" max="168" disabled={dis} value={s.sync.everyHours} onChange={(e) => sync('everyHours', Number(e.target.value))} /></Field>
              <Field label="Alert when price changes by (%)"><input className="input" type="number" min="0" max="100" disabled={dis} value={s.sync.priceChangeThresholdPercent} onChange={(e) => sync('priceChangeThresholdPercent', Number(e.target.value))} /></Field>
            </div>
            <Field label="When a supplier product becomes unavailable">
              <select className="input" disabled={dis} value={s.sync.onUnavailable} onChange={(e) => sync('onUnavailable', e.target.value)}><option value="unpublish">Remove it from the shop (recommended)</option><option value="mark_only">Only mark it and alert me</option></select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={dis} checked={s.sync.autoRecalculate} onChange={(e) => sync('autoRecalculate', e.target.checked)} /> Recalculate selling prices when supplier price changes (locked prices are never changed)</label>
            <Notice>Only products imported through the AliExpress API can be checked automatically.</Notice>
          </div>
        </Card>

        {isAdmin && (
          <Card title="Team">
            <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void run('inv', async () => { await api('/team/invite', { body: invite }); setInvite({ email: '', role: 'staff' }); await team.reload(); }, 'Invite saved — they can now create an account with that email'); }}>
              <input className="input flex-1" type="email" required placeholder="email@example.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
              <select className="input !w-auto" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option value="staff">Staff</option><option value="admin">Admin</option></select>
              <Button icon={<UserPlus className="h-4 w-4" />} loading={busy === 'inv'}>Invite</Button>
            </form>
            {team.data?.users.map((u: any) => (
              <div key={u.uid} className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
                <span className="truncate">{u.email} {u.disabled && <Badge tone="red">disabled</Badge>}</span>
                {u.uid === user?.uid ? <Badge tone="violet">you · {u.role}</Badge> : (
                  <div className="flex gap-1">
                    <select className="input !w-auto !py-1 text-xs" value={u.role} onChange={(e) => run(`r${u.uid}`, async () => { await api(`/team/${u.uid}`, { method: 'PUT', body: { role: e.target.value } }); await team.reload(); }, 'Role updated')}><option value="staff">Staff</option><option value="admin">Admin</option></select>
                    <Button size="sm" variant="secondary" onClick={() => run(`d${u.uid}`, async () => { await api(`/team/${u.uid}`, { method: 'PUT', body: { disabled: !u.disabled } }); await team.reload(); }, u.disabled ? 'Enabled' : 'Disabled')}>{u.disabled ? 'Enable' : 'Disable'}</Button>
                  </div>
                )}
              </div>
            ))}
            {team.data?.invites.map((i: any) => <div key={i.email} className="flex justify-between py-2 text-sm text-slate-500"><span>{i.email}</span><Badge tone="amber">invited · {i.role}</Badge></div>)}
            <p className="mt-2 text-xs text-slate-500">Staff can import, edit and publish products and handle orders. Only admins can change settings, pricing rules, integrations, delete products or unlock prices.</p>
          </Card>
        )}

        {isAdmin && (
          <Card title="Audit log">
            <div className="max-h-80 overflow-y-auto">
              {logs.data?.logs.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
              {logs.data?.logs.map((l: any) => <div key={l.id} className="border-b border-slate-100 py-1.5 text-xs last:border-0 dark:border-slate-800"><span className="text-slate-500">{date(l.at)}</span> · <b>{l.action}</b> · {l.target}</div>)}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
