import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { col, db, nowIso, newest } from '../firebase.js';
import { h, HttpError, requireAuth, requireRole, requireStore, type AuthedRequest } from '../http.js';
import { encrypt } from '../crypto.js';
import { config } from '../config.js';
import { audit } from '../audit.js';
import { shop } from '../shop/client.js';
import { aliexpress, parseProductId, AE_METHODS, MANUAL_WORKFLOWS } from '../aliexpress/adapter.js';
import { authorizeUrl, exchangeCode, connectionInfo, disconnect, callApi, getAccessToken } from '../aliexpress/client.js';
import { getSettings, getPricingRules, DEFAULT_SETTINGS } from '../services/settings.js';
import { getRate, refreshRates } from '../services/exchange.js';
import { calculatePrice, resolveRule } from '../../shared/pricing.js';
import * as products from '../services/products.js';
import { enqueueImport, syncStore } from '../services/jobs.js';
import type { SupplierSnapshot, ShopOrder } from '../../shared/types.js';

export const api = Router();
const admin = requireRole('admin');

// ------------------------------------------------------------ public: AliExpress OAuth callback
function signState(storeId: string, uid: string) {
  const payload = `${storeId}.${uid}.${Date.now()}`;
  const mac = crypto.createHmac('sha256', config.encryptionKey).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(`${payload}.${mac}`).toString('base64url');
}
function readState(state: string) {
  const [storeId, uid, ts, mac] = Buffer.from(state, 'base64url').toString().split('.');
  const expect = crypto.createHmac('sha256', config.encryptionKey).update(`${storeId}.${uid}.${ts}`).digest('hex').slice(0, 32);
  if (!mac || mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) throw new HttpError(400, 'Invalid state');
  if (Date.now() - Number(ts) > 15 * 60e3) throw new HttpError(400, 'Authorization link expired, start again');
  return { storeId, uid };
}

api.get('/integrations/aliexpress/callback', async (req, res) => {
  try {
    const { storeId, uid } = readState(String(req.query.state || ''));
    const r = await exchangeCode(storeId, String(req.query.code || ''));
    await audit(uid, storeId, r.ok ? 'aliexpress.connected' : 'aliexpress.connect_failed', storeId, r.ok ? {} : { message: r.message });
    res.redirect(`/integrations?aliexpress=${r.ok ? 'connected' : encodeURIComponent(r.message)}`);
  } catch (e) {
    res.redirect(`/integrations?aliexpress=${encodeURIComponent((e as Error).message)}`);
  }
});

// ------------------------------------------------------------ everything below needs sign-in
api.use(requireAuth);

api.get('/me', h(async (req, res) => {
  const all = await col.stores().get();
  const stores = all.docs.filter((d) => req.user.storeIds.includes(d.id)).map((d) => ({ id: d.id, name: d.data().name, baseUrl: d.data().baseUrl, currency: d.data().currency || 'KES' }));
  res.json({ user: req.user, stores });
}));

// ------------------------------------------------------------ stores (admin)
const storeBody = z.object({ name: z.string().min(2).max(80), baseUrl: z.string().url(), apiKey: z.string().min(16).max(200) });

api.post('/stores', admin, h(async (req, res) => {
  const b = storeBody.parse(req.body);
  const baseUrl = b.baseUrl.replace(/\/$/, '');
  const health = await shop.health('', { baseUrl, apiKey: b.apiKey });
  const ref = col.stores().doc();
  await ref.set({ name: b.name, type: 'flask_shop', baseUrl, currency: health.currency === 'KSh' ? 'KES' : (health.currency || 'KES'), createdAt: nowIso(), settings: DEFAULT_SETTINGS });
  await col.secrets().doc(`${ref.id}_shop`).set({ storeId: ref.id, enc: encrypt(b.apiKey), updatedAt: nowIso() });
  // all admins get access to new stores
  const admins = await col.users().where('role', '==', 'admin').get();
  await Promise.all(admins.docs.map((d) => d.ref.update({ storeIds: [...new Set([...(d.data().storeIds || []), ref.id])] })));
  await audit(req.user.uid, ref.id, 'store.created', ref.id, { name: b.name, baseUrl });
  res.json({ id: ref.id, shop: health });
}));

