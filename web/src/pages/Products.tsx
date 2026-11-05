import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ExternalLink, Copy, Trash2, Upload, EyeOff, Archive, RefreshCw, Star, X, Lock, Unlock, Download } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { money, ago, date, downloadCsv } from '../lib/format';
import { useSession } from '../lib/session';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Notice, PageHeader, Skeleton, statusTone, useApiData, useUi, cx } from '../components/ui';
import type { Product } from '../../../shared/types';

export default function Products() {
  const { store } = useSession();
  const { id } = useParams();
  const nav = useNavigate();
  const { toast, confirm } = useUi();
  const list = useApiData(() => api<{ products: Product[] }>('/products'), [store?.id]);
  const cats = useApiData(() => api<{ categories: any[] }>('/categories'), [store?.id]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [avail, setAvail] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState('new');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const rows = useMemo(() => {
    let r = list.data?.products || [];
    if (q) { const s = q.toLowerCase(); r = r.filter((p) => p.name.toLowerCase().includes(s) || p.supplierProductId.includes(s) || p.sku.toLowerCase().includes(s)); }
    if (status) r = r.filter((p) => p.status === status);
    if (avail) r = r.filter((p) => p.availability === avail);
    if (cat) r = r.filter((p) => (cat === 'none' ? !p.categoryId : p.categoryId === cat));
    const price = (p: Product) => p.pricing?.sellingPrice ?? 0;
    const sorters: Record<string, (a: Product, b: Product) => number> = {
      new: (a, b) => b.createdAt.localeCompare(a.createdAt), name: (a, b) => a.name.localeCompare(b.name),
      price_asc: (a, b) => price(a) - price(b), price_desc: (a, b) => price(b) - price(a),
      profit: (a, b) => (b.pricing?.expectedProfit ?? 0) - (a.pricing?.expectedProfit ?? 0),
    };
    return [...r].sort(sorters[sort]);
  }, [list.data, q, status, avail, cat, sort]);
  const catName = (cid: string | null) => cats.data?.categories.find((c) => c.id === cid)?.name || '—';

  const bulk = async (action: string, categoryId?: string | null) => {
    if (action === 'archive' && !(await confirm({ title: 'Archive products?', text: `${sel.size} products will be removed from the shop and archived.`, danger: true, confirmLabel: 'Archive' }))) return;
    setBulkBusy(true);
    try {
      const r = await api('/products-bulk', { body: { ids: [...sel], action, categoryId } });
      const failed = r.results.filter((x: any) => !x.ok);
      if (failed.length) toast('error', `${failed.length} failed: ${failed[0].error}`); else toast('success', `Done for ${r.results.length} products`);
      setSel(new Set()); void list.reload();
    } catch (e) { toast('error', (e as Error).message); } finally { setBulkBusy(false); }
  };

  const exportCsv = () => downloadCsv('products.csv', rows.map((p) => ({
    name: p.name, status: p.status, availability: p.availability, category: catName(p.categoryId), supplier_id: p.supplierProductId,
    supplier_url: p.supplier.supplierUrl, supplier_price: p.supplier.price, currency: p.supplier.currency, landed_cost_kes: p.pricing?.landedCost,
    selling_price_kes: p.pricing?.sellingPrice, expected_profit_kes: p.pricing?.expectedProfit, price_locked: p.priceLocked,
  })));

  return (
    <div>
      <PageHeader title="My Products" subtitle={`${list.data?.products.length ?? '…'} products`}
        actions={<><Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button><Link to="/import"><Button>Import products</Button></Link></>} />
      <Card>
        <div className="grid gap-2 sm:grid-cols-6">
          <input className="input sm:col-span-2" placeholder="Search name, SKU or AliExpress id" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['draft', 'published', 'unpublished', 'archived'].map((s) => <option key={s}>{s}</option>)}</select>
          <select className="input" value={avail} onChange={(e) => setAvail(e.target.value)} aria-label="Availability"><option value="">Any availability</option>{['available', 'unavailable', 'unknown'].map((s) => <option key={s}>{s}</option>)}</select>
          <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option><option value="none">No category</option>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="new">Newest</option><option value="name">Name</option><option value="price_asc">Price ↑</option><option value="price_desc">Price ↓</option><option value="profit">Profit ↓</option></select>
        </div>
        {sel.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 p-2 text-sm dark:bg-brand-700/20">
            <b className="px-2">{sel.size} selected</b>
            <Button size="sm" loading={bulkBusy} onClick={() => bulk('publish')}>Publish</Button>
            <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => bulk('unpublish')}>Unpublish</Button>
            <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => bulk('archive')}>Archive</Button>
            <select className="input !w-auto !py-1 text-xs" defaultValue="" onChange={(e) => { if (e.target.value) void bulk('category', e.target.value === 'none' ? null : e.target.value); e.target.value = ''; }} aria-label="Set category">
              <option value="">Set category…</option><option value="none">No category</option>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
          </div>
        )}
      </Card>

      <div className="card mt-4 overflow-x-auto">
        {list.error && <div className="p-4"><ErrorBox error={list.error} onRetry={list.reload} /></div>}
        {list.loading && !list.data && <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
        {list.data && rows.length === 0 && <Empty title={list.data.products.length ? 'No products match these filters' : 'No products yet'} action={!list.data.products.length && <Link to="/import"><Button>Import your first product</Button></Link>} />}
        {rows.length > 0 && (
          <table className="w-full min-w-[800px]">
            <thead className="bg-slate-50 dark:bg-slate-800/50"><tr>
              <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              <th className="th">Product</th><th className="th">Category</th><th className="th">Landed cost</th><th className="th">Selling price</th><th className="th">Profit</th><th className="th">Status</th><th className="th">Supplier</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40" onClick={() => nav(`/products/${p.id}`)}>
                  <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Select" checked={sel.has(p.id)} onChange={() => { const s = new Set(sel); s.has(p.id) ? s.delete(p.id) : s.add(p.id); setSel(s); }} /></td>
                  <td className="td"><div className="flex items-center gap-3">{p.mainImage ? <img src={p.mainImage} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-slate-100" />}<div className="min-w-0"><div className="max-w-xs truncate font-medium">{p.name}</div><div className="text-xs text-slate-500">#{p.supplierProductId}{p.syncError && <span className="ml-2 text-red-600">⚠ {p.syncError.slice(0, 40)}</span>}</div></div></div></td>
                  <td className="td">{catName(p.categoryId)}</td>
                  <td className="td">{money(p.pricing?.landedCost)}</td>
                  <td className="td font-medium">{money(p.pricing?.sellingPrice)}{p.priceLocked && <Lock className="ml-1 inline h-3 w-3 text-slate-400" />}</td>
                  <td className={cx('td', (p.pricing?.expectedProfit ?? 0) < 0 && 'text-red-600')}>{money(p.pricing?.expectedProfit)}</td>
                  <td className="td"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                  <td className="td"><Badge tone={statusTone(p.availability)}>{p.availability}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {id && <ProductEditor id={id} categories={cats.data?.categories || []} onClose={() => nav('/products')} onChanged={list.reload} />}
    </div>
  );
}

function ProductEditor({ id, categories, onClose, onChanged }: { id: string; categories: any[]; onClose: () => void; onChanged: () => void }) {
  const { isAdmin, store } = useSession();
  const { toast, confirm } = useUi();
  const nav = useNavigate();
  const { data, error, loading, reload, setData } = useApiData(() => api<{ product: Product; syncHistory: any[] }>(`/products/${id}`), [id, store?.id]);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newImg, setNewImg] = useState('');

  useEffect(() => {
    if (!data) return;
    const p = data.product;
    setForm({
      name: p.name, description: p.description, images: p.images, mainImage: p.mainImage, categoryId: p.categoryId || '', sku: p.sku,
      seoTitle: p.seoTitle, seoDescription: p.seoDescription, manualPrice: p.manualPrice ?? '', priceLocked: p.priceLocked,
      supplierShipping: p.supplier.shipping ?? '', supplierPrice: p.supplier.price ?? '', supplierStock: p.supplier.stock ?? '',
      overrideMarkup: p.pricingOverride?.markupValue ?? '', overrideType: p.pricingOverride?.markupType || 'percent',
    });
  }, [data]);

  const save = async () => {
    setBusy('save');
    try {
      const body: any = {
        name: form.name, description: form.description, images: form.images, mainImage: form.mainImage, categoryId: form.categoryId || null,
        sku: form.sku, seoTitle: form.seoTitle, seoDescription: form.seoDescription,
        manualPrice: form.manualPrice === '' ? null : Number(form.manualPrice), priceLocked: Boolean(form.priceLocked && form.manualPrice !== ''),
        supplierShipping: form.supplierShipping === '' ? null : Number(form.supplierShipping),
        pricingOverride: form.overrideMarkup === '' ? null : { markupType: form.overrideType, markupValue: Number(form.overrideMarkup) },
      };
      if (data?.product.supplier.source !== 'aliexpress_api') {
        if (form.supplierPrice !== '') body.supplierPrice = Number(form.supplierPrice);
        body.supplierStock = form.supplierStock === '' ? null : Number(form.supplierStock);
      }
      const r = await api<{ product: Product }>(`/products/${id}`, { method: 'PUT', body });
      setData({ ...data!, product: r.product }); toast('success', 'Saved'); onChanged();
      return true;
    } catch (e) { toast('error', (e as Error).message); return false; } finally { setBusy(null); }
  };

  const action = async (a: string, extra: any = {}) => {
    if (a === 'archive' && !(await confirm({ title: 'Archive product?', text: 'It will be removed from the shop. You can still see it here.', confirmLabel: 'Archive' }))) return;
    if (a === 'publish' && !(await save())) return;
    setBusy(a);
    try {
      const r = await api(`/products/${id}/${a}`, { body: extra });
      if (a === 'duplicate') { toast('success', 'Copy created'); onChanged(); nav(`/products/${r.result.id}`); return; }
      if (a === 'sync') toast(r.result.failed ? 'error' : 'success', r.result.failed ? r.result.errors[0] : r.result.skippedManual ? 'Manual imports are not synced with AliExpress — update the supplier price yourself' : 'Synchronized');
      else toast('success', a === 'publish' ? 'Published to your shop' : `Product ${a}ed`);
      void reload(); onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'loss' && await confirm({ title: 'Sell at a loss?', text: 'The selling price is below the landed cost. Publish anyway?', danger: true, confirmLabel: 'Publish at a loss' })) {
        return action('publish', { allowLoss: true });
      }
      toast('error', (e as Error).message);
    } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete product?', text: 'This removes it here and from the shop (the shop hides it instead if it has orders).', danger: true, confirmLabel: 'Delete' }))) return;
    setBusy('delete');
    try { await api(`/products/${id}`, { method: 'DELETE' }); toast('success', 'Deleted'); onChanged(); onClose(); }
    catch (e) { toast('error', (e as Error).message); setBusy(null); }
  };

  const p = data?.product;
  const pr = p?.pricing;
  const f = (k: string) => ({ value: form?.[k] ?? '', onChange: (e: any) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <Drawer open onClose={onClose} wide title={p ? <span className="flex items-center gap-2">{p.name.slice(0, 50)} <Badge tone={statusTone(p.status)}>{p.status}</Badge></span> : 'Product'}
      footer={p && form && <>
        {isAdmin && <Button variant="ghost" className="mr-auto text-red-600" icon={<Trash2 className="h-4 w-4" />} loading={busy === 'delete'} onClick={remove}>Delete</Button>}
        <Button variant="secondary" icon={<Copy className="h-4 w-4" />} loading={busy === 'duplicate'} onClick={() => action('duplicate')}>Duplicate</Button>
        {p.status === 'published' && <Button variant="secondary" icon={<EyeOff className="h-4 w-4" />} loading={busy === 'unpublish'} onClick={() => action('unpublish')}>Unpublish</Button>}
        {p.status !== 'archived' && <Button variant="secondary" icon={<Archive className="h-4 w-4" />} loading={busy === 'archive'} onClick={() => action('archive')}>Archive</Button>}
        <Button variant="secondary" loading={busy === 'save'} onClick={save}>Save draft</Button>
        <Button icon={<Upload className="h-4 w-4" />} loading={busy === 'publish'} disabled={p.availability === 'unavailable'} onClick={() => action('publish')}>{p.status === 'published' ? 'Save & update shop' : 'Save & publish'}</Button>
      </>}>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !p && <Skeleton className="h-96" />}
      {p && form && (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            {p.availability === 'unavailable' && <Notice tone="warning">The supplier shows this item as out of stock. It can't be published.</Notice>}
            {p.syncError && <ErrorBox error={p.syncError} />}
            <Field label="Product name"><input className="input" {...f('name')} /></Field>
            <div>
              <span className="label">Images — click ★ to choose the main image</span>
              <div className="flex flex-wrap gap-2">
                {form.images.map((u: string) => (
                  <div key={u} className={cx('relative h-20 w-20 overflow-hidden rounded-lg border-2', form.mainImage === u ? 'border-brand-600' : 'border-transparent')}>
                    <img src={u} alt="" className="h-full w-full object-cover" />
                    <button className="absolute left-1 top-1 rounded bg-white/90 p-0.5" title="Main image" onClick={() => setForm({ ...form, mainImage: u })}><Star className={cx('h-3 w-3', form.mainImage === u && 'fill-amber-400 text-amber-500')} /></button>
                    <button className="absolute right-1 top-1 rounded bg-white/90 p-0.5" title="Remove" onClick={() => setForm({ ...form, images: form.images.filter((x: string) => x !== u), mainImage: form.mainImage === u ? form.images.find((x: string) => x !== u) || '' : form.mainImage })}><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2"><input className="input" placeholder="Add image link (https://…)" value={newImg} onChange={(e) => setNewImg(e.target.value)} />
                <Button variant="secondary" onClick={() => { if (/^https:\/\//.test(newImg)) { setForm({ ...form, images: [...form.images, newImg], mainImage: form.mainImage || newImg }); setNewImg(''); } else toast('error', 'Image link must start with https://'); }}>Add</Button></div>
            </div>
            <Field label="Description"><textarea className="input h-40" {...f('description')} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category"><select className="input" {...f('categoryId')}><option value="">— none —</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="SKU"><input className="input" {...f('sku')} /></Field>
              <Field label="SEO title"><input className="input" maxLength={120} {...f('seoTitle')} /></Field>
              <Field label="Slug"><input className="input" value={p.slug} disabled /></Field>
            </div>
            <Field label="SEO description"><textarea className="input h-16" maxLength={320} {...f('seoDescription')} /></Field>
            {p.variants.length > 0 && (
              <div><span className="label">Variants (from supplier)</span>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800"><table className="w-full"><thead><tr><th className="th">Options</th><th className="th">SKU</th><th className="th">Supplier price</th><th className="th">Stock</th></tr></thead>
                  <tbody>{p.variants.map((v) => <tr key={v.sku} className="border-t border-slate-100 dark:border-slate-800"><td className="td">{Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(', ') || '—'}</td><td className="td font-mono text-xs">{v.sku}</td><td className="td">{money(v.supplierPrice, p.supplier.currency)}</td><td className="td">{v.stock ?? 'not supplied'}</td></tr>)}</tbody></table></div>
                <p className="mt-1 text-xs text-slate-500">The shop currently sells one price per product (the lowest variant). Customers pick colour/size in order notes.</p>
              </div>
            )}
          </div>

          <div className="space-y-4 lg:col-span-2">
            <Card title="Pricing">
              <div className="grid grid-cols-2 gap-3">
                {p.supplier.source !== 'aliexpress_api' && <Field label={`Supplier price (${p.supplier.currency})`}><input className="input" type="number" step="0.01" {...f('supplierPrice')} /></Field>}
                {p.supplier.source !== 'aliexpress_api' && <Field label="Supplier's stock"><input className="input" type="number" min="0" placeholder="unknown" {...f('supplierStock')} /></Field>}
                <Field label={p.supplier.source === 'local' ? 'Rider / delivery cost (KSh)' : `Supplier shipping (${p.supplier.currency})`}><input className="input" type="number" step="0.01" min="0" placeholder="unknown" {...f('supplierShipping')} /></Field>
                <Field label="Product markup"><div className="flex gap-1"><input className="input" type="number" min="0" placeholder="rule" {...f('overrideMarkup')} /><select className="input !w-16 !px-1" {...f('overrideType')}><option value="percent">%</option><option value="fixed">KES</option></select></div></Field>
                <Field label="Manual price (KES)"><input className="input" type="number" min="1" {...f('manualPrice')} /></Field>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.priceLocked} disabled={p.priceLocked && !isAdmin} onChange={(e) => setForm({ ...form, priceLocked: e.target.checked })} />
                  {form.priceLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />} Lock manual price (sync never changes it{p.priceLocked && !isAdmin ? '; only admins can unlock' : ''})
                </label>
              </div>
              {pr ? (
                <dl className="mt-4 space-y-1 text-sm">
                  {[['Supplier cost', pr.supplierCostConverted], ['Shipping cost', pr.shippingConverted], ['Additional costs', pr.additionalCosts], ['Landed cost', pr.landedCost], ['Markup', pr.markupAmount], ['Calculated price', pr.calculatedPrice]].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd>{money(v as number)}</dd></div>
                  ))}
                  <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold dark:border-slate-700"><dt>Selling price{pr.usedManualPrice && ' (manual)'}</dt><dd>{money(pr.sellingPrice)}</dd></div>
                  <div className={cx('flex justify-between font-semibold', pr.expectedProfit < 0 ? 'text-red-600' : 'text-emerald-600')}><dt>Expected profit</dt><dd>{money(pr.expectedProfit)} ({pr.marginPercent}%)</dd></div>
                  <p className="text-xs text-slate-500">Rate: 1 {p.supplier.currency} = {p.exchangeRate} KES. Save to recalculate.</p>
                  {pr.warnings.map((w) => <p key={w} className="text-xs text-amber-600">⚠ {w}</p>)}
                </dl>
              ) : <p className="mt-3 text-sm text-slate-500">No price yet — enter the supplier price and save.</p>}
            </Card>
            <Card title="Supplier (original data)" actions={p.supplier.source === 'aliexpress_api' && <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy === 'sync'} onClick={() => action('sync')}>Synchronize</Button>}>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Source</dt><dd>{p.supplier.source === 'manual' ? 'Manual import' : p.supplier.source === 'local' ? 'Local supplier' : 'AliExpress API'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Product id</dt><dd className="font-mono text-xs">{p.supplierProductId}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Price</dt><dd>{money(p.supplier.price, p.supplier.currency)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Stock</dt><dd>{p.supplier.stock ?? 'not supplied'}</dd></div>
                {p.supplier.storeName && <div className="flex justify-between gap-2"><dt className="text-slate-500">Seller</dt><dd>{p.supplier.storeName}</dd></div>}
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Last checked</dt><dd>{ago(p.lastSyncedAt)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Published</dt><dd>{date(p.lastPublishedAt)}</dd></div>
              </dl>
              <a className="mt-3 inline-flex items-center gap-1 text-sm text-brand-600" href={p.supplier.supplierUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> {p.supplier.source === 'local' ? 'WhatsApp supplier' : 'View supplier product'}</a>
              <p className="mt-2 font-medium text-sm">{p.supplier.title}</p>
            </Card>
            {data!.syncHistory.length > 0 && (
              <Card title="Sync history">
                {data!.syncHistory.map((h, i) => <div key={i} className="border-b border-slate-100 py-1 text-xs last:border-0 dark:border-slate-800"><Badge tone={statusTone(h.result)}>{h.result}</Badge> {ago(h.at)} {h.error || h.changes?.join('. ')}</div>)}
              </Card>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
