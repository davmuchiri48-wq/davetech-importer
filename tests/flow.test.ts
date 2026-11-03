/**
 * End-to-end flow against an in-memory Firestore and a fake shop API:
 * store isolation, manual import, duplicate detection, pricing, publish rules, locked prices, sync.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db, reset } from './fakeFirestore';

process.env.ENCRYPTION_KEY = 'test-encryption-key-that-is-long-enough-123';

vi.mock('../server/firebase.js', async () => {
  const f = await import('./fakeFirestore');
  const names = ['users', 'invites', 'stores', 'secrets', 'suppliers', 'products', 'categories', 'customers', 'orders', 'supplierOrders', 'payments', 'transactions', 'pricingRules', 'automationRules', 'importJobs', 'syncJobs', 'trackingEvents', 'notifications', 'auditLogs'];
  return { db: f.db, auth: {}, nowIso: () => new Date().toISOString(), col: Object.fromEntries(names.map((n) => [n, () => f.db.collection(n)])) };
});

// Fake shop: records what the importer sends
const shopCalls: any[] = [];
vi.mock('../server/shop/client.js', () => ({
  shop: {
    ensureCategory: async (_s: string, name: string) => { shopCalls.push(['cat', name]); return { id: 7, name }; },
    upsertProduct: async (s: string, ext: string, p: any) => { shopCalls.push(['put', s, ext, p]); return { id: 99, created: true }; },
    removeProduct: async (s: string, ext: string) => { shopCalls.push(['del', s, ext]); return { result: 'hidden' }; },
  },
}));

let supplierResponse: any = null;
vi.mock('../server/aliexpress/adapter.js', () => ({
  aliexpress: { getProductDetails: async () => supplierResponse, calculateShipping: async () => ({ ok: false }) },
}));

const products = await import('../server/services/products');
const { syncStore } = await import('../server/services/jobs');
const { encrypt, decrypt } = await import('../server/crypto');

const snap = (id = '1005006123456789', o: any = {}) => ({
  source: 'manual' as const, supplierProductId: id, supplierUrl: `https://www.aliexpress.com/item/${id}.html`, title: 'Wireless Earbuds',
  description: 'Nice', images: ['https://img/1.jpg', 'https://img/2.jpg'], price: 10, shipping: 3, currency: 'USD', variants: [], stock: null, fetchedAt: '', ...o,
});

beforeEach(async () => {
  reset(); shopCalls.length = 0;
  for (const s of ['storeA', 'storeB']) await db.collection('stores').doc(s).set({ name: s, settings: { exchange: { provider: 'manual', manualRates: { USD: 130 } } } });
  await db.collection('pricingRules').doc('storeA').set({ global: { markupType: 'percent', markupValue: 50, additionalCosts: 100, minProfit: 0, minSellingPrice: 0, rounding: 'none' }, categories: {} });
});

describe('import → price → publish', () => {
  it('creates a priced draft from a manual import', async () => {
    const p = await products.createProductFromSnapshot('storeA', snap());
    expect(p.status).toBe('draft');
    expect(p.availability).toBe('unknown'); // stock not supplied ≠ unlimited
    expect(p.pricing!.landedCost).toBe(1790);   // (10+3)*130 + 100
    expect(p.pricing!.sellingPrice).toBe(2685); // +50%
  });

  it('blocks duplicate imports per store, but allows the same item in another store', async () => {
    await products.createProductFromSnapshot('storeA', snap());
    await expect(products.createProductFromSnapshot('storeA', snap())).rejects.toMatchObject({ status: 409, code: 'duplicate' });
    await expect(products.createProductFromSnapshot('storeB', snap())).resolves.toBeTruthy();
  });

  it('keeps stores isolated', async () => {
    const p = await products.createProductFromSnapshot('storeA', snap());
    await expect(products.getProduct('storeB', p.id)).rejects.toMatchObject({ status: 404 });
    await expect(products.publishProduct('storeB', p.id)).rejects.toMatchObject({ status: 404 });
  });

  it('publishes with whole-shilling price and supplier costs to the shop', async () => {
    const p = await products.createProductFromSnapshot('storeA', snap());
    await products.publishProduct('storeA', p.id);
    const put = shopCalls.find((c) => c[0] === 'put');
    expect(put[1]).toBe('storeA');
    expect(put[3]).toMatchObject({ price: 2685, supplier_cost: 1400, supplier_shipping: 390, dropship: true, image: 'https://img/1.jpg' });
    expect((await products.getProduct('storeA', p.id)).status).toBe('published');
  });

  it('refuses to publish without shipping, when unavailable, or at a loss', async () => {
    const a = await products.createProductFromSnapshot('storeA', snap('111111111', { shipping: null }));
    await expect(products.publishProduct('storeA', a.id)).rejects.toMatchObject({ code: 'no_shipping' });
    const b = await products.createProductFromSnapshot('storeA', snap('222222222', { stock: 0 }));
    await expect(products.publishProduct('storeA', b.id)).rejects.toMatchObject({ code: 'unavailable' });
    const c = await products.createProductFromSnapshot('storeA', snap('333333333'), { manualPrice: 500, priceLocked: true });
    await expect(products.publishProduct('storeA', c.id)).rejects.toMatchObject({ code: 'loss' });
    await expect(products.publishProduct('storeA', c.id, { allowLoss: true })).resolves.toBeTruthy();
  });

  it('protects a locked price: staff cannot unlock, sync does not change it', async () => {
    const p = await products.createProductFromSnapshot('storeA', snap(), { manualPrice: 3000, priceLocked: true });
    await expect(products.updateProduct('storeA', p.id, { priceLocked: false } as any)).rejects.toMatchObject({ status: 403 });
    const after = await products.applySupplierUpdate('storeA', p.id, { ...snap(), source: 'aliexpress_api', price: 20 } as any, { priceChangeThresholdPercent: 5, onUnavailable: 'unpublish', autoRecalculate: true });
    expect(after.changes[0]).toMatch(/\+100%/);
    expect((await products.getProduct('storeA', p.id)).pricing!.sellingPrice).toBe(3000);
  });

  it('sync unpublishes items that go out of stock and alerts', async () => {
    const p = await products.createProductFromSnapshot('storeA', snap('444444444', { source: 'aliexpress_api', stock: 5 }));
    await products.publishProduct('storeA', p.id);
    supplierResponse = { ok: true, data: { ...snap('444444444'), source: 'aliexpress_api', stock: 0 } };
    const r = await syncStore('storeA');
    expect(r.unavailable).toBe(1);
    expect(shopCalls.some((c) => c[0] === 'del' && c[2] === p.id)).toBe(true);
    const after = await products.getProduct('storeA', p.id);
    expect(after.availability).toBe('unavailable');
    expect(after.status).toBe('unpublished');
    const notes = (await db.collection('notifications').where('storeId', '==', 'storeA').get()).docs;
    expect(notes.length).toBe(1);
  });

  it('sync failure is recorded, not hidden', async () => {
    await products.createProductFromSnapshot('storeA', snap('555555555', { source: 'aliexpress_api', stock: 5 }));
    supplierResponse = { ok: false, reason: 'not_authorized', message: 'Connect your AliExpress account' };
    const r = await syncStore('storeA');
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toMatch(/Connect/);
  });

  it('converts AliExpress HTML descriptions to text', () => {
    expect(products.htmlToText('<p>Hello&nbsp;<b>world</b></p><ul><li>One</li><li>Two</li></ul><script>x()</script>')).toBe('Hello world\n• One\n• Two');
  });

  it('encrypts secrets at rest', () => {
    const t = encrypt('my-shop-key');
    expect(t).not.toContain('my-shop-key');
    expect(decrypt(t)).toBe('my-shop-key');
  });
});