api.put('/stores/:id/connection', admin, h(async (req, res) => {
  const b = storeBody.partial({ name: true, apiKey: true }).parse(req.body);
  const id = req.params.id;
  if (!req.user.storeIds.includes(id)) throw new HttpError(403, 'No access to this store');
  const baseUrl = b.baseUrl.replace(/\/$/, '');
  if (b.apiKey) {
    await shop.health('', { baseUrl, apiKey: b.apiKey });
    await col.secrets().doc(`${id}_shop`).set({ storeId: id, enc: encrypt(b.apiKey), updatedAt: nowIso() });
  }
  await col.stores().doc(id).update({ baseUrl, ...(b.name ? { name: b.name } : {}) });
  await audit(req.user.uid, id, 'store.connection_updated', id, { baseUrl, keyChanged: Boolean(b.apiKey) });
  res.json({ ok: true });
}));

// ------------------------------------------------------------ store-scoped routes
api.use(requireStore);

api.post('/store/test', h(async (req, res) => { res.json(await shop.health(req.storeId)); }));

// ---------------- overview
api.get('/overview', h(async (req, res) => {
  const s = req.storeId;
  const [prods, allJobs, notes] = await Promise.all([
    col.products().where('storeId', '==', s).get(),
    newest(col.importJobs().where('storeId', '==', s), 'createdAt', 1000),
    newest(col.notifications().where('storeId', '==', s), 'at', 8),
  ]);
  const jobs = { docs: allJobs.slice(0, 8) };
  const p = prods.docs.map((d) => d.data());
  let orders: ShopOrder[] = []; let shopError: string | null = null;
  try { orders = (await shop.orders(s, { limit: 500 })).orders; } catch (e) { shopError = (e as Error).message; }
  const paid = orders.filter((o) => o.payment_status === 'paid' && o.status !== 'cancelled');
  const sales = paid.reduce((a, o) => a + o.total, 0);
  const cost = paid.reduce((a, o) => a + o.items.reduce((b, i) => b + (i.supplier_cost || 0) * i.qty, 0), 0);
  res.json({
    cards: {
      totalProducts: p.length,
      publishedProducts: p.filter((x) => x.status === 'published').length,
      pendingImports: allJobs.filter((d) => ['queued', 'running'].includes(d.get('status'))).length,
      totalOrders: orders.length,
      pendingSupplierOrders: paid.filter((o) => o.items.some((i) => i.dropship) && !o.supplier_order_no).length,
      totalSales: sales,
      estimatedProfit: sales - cost, // estimate: excludes payment charges and local delivery costs
      syncErrors: p.filter((x) => x.syncError).length,
    },
    salesByDay: groupByDay(paid),
    recentImports: jobs.docs.map((d) => ({ id: d.id, ...d.data() })),
    recentOrders: orders.slice(0, 8),
    alerts: notes.map((d) => ({ id: d.id, ...d.data() })),
    shopError,
  });
}));

function groupByDay(orders: ShopOrder[]) {
  const days: Record<string, { day: string; sales: number; orders: number }> = {};
  for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days[d] = { day: d, sales: 0, orders: 0 }; }
  for (const o of orders) { const d = o.created.slice(0, 10); if (days[d]) { days[d].sales += o.total; days[d].orders++; } }
  return Object.values(days);
}

