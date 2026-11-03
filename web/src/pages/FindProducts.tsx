import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ExternalLink, Plus, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Notice, PageHeader, Skeleton, useUi } from '../components/ui';

type Item = { productId: string; title: string; image: string; price: number | null; currency: string; url: string; orders?: number | null };

export default function FindProducts() {
  const { toast } = useUi();
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ message: string; manualWorkflow?: string; reason?: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ id: string; data?: any; loading: boolean } | null>(null);
  const [queueing, setQueueing] = useState(false);

  const search = async (p = 1) => {
    if (keyword.trim().length < 2) return;
    setLoading(true); setFailure(null); setPage(p);
    try {
      const q = new URLSearchParams({ keyword: keyword.trim(), page: String(p), ...(sort ? { sort } : {}) });
      const r = await api(`/aliexpress/search?${q}`);
      if (r.ok) setItems(r.data.items); else { setItems(null); setFailure(r); }
    } catch (e) { setFailure({ message: (e as Error).message }); } finally { setLoading(false); }
  };

  const openPreview = async (id: string) => {
    setPreview({ id, loading: true });
    try { setPreview({ id, loading: false, data: await api(`/aliexpress/products/${id}`) }); }
    catch (e) { setPreview({ id, loading: false, data: { ok: false, message: (e as Error).message } }); }
  };

  const queue = async (ids: string[]) => {
    setQueueing(true);
    try {
      const r = await api('/imports', { body: { productIds: ids } });
      const dup = r.jobs.filter((j: any) => j.status === 'duplicate').length;
      toast('success', `${r.jobs.length - dup} queued for import${dup ? `, ${dup} already in your store` : ''}`);
      setSelected(new Set());
    } catch (e) { toast('error', (e as Error).message); } finally { setQueueing(false); }
  };

  const shown = (items || []).filter((i) => (!minPrice || (i.price ?? 0) >= Number(minPrice)) && (!maxPrice || (i.price ?? Infinity) <= Number(maxPrice)));
  const toggle = (id: string) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };

  return (
    <div>
      <PageHeader title="Find Products" subtitle="Search AliExpress through the official API (ships-to-Kenya prices)."
        actions={selected.size > 0 && <Button icon={<Plus className="h-4 w-4" />} loading={queueing} onClick={() => queue([...selected])}>Add {selected.size} to import queue</Button>} />
      <Card>
        <form className="grid gap-3 sm:grid-cols-6" onSubmit={(e) => { e.preventDefault(); void search(1); }}>
          <input className="input sm:col-span-3" placeholder="Product name or keyword, e.g. wireless earbuds" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="">Best match</option><option value="min_price,asc">Price: low to high</option><option value="min_price,desc">Price: high to low</option><option value="orders,desc">Most orders</option>
          </select>
          <div className="flex gap-2 sm:col-span-2">
            <input className="input" type="number" min="0" placeholder="Min price" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
            <input className="input" type="number" min="0" placeholder="Max price" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
            <Button icon={<Search className="h-4 w-4" />} loading={loading}>Search</Button>
          </div>
        </form>
      </Card>

      <div className="mt-4">
        {failure && (
          <div className="space-y-3">
            <ErrorBox error={failure.message} />
            {failure.manualWorkflow && <Notice><b>Manual option:</b> {failure.manualWorkflow} <Link className="ml-1 font-medium underline" to="/import">Open Product Importer</Link></Notice>}
            {(failure.reason === 'not_configured' || failure.reason === 'not_authorized') && <Notice tone="warning">Set up the AliExpress connection in <Link className="underline" to="/integrations">Integrations</Link>.</Notice>}
          </div>
        )}
        {loading && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>}
        {!loading && items && shown.length === 0 && <Empty title="No products found" text="Try another keyword or widen the price filter." />}
        {!loading && shown.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {shown.map((i) => (
                <div key={i.productId} className="card overflow-hidden">
                  <button className="block w-full" onClick={() => openPreview(i.productId)}>
                    {i.image ? <img src={i.image} alt="" loading="lazy" className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-slate-100" />}
                  </button>
                  <div className="space-y-2 p-3">
                    <p className="line-clamp-2 text-sm">{i.title}</p>
                    <div className="flex items-center justify-between text-sm">
                      <b>{money(i.price, i.currency)}</b>
                      {i.orders != null && <span className="text-xs text-slate-500">{i.orders} orders</span>}
                    </div>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.has(i.productId)} onChange={() => toggle(i.productId)} /> Select</label>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => search(page - 1)}>Previous</Button>
              <Button variant="secondary" onClick={() => search(page + 1)}>Next</Button>
            </div>
          </>
        )}
        {!items && !failure && !loading && <Empty title="Search to discover products" text="Results come straight from the AliExpress API. If your app doesn't have search permission yet, you can still import by link in Product Importer." />}
      </div>

      <Drawer open={Boolean(preview)} onClose={() => setPreview(null)} title="Product preview" wide
        footer={preview?.data?.ok && <>
          <a href={preview.data.data.supplierUrl} target="_blank" rel="noreferrer"><Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />}>Open on AliExpress</Button></a>
          <Button disabled={Boolean(preview.data.duplicateOf)} loading={queueing} onClick={() => queue([preview.id])}>{preview.data.duplicateOf ? 'Already imported' : 'Add to Import Queue'}</Button>
        </>}>
        {preview?.loading && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {preview?.data && !preview.data.ok && <div className="space-y-3"><ErrorBox error={preview.data.message} />{preview.data.manualWorkflow && <Notice>{preview.data.manualWorkflow}</Notice>}</div>}
        {preview?.data?.ok && (() => {
          const s = preview.data.data;
          return (
            <div className="space-y-4">
              <div className="flex gap-2 overflow-x-auto">{s.images.map((u: string) => <img key={u} src={u} alt="" className="h-28 w-28 shrink-0 rounded-lg object-cover" />)}</div>
              <h3 className="font-semibold">{s.title}</h3>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="blue">From {money(s.price, s.currency)}</Badge>
                <Badge>{s.shipping == null ? 'Shipping: check at import' : `Shipping ${money(s.shipping, s.currency)}`}</Badge>
                <Badge tone={s.stock == null ? 'slate' : s.stock > 0 ? 'green' : 'red'}>{s.stock == null ? 'Stock not supplied' : `${s.stock} in stock`}</Badge>
                {s.storeName && <Badge tone="violet">Seller: {s.storeName}</Badge>}
              </div>
              {s.variants.length > 0 && (
                <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Variant</th><th className="th">Price</th><th className="th">Stock</th></tr></thead>
                  <tbody>{s.variants.map((v: any) => <tr key={v.sku} className="border-t border-slate-100 dark:border-slate-800"><td className="td">{Object.values(v.attributes).join(' / ') || v.sku}</td><td className="td">{money(v.supplierPrice, s.currency)}</td><td className="td">{v.stock ?? '—'}</td></tr>)}</tbody></table></div>
              )}
            </div>
          );
        })()}
      </Drawer>
    </div>
  );
}
