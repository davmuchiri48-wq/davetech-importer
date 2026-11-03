import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Store, ShoppingBag, CheckCircle2, XCircle, PlugZap, Unplug } from 'lucide-react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { useSession } from '../lib/session';
import { Badge, Button, Card, ErrorBox, Field, Notice, PageHeader, Skeleton, useApiData, useUi } from '../components/ui';

export function ConnectStore({ first, existing }: { first?: boolean; existing?: { id: string; name: string; baseUrl: string } }) {
  const { refresh } = useSession();
  const { toast } = useUi();
  const [f, setF] = useState({ name: existing?.name || 'DaveTech Shop', baseUrl: existing?.baseUrl || 'https://davetech-shop.onrender.com', apiKey: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (existing) await api(`/stores/${existing.id}/connection`, { method: 'PUT', body: { name: f.name, baseUrl: f.baseUrl, ...(f.apiKey ? { apiKey: f.apiKey } : {}) } });
      else await api('/stores', { body: f });
      toast('success', existing ? 'Connection updated' : 'Shop connected'); setF({ ...f, apiKey: '' }); await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Store className="h-4 w-4" />{first ? 'Connect your shop to get started' : existing ? 'Shop connection' : 'Add another shop'}</span>}>
      {first && <p className="mb-4 text-sm text-slate-500">Davetech Importer publishes products to your DaveTech Shop and reads its orders. On Render, add an environment variable <code>IMPORTER_API_KEY</code> to the shop (a long random password, 32+ characters), redeploy it, then enter the same key here.</p>}
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Store name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Shop address"><input className="input" type="url" required value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} /></Field>
        <Field label={existing ? 'New API key (leave empty to keep the current one)' : 'Shop API key (IMPORTER_API_KEY)'}><input className="input font-mono" type="password" required={!existing} minLength={16} autoComplete="off" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} /></Field>
        {err && <ErrorBox error={err} />}
        <Button loading={busy}>{existing ? 'Save & test' : 'Connect & test'}</Button>
        <p className="text-xs text-slate-500">The key is encrypted on the server and never shown again. A free Render shop may take up to a minute to wake up.</p>
      </form>
    </Card>
  );
}

export default function Integrations() {
  const { store, isAdmin } = useSession();
  const { toast } = useUi();
  const [params, setParams] = useSearchParams();
  const ae = useApiData(() => api('/aliexpress/status'), [store?.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [shopHealth, setShopHealth] = useState<any>(null);
  const [test, setTest] = useState<any>(null);
  const [probe, setProbe] = useState('');

  useEffect(() => {
    const r = params.get('aliexpress');
    if (r) { toast(r === 'connected' ? 'success' : 'error', r === 'connected' ? 'AliExpress account connected' : r); params.delete('aliexpress'); setParams(params, { replace: true }); void ae.reload(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); } };

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Your shop, AliExpress and other services." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2"><Store className="h-4 w-4" />{store?.name}</span>} actions={<Button size="sm" variant="secondary" loading={busy === 'shop'} onClick={() => run('shop', async () => setShopHealth(await api('/store/test', { body: {} })))}>Test connection</Button>}>
            <p className="text-sm">{store?.baseUrl}</p>
            {shopHealth && <p className="mt-2 flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" />Connected to "{shopHealth.store_name}" · API v{shopHealth.version} · {shopHealth.currency}</p>}
          </Card>
          {isAdmin && store && <ConnectStore existing={store} />}
          {isAdmin && <ConnectStore />}
        </div>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2"><ShoppingBag className="h-4 w-4" />AliExpress Open Platform</span>}>
            {ae.error && <ErrorBox error={ae.error} onRetry={ae.reload} />}
            {!ae.data ? <Skeleton className="h-40" /> : <>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">App key & secret on server {ae.data.appConfigured ? <Badge tone="green">set</Badge> : <Badge tone="red">missing</Badge>}</div>
                <div className="flex items-center justify-between">Account authorization {ae.data.authorized ? <Badge tone="green">{ae.data.account || 'connected'}</Badge> : <Badge tone="amber">not connected</Badge>}</div>
                {ae.data.expiresAt && <div className="flex items-center justify-between text-xs text-slate-500">Token expires<span>{date(new Date(ae.data.expiresAt).toISOString())}</span></div>}
              </div>
              {!ae.data.appConfigured && (
                <div className="mt-4"><Notice tone="warning">
                  <b>Not set up yet.</b> 1) Register at <a className="underline" href="https://openservice.aliexpress.com" target="_blank" rel="noreferrer">openservice.aliexpress.com</a> as a developer. 2) Create an app in the <b>Dropshipping</b> category and request the APIs listed below. 3) Set the callback URL to <code className="break-all">{ae.data.redirectUri}</code>. 4) When approved, add <code>ALIEXPRESS_APP_KEY</code> and <code>ALIEXPRESS_APP_SECRET</code> to the importer on Render. Until then, use Manual import.
                </Notice></div>
              )}
              {isAdmin && ae.data.appConfigured && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button icon={<PlugZap className="h-4 w-4" />} loading={busy === 'connect'} onClick={() => run('connect', async () => { const r = await api('/aliexpress/connect', { body: {} }); window.location.href = r.url; })}>{ae.data.authorized ? 'Reconnect' : 'Connect AliExpress account'}</Button>
                  {ae.data.authorized && <Button variant="secondary" icon={<Unplug className="h-4 w-4" />} loading={busy === 'disc'} onClick={() => run('disc', async () => { await api('/aliexpress/disconnect', { body: {} }); await ae.reload(); })}>Disconnect</Button>}
                </div>
              )}
              {ae.data.authorized && (
                <div className="mt-4 space-y-2">
                  <div className="flex gap-2"><input className="input" placeholder="Optional: a product id to test details" value={probe} onChange={(e) => setProbe(e.target.value)} /><Button variant="secondary" loading={busy === 'test'} onClick={() => run('test', async () => setTest(await api('/aliexpress/test', { body: { productId: probe } })))}>Test API</Button></div>
                  {test && Object.entries(test.results).map(([k, v]: any) => <div key={k} className="flex items-start gap-2 text-sm">{v.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}<span><b>{k}</b> {v.ok ? 'works' : v.message}</span></div>)}
                </div>
              )}
              <div className="mt-5"><span className="label">API operations used (request these for your app)</span>
                <table className="w-full text-xs"><tbody>{Object.entries(ae.data.methods).map(([k, v]) => <tr key={k} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1">{k}</td><td className="py-1 font-mono">{v as string}</td></tr>)}</tbody></table>
              </div>
            </>}
          </Card>
          <Card title="Other services">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">M-Pesa (Daraja) <Badge tone="blue">configured in the shop</Badge></li>
              <li className="flex justify-between">Exchange rates <Badge tone="green">Settings → Currency</Badge></li>
              <li className="flex justify-between">Email / SMS notifications <Badge tone="amber">not available yet</Badge></li>
              <li className="flex justify-between">Description translation <Badge tone="amber">not available yet</Badge></li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