// ---------------- settings
const settingsBody = z.object({
  exchange: z.object({ provider: z.enum(['manual', 'open_er_api']), manualRates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive()) }).partial().optional(),
  sync: z.object({ enabled: z.boolean(), everyHours: z.number().int().min(1).max(168), priceChangeThresholdPercent: z.number().min(0).max(100), onUnavailable: z.enum(['unpublish', 'mark_only']), autoRecalculate: z.boolean() }).partial().optional(),
  dropshipMode: z.enum(['manual']).optional(), // other modes arrive with Phase 6
  automatedPurchasingEnabled: z.literal(false).optional(),
  maxAutoOrderValue: z.number().min(0).optional(),
});

api.get('/settings', h(async (req, res) => { res.json(await getSettings(req.storeId)); }));
api.put('/settings', admin, h(async (req, res) => {
  const b = settingsBody.parse(req.body);
  const cur = await getSettings(req.storeId);
  const next = { ...cur, ...b, exchange: { ...cur.exchange, ...(b.exchange || {}) }, sync: { ...cur.sync, ...(b.sync || {}) } };
  await col.stores().doc(req.storeId).update({ settings: next });
  await audit(req.user.uid, req.storeId, 'settings.updated', req.storeId, b as any);
  res.json(next);
}));
api.post('/settings/rates/refresh', admin, h(async (req, res) => { res.json({ rates: await refreshRates(req.storeId) }); }));

// ---------------- pricing
const ruleBody = z.object({
  markupType: z.enum(['percent', 'fixed']), markupValue: z.number().min(0), additionalCosts: z.number().min(0),
  minProfit: z.number().min(0), minSellingPrice: z.number().min(0),
  rounding: z.enum(['none', 'nearest_1', 'nearest_10', 'nearest_50', 'nearest_100', 'end_99']),
});
api.get('/pricing-rules', h(async (req, res) => { res.json(await getPricingRules(req.storeId)); }));
api.put('/pricing-rules', admin, h(async (req, res) => {
  const b = z.object({ global: ruleBody, categories: z.record(z.string(), ruleBody.partial()) }).parse(req.body);
  await col.pricingRules().doc(req.storeId).set({ storeId: req.storeId, ...b, updatedAt: nowIso() });
  await audit(req.user.uid, req.storeId, 'pricing.updated', req.storeId, b as any);
  res.json(b);
}));
api.post('/pricing/preview', h(async (req, res) => {
  const b = z.object({ supplierPrice: z.number().min(0), supplierShipping: z.number().min(0), currency: z.string().length(3), categoryId: z.string().nullable().optional(), override: ruleBody.partial().optional() }).parse(req.body);
  const [rules, rate] = await Promise.all([getPricingRules(req.storeId), getRate(req.storeId, b.currency)]);
  res.json({ exchangeRate: rate, ...calculatePrice({ supplierPrice: b.supplierPrice, supplierShipping: b.supplierShipping, supplierCurrency: b.currency, exchangeRate: rate, rule: resolveRule(rules, b.categoryId, b.override) }) });
}));
api.post('/pricing/recalculate', admin, h(async (req, res) => {
  const docs = (await col.products().where('storeId', '==', req.storeId).get()).docs;
  let updated = 0; const errors: string[] = [];
  for (const d of docs) {
    try { await products.updateProduct(req.storeId, d.id, {}); updated++; } catch (e) { errors.push(`${d.data().name}: ${(e as Error).message}`); }
  }
  res.json({ updated, errors });
}));

