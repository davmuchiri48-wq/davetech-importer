import { describe, it, expect, vi } from 'vitest';

// The adapter module imports firebase.ts for nowIso only; stub it so tests need no credentials.
vi.mock('../server/firebase.js', () => ({ nowIso: () => '2026-01-01T00:00:00.000Z', col: {}, db: {} }));
vi.mock('../server/aliexpress/client.js', async () => {
  const actual = await vi.importActual<any>('../server/aliexpress/client.ts').catch(() => ({}));
  return { ...actual, getAccessToken: async () => null, callApi: async () => ({ ok: true, data: {} }) };
});

const { parseProductId, mapProductDetails, aliexpress } = await import('../server/aliexpress/adapter');

describe('AliExpress helpers', () => {
  it('extracts product ids from links', () => {
    expect(parseProductId('https://www.aliexpress.com/item/1005006123456789.html?spm=a2g0o')).toBe('1005006123456789');
    expect(parseProductId('https://vi.aliexpress.com/item/1005006123456789.html')).toBe('1005006123456789');
    expect(parseProductId('https://m.aliexpress.com/x?productId=1005006123456789')).toBe('1005006123456789');
    expect(parseProductId('1005006123456789')).toBe('1005006123456789');
    expect(parseProductId('https://a.aliexpress.com/_mKabc')).toBeNull();
    expect(parseProductId('hello')).toBeNull();
  });

  it('maps a ds.product.get response and keeps unknown stock as null', () => {
    const body = {
      aliexpress_ds_product_get_response: { result: {
        ae_item_base_info_dto: { subject: 'Earbuds', detail: '<p>Good</p>', currency_code: 'USD' },
        ae_multimedia_info_dto: { image_urls: 'https://a/1.jpg;https://a/2.jpg' },
        ae_store_info: { store_name: 'Shop X' },
        ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: [
          { sku_id: '1', offer_sale_price: '9.50', currency_code: 'USD', ae_sku_property_dtos: { ae_sku_property_d_t_o: [{ sku_property_name: 'Color', sku_property_value: 'Black' }] } },
          { sku_id: '2', offer_sale_price: '8.00', currency_code: 'USD', sku_available_stock: 5 },
        ] },
      } },
    };
    const s = mapProductDetails('123', body);
    expect(s.title).toBe('Earbuds');
    expect(s.images).toEqual(['https://a/1.jpg', 'https://a/2.jpg']);
    expect(s.price).toBe(8);
    expect(s.variants[0].attributes).toEqual({ Color: 'Black' });
    expect(s.variants[0].stock).toBeNull();
    expect(s.stock).toBeNull(); // one variant has no stock value → total unknown, not unlimited
    expect(s.shipping).toBeNull();
  });

  it('never pretends to work without authorization', async () => {
    const r = await aliexpress.getProductDetails('store1', '123');
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('not_authorized'); expect((r as any).manualWorkflow).toBeTruthy(); }
  });

  it('automatic supplier ordering is disabled and gives a manual workflow', async () => {
    const r = await aliexpress.createSupplierOrder('store1', {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsupported');
    expect(r.manualWorkflow).toMatch(/AliExpress order number/);
  });
});

describe('request signing', () => {
  it('produces a stable upper-case HMAC-SHA256 over sorted params', async () => {
    vi.doUnmock('../server/aliexpress/client.js');
    const { sign } = await vi.importActual<any>('../server/aliexpress/client.ts');
    const a = sign({ b: '2', a: '1', method: 'x' }, 'secret');
    const b = sign({ method: 'x', a: '1', b: '2' }, 'secret');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9A-F]{64}$/);
    expect(sign({ a: '1' }, 'secret', '/auth/token/create')).not.toBe(sign({ a: '1' }, 'secret'));
  });
});
