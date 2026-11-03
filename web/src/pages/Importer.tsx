import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Link2, PencilLine, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import { useSession } from '../lib/session';
import { Badge, Button, Card, Empty, ErrorBox, Field, Notice, PageHeader, Skeleton, statusTone, useApiData, useUi, cx } from '../components/ui';

export default function Importer() {
  const { store } = useSession();
  const { toast } = useUi();
  const [tab, setTab] = useState<'link' | 'manual'>('manual');
  const jobs = useApiData(() => api<{ jobs: any[] }>('/imports'), [store?.id]);
  const cats = useApiData(() => api<{ categories: any[] }>('/categories'), [store?.id]);
  const status = useApiData(() => api('/aliexpress/status'), [store?.id]);

  // poll while something is in progress
  const active = jobs.data?.jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => { if (!active) return; const t = setInterval(jobs.reload, 3000); return () => clearInterval(t); }, [active, jobs.reload]);
  useEffect(() => { if (status.data?.authorized) setTab('link'); }, [status.data?.authorized]);

  // --- import by link through the API
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);
  const queueLinks = async () => {
    const list = links.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    try {
      const r = await api('/imports', { body: { productIds: list } });
      const bad = r.jobs.filter((j: any) => j.status === 'failed').length;
      toast(bad ? 'error' : 'success', `${r.jobs.length - bad} queued${bad ? `, ${bad} links not recognised` : ''}`);
      setLinks(''); void jobs.reload();
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };

  // --- manual import
  const blank = { url: '', title: '', price: '', currency: 'USD', shipping: '', images: '', description: '', categoryId: '', stock: '', manualPrice: '' };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const [mErr, setMErr] = useState<string | null>(null);
  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMErr(null);
    try {
      const images = f.images.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      await api('/imports/manual', { body: {
        url: f.url, title: f.title, description: f.description, images, price: Number(f.price), currency: f.currency.toUpperCase(),
        shipping: f.shipping === '' ? null : Number(f.shipping), stock: f.stock === '' ? null : Number(f.stock),
        edits: { categoryId: f.categoryId || null, ...(f.manualPrice ? { manualPrice: Number(f.manualPrice), priceLocked: true } : {}) },
      } });
      toast('success', 'Product queued — it will appear in My Products as a draft');
      setF(blank); void jobs.reload();
    } catch (e) { setMErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Product Importer" subtitle="Bring AliExpress products into your store as drafts. Nothing goes live until you publish." />
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {([['link', 'Import by link (API)', Link2], ['manual', 'Manual import', PencilLine]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm', tab === k ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300')}><Icon className="h-4 w-4" />{label}</button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {tab === 'link' ? (
            <Card title="Paste AliExpress links">
              {status.data && !status.data.authorized && (
                <div className="mb-3"><Notice tone="warning">The AliExpress API is not connected, so these imports will fail. Use <b>Manual import</b>, or connect in <Link className="underline" to="/integrations">Integrations</Link>.</Notice></div>
              )}
              <Field label="One link or product id per line (up to 50)">
                <textarea className="input h-40 font-mono text-xs" placeholder={'https://www.aliexpress.com/item/1005006123456789.html\n1005005987654321'} value={links} onChange={(e) => setLinks(e.target.value)} />
              </Field>
              <p className="mt-2 text-xs text-slate-500">The importer fetches title, description, images, variants, price and shipping to Kenya. Duplicates are skipped automatically.</p>
              <div className="mt-3 flex justify-end"><Button icon={<Download className="h-4 w-4" />} loading={busy} onClick={queueLinks}>Queue import</Button></div>
            </Card>
          ) : (
            <Card title="Manual import">
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitManual}>
                <div className="sm:col-span-2"><Field label="AliExpress product link *"><input className="input" required value={f.url} onChange={set('url')} placeholder="https://www.aliexpress.com/item/1005006123456789.html" /></Field></div>
                <div className="sm:col-span-2"><Field label="Product title *"><input className="input" required minLength={3} value={f.title} onChange={set('title')} /></Field></div>
                <Field label="Supplier price *" hint="Price shown on AliExpress for 1 item"><input className="input" required type="number" step="0.01" min="0.01" value={f.price} onChange={set('price')} /></Field>
                <Field label="Currency *"><select className="input" value={f.currency} onChange={set('currency')}>{['USD', 'KES', 'EUR', 'CNY', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Supplier shipping to Kenya" hint="Leave empty if unknown — you must add it before publishing"><input className="input" type="number" step="0.01" min="0" value={f.shipping} onChange={set('shipping')} /></Field>
                <Field label="Stock shown by supplier" hint="Leave empty if not shown (we never assume unlimited)"><input className="input" type="number" min="0" value={f.stock} onChange={set('stock')} /></Field>
                <div className="sm:col-span-2"><Field label="Image links * (one per line, https)" hint="On AliExpress: right-click an image → Copy image address"><textarea className="input h-24 font-mono text-xs" required value={f.images} onChange={set('images')} /></Field></div>
                <div className="sm:col-span-2"><Field label="Description"><textarea className="input h-28" value={f.description} onChange={set('description')} /></Field></div>
                <Field label="Store category"><select className="input" value={f.categoryId} onChange={set('categoryId')}><option value="">— none —</option>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Fixed selling price (KES)" hint="Optional — locks the price instead of using pricing rules"><input className="input" type="number" min="1" value={f.manualPrice} onChange={set('manualPrice')} /></Field>
                {mErr && <div className="sm:col-span-2"><ErrorBox error={mErr} /></div>}
                <div className="flex justify-end sm:col-span-2"><Button loading={busy} icon={<Download className="h-4 w-4" />}>Import as draft</Button></div>
              </form>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card title="Import queue" actions={<Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={jobs.reload}>Refresh</Button>}>
            {jobs.error && <ErrorBox error={jobs.error} onRetry={jobs.reload} />}
            {jobs.loading && !jobs.data && <Skeleton className="h-40" />}
            {jobs.data && jobs.data.jobs.length === 0 && <Empty title="Queue is empty" />}
            <div className="max-h-[32rem] overflow-y-auto">
              {jobs.data?.jobs.map((j) => (
                <div key={j.id} className="border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs">#{j.supplierProductId}</span>
                    <Badge tone={statusTone(j.status)}>{j.status === 'running' ? 'importing…' : j.status}</Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                    <span>{j.source === 'manual' ? 'Manual' : 'API'} · {ago(j.createdAt)}</span>
                    {j.productId && <Link className="text-brand-600" to={`/products/${j.productId}`}>Open product</Link>}
                  </div>
                  {j.error && j.status !== 'duplicate' && <p className="mt-1 text-xs text-red-600">{j.error}</p>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