// ---------------- AliExpress
api.get('/aliexpress/status', h(async (req, res) => {
  res.json({ ...(await connectionInfo(req.storeId)), methods: AE_METHODS, manualWorkflows: MANUAL_WORKFLOWS });
}));
api.post('/aliexpress/connect', admin, h(async (req, res) => {
  if (!config.aliexpress.appKey) throw new HttpError(400, 'Set ALIEXPRESS_APP_KEY and ALIEXPRESS_APP_SECRET on the server first');
  if (!config.publicUrl) throw new HttpError(400, 'Set PUBLIC_URL on the server first (your importer address)');
  res.json({ url: authorizeUrl(signState(req.storeId, req.user.uid)) });
}));
api.post('/aliexpress/disconnect', admin, h(async (req, res) => {
  await disconnect(req.storeId); await audit(req.user.uid, req.storeId, 'aliexpress.disconnected', req.storeId); res.json({ ok: true });
}));
api.post('/aliexpress/test', h(async (req, res) => {
  // Tests each mapped API with a harmless read call and reports which are permitted for this app.
  const token = await getAccessToken(req.storeId);
  const results: Record<string, { ok: boolean; reason?: string; message?: string }> = {};
  const probe = String(req.body?.productId || '');
  const calls: [string, () => Promise<any>][] = [
    ['searchProducts', () => aliexpress.searchProducts(req.storeId, { keyword: 'phone case', pageSize: 1 })],
    ...(probe ? [['getProductDetails', () => aliexpress.getProductDetails(req.storeId, probe)] as [string, () => Promise<any>]] : []),
  ];
  if (!token) { res.json({ authorized: false, results: {}, message: 'Connect your AliExpress account first.' }); return; }
  for (const [name, fn] of calls) {
    const r = await fn();
    results[name] = r.ok ? { ok: true } : { ok: false, reason: r.reason, message: r.message };
  }
  res.json({ authorized: true, results });
}));
api.get('/aliexpress/search', h(async (req, res) => {
  const q = z.object({ keyword: z.string().min(2).max(100), page: z.coerce.number().int().min(1).default(1), sort: z.string().optional(), categoryId: z.string().optional() }).parse(req.query);
  res.json(await aliexpress.searchProducts(req.storeId, { ...q, pageSize: 20 }));
}));
api.get('/aliexpress/products/:pid', h(async (req, res) => {
  const pid = parseProductId(req.params.pid);
  if (!pid) throw new HttpError(400, 'Not a valid AliExpress product id');
  const r = await aliexpress.getProductDetails(req.storeId, pid);
  res.json({ ...r, duplicateOf: await products.findDuplicate(req.storeId, pid) });
}));
api.post('/aliexpress/raw', admin, h(async (req, res) => {
  // Developer tool: call any API your app is approved for (read-only use). Purchases are blocked.
  const b = z.object({ method: z.string().regex(/^aliexpress\.[a-z0-9.]+$/), params: z.record(z.string(), z.unknown()).default({}) }).parse(req.body);
  if (/placeorder|order\.create|pay/i.test(b.method)) throw new HttpError(403, 'Ordering/payment APIs cannot be called from the console');
  res.json(await callApi(b.method, b.params, (await getAccessToken(req.storeId)) || undefined));
}));

// ---------------- imports
api.post('/imports', h(async (req, res) => {
  const b = z.object({ productIds: z.array(z.string()).min(1).max(50) }).parse(req.body);
  const jobs = [];
  for (const raw of b.productIds) {
    const pid = parseProductId(raw);
    if (!pid) { jobs.push({ input: raw, status: 'failed', error: 'Not a valid AliExpress link or id' }); continue; }
    jobs.push(await enqueueImport(req.storeId, req.user.uid, 'aliexpress_api', pid, {}));
  }
  await audit(req.user.uid, req.storeId, 'import.queued', 'aliexpress_api', { count: jobs.length });
  res.json({ jobs });
}));

