import { callApi, getAccessToken, type AeResult, type AeFailure } from './client.js';
import { config } from '../config.js';
import { nowIso } from '../firebase.js';
import type { SupplierSnapshot, Variant } from '../../shared/types.js';

/**
 * AliExpress adapter. Each method maps to one AliExpress Open Platform (Dropshipping) API.
 * If your app has not been granted that API, AliExpress returns a permission error and the
 * method returns { ok:false, reason:'unsupported' } with a manual workflow — we never fake data.
 *
 * API names below are from the AliExpress Dropshipping API group. Check them against the
 * "API permissions" list of YOUR app in the Open Platform console; change them here if
 * AliExpress renames an API.
 */
export const AE_METHODS = {
  searchProducts: 'aliexpress.ds.text.search',
  getProductDetails: 'aliexpress.ds.product.get',
  getShippingOptions: 'aliexpress.ds.freight.query',
  createSupplierOrder: 'aliexpress.ds.order.create',
  getSupplierOrder: 'aliexpress.trade.ds.order.get',
  getTrackingInformation: 'aliexpress.logistics.ds.trackinginfo.query',
} as const;

export const MANUAL_WORKFLOWS = {
  search: 'Search on aliexpress.com, copy the product link, then use Product Importer → "Import from link".',
  details: 'Open the AliExpress listing and copy the title, price, shipping cost and image links into the import form.',
  shipping: 'Open the listing, choose "Ship to Kenya" and copy the shipping cost and method shown by AliExpress.',
  order: 'Open the supplier link from the order, buy the item on AliExpress with the customer\'s delivery details, then paste the AliExpress order number into the order.',
  tracking: 'Copy the tracking number from your AliExpress order page and paste it into the order.',
};

const needToken = async (storeId: string, method: string): Promise<string | AeFailure> => {
  const t = await getAccessToken(storeId);
  return t || { ok: false, reason: 'not_authorized', apiMethod: method, message: 'Connect your AliExpress account in Integrations first (authorization missing or expired).' };
};

const withManual = <T>(r: AeResult<T>, manual: string): AeResult<T> & { manualWorkflow?: string } =>
  r.ok ? r : { ...r, manualWorkflow: manual };

// ------------------------------------------------------------------ helpers

/** Extracts the numeric product id from any normal AliExpress product URL. */
export function parseProductId(input: string): string | null {
  const s = input.trim();
  if (/^\d{8,20}$/.test(s)) return s;
  const m = s.match(/\/item\/(?:[^/]*\/)?(\d{8,20})\.html/i) || s.match(/[?&](?:productId|product_id|itemId)=(\d{8,20})/i)
    || s.match(/\/(\d{8,20})\.html/);
  return m ? m[1] : null;
}

const arr = (v: any): any[] => (Array.isArray(v) ? v : v ? [v] : []);
const num = (v: any): number | null => { const n = Number(v); return v === undefined || v === null || v === '' || Number.isNaN(n) ? null : n; };

/** Maps an aliexpress.ds.product.get response into our SupplierSnapshot. Missing values stay null. */
export function mapProductDetails(productId: string, body: any): SupplierSnapshot {
  const result = body?.aliexpress_ds_product_get_response?.result ?? body?.result ?? body;
  const base = result?.ae_item_base_info_dto || {};
  const media = result?.ae_multimedia_info_dto || {};
  const skus = arr(result?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o);
  const store = result?.ae_store_info || {};

  const variants: Variant[] = skus.map((s: any) => {
    const props = arr(s?.ae_sku_property_dtos?.ae_sku_property_d_t_o);
    const attributes: Record<string, string> = {};
    let image: string | undefined;
    for (const p of props) {
      attributes[p.sku_property_name || 'Option'] = p.property_value_definition_name || p.sku_property_value || '';
      if (p.sku_image) image = p.sku_image;
    }
    return {
      sku: String(s.sku_id ?? s.id ?? ''),
      attributes,
      supplierPrice: num(s.offer_sale_price ?? s.sku_price),
      stock: num(s.sku_available_stock ?? s.ipm_sku_stock),
      image,
    };
  });

  const prices = variants.map((v) => v.supplierPrice).filter((p): p is number => p != null);
  const stocks = variants.map((v) => v.stock).filter((p): p is number => p != null);
  const images = String(media.image_urls || '').split(';').map((x) => x.trim()).filter(Boolean);

  return {
    source: 'aliexpress_api',
    supplierProductId: productId,
    supplierUrl: `https://www.aliexpress.com/item/${productId}.html`,
    title: base.subject || '',
    description: base.detail || base.mobile_detail || '',
    images,
    price: prices.length ? Math.min(...prices) : null,
    shipping: null, // filled by calculateShipping when the freight API is available
    currency: skus[0]?.currency_code || base.currency_code || config.aliexpress.targetCurrency,
    variants,
    stock: stocks.length === variants.length && stocks.length ? stocks.reduce((a, b) => a + b, 0) : null,
    categoryName: base.category_name || (base.category_id ? `AliExpress category ${base.category_id}` : undefined),
    storeName: store.store_name,
    fetchedAt: nowIso(),
  };
}

