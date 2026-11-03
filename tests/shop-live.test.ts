/** Runs only when SHOP_URL and SHOP_KEY are set: talks to a real DaveTech Shop over HTTP. */
import { describe, it, expect, vi } from 'vitest';
const URL_ = process.env.SHOP_URL, KEY = process.env.SHOP_KEY;
process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-long-enough-123';
vi.mock('../server/firebase.js', async () => {
  const f = await import('./fakeFirestore');
  return { db: f.db, nowIso: () => new Date().toISOString(), col: { stores: () => f.db.collection('stores'), secrets: () => f.db.collection('secrets') } };
});
describe.skipIf(!URL_)('live shop API', () => {
  it('health, categories, upsert, orders, delete', async () => {
    const { db } = await import('./fakeFirestore');
    const { encrypt } = await import('../server/crypto');
    const { shop } = await import('../server/shop/client');
    await db.collection('stores').doc('s1').set({ baseUrl: URL_ });
    await db.collection('secrets').doc('s1_shop').set({ enc: encrypt(KEY!) });
    expect((await shop.health('s1')).ok).toBe(true);
    const cat = await shop.ensureCategory('s1', 'Importer Test');
    const p = await shop.upsertProduct('s1', 'live-test-1', { name: 'Live Test', description: 'x', price: 1234, image: 'https://img/a.jpg', images: ['https://img/a.jpg'], category_id: cat.id, active: true, dropship: true, supplier_url: 'https://www.aliexpress.com/item/1.html', supplier_cost: 500, supplier_shipping: 100 });
    expect(p.id).toBeGreaterThan(0);
    expect(Array.isArray((await shop.orders('s1')).orders)).toBe(true);
    expect((await shop.removeProduct('s1', 'live-test-1')).result).toBe('deleted');
    await db.collection('secrets').doc('s1_shop').set({ enc: encrypt('wrong-key-wrong-key-wrong') });
    await expect(shop.health('s1')).rejects.toMatchObject({ code: 'shop_auth' });
  });
});