const manualBody = z.object({
  url: z.string().min(5),
  title: z.string().min(3).max(300),
  description: z.string().max(50_000).default(''),
  images: z.array(z.string().url()).min(1).max(20),
  price: z.number().positive(),
  shipping: z.number().min(0).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  categoryName: z.string().max(120).optional(),
  storeName: z.string().max(120).optional(),
  variants: z.array(z.object({ sku: z.string().default(''), attributes: z.record(z.string(), z.string()), supplierPrice: z.number().nullable(), stock: z.number().int().nullable() })).default([]),
  stock: z.number().int().min(0).nullable().default(null),
  edits: z.object({ name: z.string().optional(), categoryId: z.string().nullable().optional(), manualPrice: z.number().positive().nullable().optional(), priceLocked: z.boolean().optional() }).optional(),
});
api.post('/imports/manual', h(async (req, res) => {
  const b = manualBody.parse(req.body);
  const pid = parseProductId(b.url);
  if (!pid) throw new HttpError(400, 'Paste the full AliExpress product link (it contains /item/<number>.html). Short a.aliexpress.com links: open them in your browser first and copy the full address.');
  const snapshot: SupplierSnapshot = {
    source: 'manual', supplierProductId: pid, supplierUrl: `https://www.aliexpress.com/item/${pid}.html`,
    title: b.title, description: b.description, images: b.images, price: b.price, shipping: b.shipping, currency: b.currency,
    variants: b.variants, stock: b.stock, categoryName: b.categoryName, storeName: b.storeName, fetchedAt: nowIso(),
  };
  const job = await enqueueImport(req.storeId, req.user.uid, 'manual', pid, { snapshot, edits: b.edits || {} });
  await audit(req.user.uid, req.storeId, 'import.manual', pid, {});
  res.json({ job });
}));
api.get('/imports', h(async (req, res) => {
  const q = await newest(col.importJobs().where('storeId', '==', req.storeId), 'createdAt', 100);
  res.json({ jobs: q.map((d) => ({ id: d.id, ...d.data(), input: undefined })) });
}));

// ---------------- products
api.get('/products', h(async (req, res) => {
  const q = await col.products().where('storeId', '==', req.storeId).get();
  const list = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  res.json({ products: list });
}));
api.get('/products/:id', h(async (req, res) => {
  const p = await products.getProduct(req.storeId, req.params.id);
  const history = await newest(col.syncJobs().where('storeId', '==', req.storeId).where('productId', '==', p.id), 'at', 20);
  res.json({ product: p, syncHistory: history.map((d) => d.data()) });
}));
const productPatch = z.object({
  name: z.string().min(2).max(200), description: z.string().max(50_000), images: z.array(z.string().url()).max(20), mainImage: z.string(),
  categoryId: z.string().nullable(), sku: z.string().max(80), seoTitle: z.string().max(120), seoDescription: z.string().max(320),
  pricingOverride: ruleBody.partial().nullable(), manualPrice: z.number().positive().nullable(), priceLocked: z.boolean(),
  supplierShipping: z.number().min(0).nullable(), supplierPrice: z.number().positive(),
}).partial();
api.put('/products/:id', h(async (req, res) => {
  const b = productPatch.parse(req.body);
  const p = await products.updateProduct(req.storeId, req.params.id, b as any, { allowUnlock: req.user.role === 'admin' });
  await audit(req.user.uid, req.storeId, 'product.updated', p.id, { fields: Object.keys(b) });
  res.json({ product: p });
}));
api.delete('/products/:id', admin, h(async (req, res) => {
  await products.deleteProduct(req.storeId, req.params.id);
  await audit(req.user.uid, req.storeId, 'product.deleted', req.params.id);
  res.json({ ok: true });
}));

async function productAction(storeId: string, id: string, action: string, body: any) {
  switch (action) {
    case 'publish': return products.publishProduct(storeId, id, { allowLoss: Boolean(body?.allowLoss) });
    case 'unpublish': return products.unpublishProduct(storeId, id, 'unpublished');
    case 'archive': return products.unpublishProduct(storeId, id, 'archived');
    case 'duplicate': return products.duplicateProduct(storeId, id);
    case 'sync': return syncStore(storeId, [id]);
    default: throw new HttpError(400, 'Unknown action');
  }
}
for (const action of ['publish', 'unpublish', 'archive', 'duplicate', 'sync']) {
  api.post(`/products/:id/${action}`, h(async (req, res) => {
    const r = await productAction(req.storeId, String(req.params.id), action, req.body);
    await audit(req.user.uid, req.storeId, `product.${action}`, String(req.params.id));
    res.json({ ok: true, result: r });
  }));
}
api.post('/products-bulk', h(async (req, res) => {
  const b = z.object({ ids: z.array(z.string()).min(1).max(200), action: z.enum(['publish', 'unpublish', 'archive', 'category']), categoryId: z.string().nullable().optional() }).parse(req.body);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of b.ids) {
    try {
      if (b.action === 'category') await products.updateProduct(req.storeId, id, { categoryId: b.categoryId ?? null });
      else await productAction(req.storeId, id, b.action, {});
      results.push({ id, ok: true });
    } catch (e) { results.push({ id, ok: false, error: (e as Error).message }); }
  }
  await audit(req.user.uid, req.storeId, `product.bulk_${b.action}`, b.ids.join(','), {});
  res.json({ results });
}));