// ------------------------------------------------------------------ adapter

export interface ShippingOption { code: string; name: string; cost: number | null; currency: string; minDays: number | null; maxDays: number | null; free: boolean; }

export interface SearchQuery { keyword: string; page?: number; pageSize?: number; categoryId?: string; sort?: string; }
export interface SearchItem { productId: string; title: string; image: string; price: number | null; currency: string; url: string; orders?: number | null; }

export const aliexpress = {
  async searchProducts(storeId: string, q: SearchQuery): Promise<AeResult<{ items: SearchItem[]; total: number | null }> & { manualWorkflow?: string }> {
    const method = AE_METHODS.searchProducts;
    const token = await needToken(storeId, method);
    if (typeof token !== 'string') return withManual(token, MANUAL_WORKFLOWS.search);
    const r = await callApi(method, {
      keyWord: q.keyword, local: `${config.aliexpress.targetLanguage.toLowerCase()}_US`, countryCode: config.aliexpress.shipTo,
      currency: config.aliexpress.targetCurrency, pageIndex: q.page || 1, pageSize: q.pageSize || 20,
      categoryId: q.categoryId, sortBy: q.sort,
    }, token);
    if (!r.ok) return withManual(r, MANUAL_WORKFLOWS.search);
    const data = r.data?.aliexpress_ds_text_search_response?.data ?? r.data?.data ?? {};
    const list = arr(data?.products?.selection_search_product ?? data?.products);
    const items: SearchItem[] = list.map((p: any) => ({
      productId: String(p.itemId ?? p.product_id ?? ''),
      title: p.title ?? p.product_title ?? '',
      image: p.itemMainPic ?? p.product_main_image_url ?? '',
      price: num(p.salePrice ?? p.target_sale_price),
      currency: p.salePriceCurrency ?? config.aliexpress.targetCurrency,
      url: p.itemUrl ?? `https://www.aliexpress.com/item/${p.itemId ?? p.product_id}.html`,
      orders: num(p.orders ?? p.lastest_volume),
    })).filter((i) => i.productId);
    return { ok: true, apiMethod: method, data: { items, total: num(data?.totalCount) } };
  },

  async getProductDetails(storeId: string, productId: string): Promise<AeResult<SupplierSnapshot> & { manualWorkflow?: string }> {
    const method = AE_METHODS.getProductDetails;
    const token = await needToken(storeId, method);
    if (typeof token !== 'string') return withManual(token, MANUAL_WORKFLOWS.details);
    const r = await callApi(method, {
      product_id: productId, ship_to_country: config.aliexpress.shipTo,
      target_currency: config.aliexpress.targetCurrency, target_language: config.aliexpress.targetLanguage,
    }, token);
    if (!r.ok) return withManual(r, MANUAL_WORKFLOWS.details);
    const snap = mapProductDetails(productId, r.data);
    if (!snap.title) return { ok: false, reason: 'api_error', apiMethod: method, message: 'AliExpress returned no product for this id (it may be removed or not available to ship to your country).', manualWorkflow: MANUAL_WORKFLOWS.details };
    return { ok: true, apiMethod: method, data: snap };
  },

  async getShippingOptions(storeId: string, productId: string, skuId: string, quantity = 1): Promise<AeResult<ShippingOption[]> & { manualWorkflow?: string }> {
    const method = AE_METHODS.getShippingOptions;
    const token = await needToken(storeId, method);
    if (typeof token !== 'string') return withManual(token, MANUAL_WORKFLOWS.shipping);
    const r = await callApi(method, {
      queryDeliveryReq: { quantity, shipToCountry: config.aliexpress.shipTo, productId, selectedSkuId: skuId, language: 'en_US', currency: config.aliexpress.targetCurrency, locale: 'en_US' },
    }, token);
    if (!r.ok) return withManual(r, MANUAL_WORKFLOWS.shipping);
    const res = r.data?.aliexpress_ds_freight_query_response?.result ?? r.data?.result ?? {};
    const options: ShippingOption[] = arr(res?.delivery_options?.delivery_option_d_t_o ?? res?.delivery_options).map((o: any) => ({
      code: o.code ?? o.service_name ?? '',
      name: o.company ?? o.service_name ?? o.code ?? '',
      cost: num(o.shipping_fee_cent != null ? Number(o.shipping_fee_cent) / 100 : o.shipping_fee ?? o.freight?.cent / 100),
      currency: o.shipping_fee_currency ?? config.aliexpress.targetCurrency,
      minDays: num(o.min_delivery_days), maxDays: num(o.max_delivery_days),
      free: Boolean(o.free_shipping),
    }));
    return { ok: true as const, apiMethod: method, data: options };
  },

  /** Cheapest available shipping option, or a failure. */
  async calculateShipping(storeId: string, productId: string, skuId: string, quantity = 1) {
    const r = await this.getShippingOptions(storeId, productId, skuId, quantity);
    if (!r.ok) return r;
    const priced = r.data.filter((o) => o.cost != null).sort((a, b) => (a.cost! - b.cost!));
    if (!priced.length) return { ok: false as const, reason: 'api_error' as const, message: 'AliExpress returned no shipping option to your country for this item.', manualWorkflow: MANUAL_WORKFLOWS.shipping };
    return { ok: true as const, data: priced[0] };
  },

  async checkAvailability(storeId: string, productId: string) {
    const r = await this.getProductDetails(storeId, productId);
    if (!r.ok) return r;
    const s = r.data;
    // Unknown stock is reported as unknown — never treated as unlimited.
    const available = s.stock == null ? null : s.stock > 0;
    return { ok: true as const, data: { available, stock: s.stock, price: s.price, currency: s.currency, snapshot: s } };
  },

  /**
   * Automatic supplier ordering is deliberately switched off in this release (Phase 6).
   * It returns "unsupported" plus the manual workflow so no money is ever spent by mistake.
   */
  async createSupplierOrder(_storeId: string, _order: unknown): Promise<AeFailure & { manualWorkflow: string }> {
    return { ok: false, reason: 'unsupported', apiMethod: AE_METHODS.createSupplierOrder, message: 'Automatic supplier ordering is not enabled in this version. Place the order manually.', manualWorkflow: MANUAL_WORKFLOWS.order };
  },

  async getSupplierOrder(storeId: string, aeOrderId: string) {
    const method = AE_METHODS.getSupplierOrder;
    const token = await needToken(storeId, method);
    if (typeof token !== 'string') return withManual(token, MANUAL_WORKFLOWS.order);
    const r = await callApi(method, { single_order_query: { order_id: aeOrderId } }, token);
    return withManual(r, MANUAL_WORKFLOWS.order);
  },

  async getTrackingInformation(storeId: string, aeOrderId: string, trackingNo: string, logisticsServiceName: string) {
    const method = AE_METHODS.getTrackingInformation;
    const token = await needToken(storeId, method);
    if (typeof token !== 'string') return withManual(token, MANUAL_WORKFLOWS.tracking);
    const r = await callApi(method, { logistics_no: trackingNo, origin: 'ESCROW', out_ref: aeOrderId, service_name: logisticsServiceName, to_area: config.aliexpress.shipTo }, token);
    return withManual(r, MANUAL_WORKFLOWS.tracking);
  },
};