// ---------------- categories
const catBody = z.object({ name: z.string().min(2).max(80), supplierCategoryNames: z.array(z.string().max(120)).default([]) });
api.get('/categories', h(async (req, res) => {
  const q = await col.categories().where('storeId', '==', req.storeId).get();
  res.json({ categories: q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => a.name.localeCompare(b.name)) });
}));
api.post('/categories', admin, h(async (req, res) => {
  const b = catBody.parse(req.body);
  const ref = await col.categories().add({ storeId: req.storeId, ...b, shopCategoryId: null, createdAt: nowIso() });
  res.json({ id: ref.id });
}));
api.put('/categories/:id', admin, h(async (req, res) => {
  const ref = col.categories().doc(req.params.id); const s = await ref.get();
  if (!s.exists || s.data()!.storeId !== req.storeId) throw new HttpError(404, 'Category not found');
  await ref.update(catBody.partial().parse(req.body)); res.json({ ok: true });
}));
api.delete('/categories/:id', admin, h(async (req, res) => {
  const ref = col.categories().doc(req.params.id); const s = await ref.get();
  if (!s.exists || s.data()!.storeId !== req.storeId) throw new HttpError(404, 'Category not found');
  const used = await col.products().where('storeId', '==', req.storeId).where('categoryId', '==', ref.id).limit(1).get();
  if (!used.empty) throw new HttpError(400, 'Move the products in this category first');
  await ref.delete(); res.json({ ok: true });
}));
api.post('/categories/import-from-shop', admin, h(async (req, res) => {
  const { categories } = await shop.categories(req.storeId);
  const existing = (await col.categories().where('storeId', '==', req.storeId).get()).docs.map((d) => d.data());
  let added = 0;
  for (const c of categories) {
    if (existing.some((e) => e.shopCategoryId === c.id || e.name.toLowerCase() === c.name.toLowerCase())) continue;
    await col.categories().add({ storeId: req.storeId, name: c.name, supplierCategoryNames: [], shopCategoryId: c.id, createdAt: nowIso() }); added++;
  }
  res.json({ added });
}));

// ---------------- synchronization
api.post('/sync/run', h(async (req, res) => {
  const summary = await syncStore(req.storeId);
  await audit(req.user.uid, req.storeId, 'sync.manual', req.storeId, summary as any);
  res.json(summary);
}));
api.get('/sync/history', h(async (req, res) => {
  const q = await newest(col.syncJobs().where('storeId', '==', req.storeId), 'at', 100);
  res.json({ history: q.map((d) => ({ id: d.id, ...d.data() })) });
}));

// ---------------- orders (live from the shop; snapshotted to Firestore for history)
api.get('/orders', h(async (req, res) => {
  const { orders } = await shop.orders(req.storeId, { limit: 500 });
  // Immutable financial snapshot: the first time we see an order we store its prices; later visits never change them.
  const batch = db.batch(); let writes = 0;
  const existing = new Set((await col.orders().where('storeId', '==', req.storeId).select().get()).docs.map((d) => d.id));
  for (const o of orders) {
    const id = `${req.storeId}_${o.code}`;
    if (!existing.has(id)) {
      batch.set(col.orders().doc(id), { storeId: req.storeId, code: o.code, snapshot: { subtotal: o.subtotal, delivery: o.delivery, total: o.total, items: o.items }, firstSeenAt: nowIso() });
      if (++writes >= 450) break;
    }
  }
  if (writes) await batch.commit();
  res.json({ orders });
}));
const orderPatch = z.object({
  supplier_order_no: z.string().max(60).optional(),
  tracking_no: z.string().max(60).optional(),
  status: z.enum(['new', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
});
api.patch('/orders/:code', h(async (req, res) => {
  const b = orderPatch.parse(req.body);
  if (b.supplier_order_no) {
    // Never record a supplier order for an unpaid customer order.
    const { orders } = await shop.orders(req.storeId, { limit: 500 });
    const o = orders.find((x) => x.code === req.params.code);
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.payment_status !== 'paid' && o.payment_method !== 'cod') throw new HttpError(400, 'Customer payment is not verified yet — do not order from the supplier');
  }
  const r = await shop.updateOrder(req.storeId, req.params.code, b);
  if (b.tracking_no) await col.trackingEvents().add({ storeId: req.storeId, orderCode: req.params.code, trackingNo: b.tracking_no, source: 'manual', at: nowIso(), by: req.user.uid });
  if (b.supplier_order_no) await col.supplierOrders().doc(`${req.storeId}_${req.params.code}`).set({ storeId: req.storeId, orderCode: req.params.code, aliexpressOrderNo: b.supplier_order_no, placedBy: 'manual', confirmedBySupplier: false, at: nowIso(), by: req.user.uid }, { merge: true });
  await audit(req.user.uid, req.storeId, 'order.updated', req.params.code, b);
  res.json(r);
}));

// ---------------- notifications
api.get('/notifications', h(async (req, res) => {
  const q = await newest(col.notifications().where('storeId', '==', req.storeId), 'at', 50);
  res.json({ notifications: q.map((d) => ({ id: d.id, ...d.data() })) });
}));
api.post('/notifications/read-all', h(async (req, res) => {
  const q = await newest(col.notifications().where('storeId', '==', req.storeId), 'at', 400, (d) => d.read === false);
  const b = db.batch(); q.forEach((d) => b.update(d.ref, { read: true })); await b.commit();
  res.json({ ok: true });
}));

// ---------------- team (admin)
api.get('/team', admin, h(async (req, res) => {
  const [u, inv] = await Promise.all([col.users().get(), col.invites().get()]);
  res.json({
    users: u.docs.map((d) => d.data()).filter((x) => x.storeIds?.includes(req.storeId)),
    invites: inv.docs.map((d) => ({ email: d.id, ...d.data() })).filter((x: any) => x.storeIds?.includes(req.storeId)),
  });
}));
api.post('/team/invite', admin, h(async (req, res) => {
  const b = z.object({ email: z.string().email(), role: z.enum(['admin', 'staff']) }).parse(req.body);
  await col.invites().doc(b.email.toLowerCase()).set({ role: b.role, storeIds: [req.storeId], invitedBy: req.user.uid, at: nowIso() });
  await audit(req.user.uid, req.storeId, 'team.invited', b.email, { role: b.role });
  res.json({ ok: true });
}));
api.put('/team/:uid', admin, h(async (req, res) => {
  const b = z.object({ role: z.enum(['admin', 'staff']).optional(), disabled: z.boolean().optional() }).parse(req.body);
  if (req.params.uid === req.user.uid) throw new HttpError(400, 'You cannot change your own role');
  await col.users().doc(req.params.uid).update(b);
  await audit(req.user.uid, req.storeId, 'team.updated', req.params.uid, b);
  res.json({ ok: true });
}));
api.get('/audit', admin, h(async (req, res) => {
  const q = await newest(col.auditLogs().where('storeId', '==', req.storeId), 'at', 200);
  res.json({ logs: q.map((d) => ({ id: d.id, ...d.data() })) });
}));
