import { col } from '../firebase.js';
import { decrypt } from '../crypto.js';
import { HttpError } from '../http.js';
import type { ShopOrder } from '../../shared/types.js';

/**
 * Client for the DaveTech Shop (Flask) integration API: /api/integration/v1/*
 * Authenticated with a per-store API key that lives encrypted in Firestore `secrets/`.
 * The full API is documented in docs/INTEGRATION_API.md.
 */
export interface ShopProductPayload {
  name: string;
  description: string;
  price: number;
  old_price?: number | null;
  image: string;
  images: string[];
  category_id: number | null;
  active: boolean;
  dropship: boolean;
  supplier_url: string;
  supplier_cost: number;
  supplier_shipping: number;
  delivery_days?: string;
  sku?: string;
  seo_title?: string;
  seo_description?: string;
}

async function storeConn(storeId: string) {
  const [store, secret] = await Promise.all([col.stores().doc(storeId).get(), col.secrets().doc(`${storeId}_shop`).get()]);
  if (!store.exists) throw new HttpError(404, 'Store not found');
  const baseUrl = String(store.data()!.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl || !secret.exists) throw new HttpError(400, 'This store is not connected yet. Add the shop address and API key in Integrations.', 'store_not_connected');
  return { baseUrl, apiKey: decrypt(secret.data()!.enc) };
}

export async function shopRequest<T = any>(storeId: string, method: string, path: string, body?: unknown, conn?: { baseUrl: string; apiKey: string }): Promise<T> {
  const { baseUrl, apiKey } = conn || await storeConn(storeId);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/integration/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000), // Render free instances can take ~50s to wake up
    });
  } catch (e) {
    throw new HttpError(502, `Could not reach the shop at ${baseUrl} (${(e as Error).message}). If it is on Render's free plan it may be waking up — try again in a minute.`, 'shop_unreachable');
  }
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (res.status === 404 && !data.error) throw new HttpError(502, 'The shop does not have the integration API yet. Deploy the updated davetech-shop code.', 'shop_no_api');
  if (res.status === 401) throw new HttpError(502, 'The shop rejected the API key. Check IMPORTER_API_KEY on the shop matches the key saved here.', 'shop_auth');
  if (!res.ok) throw new HttpError(502, `Shop error: ${data.error || res.status}`, 'shop_error', data);
  return data as T;
}

export const shop = {
  health: (storeId: string, conn?: { baseUrl: string; apiKey: string }) =>
    shopRequest<{ ok: boolean; store_name: string; currency: string; version: string }>(storeId, 'GET', '/health', undefined, conn),
  categories: (storeId: string) => shopRequest<{ categories: { id: number; name: string }[] }>(storeId, 'GET', '/categories'),
  ensureCategory: (storeId: string, name: string) => shopRequest<{ id: number; name: string }>(storeId, 'POST', '/categories', { name }),
  upsertProduct: (storeId: string, externalId: string, p: ShopProductPayload) =>
    shopRequest<{ id: number; created: boolean }>(storeId, 'PUT', `/products/${encodeURIComponent(externalId)}`, p),
  removeProduct: (storeId: string, externalId: string) =>
    shopRequest<{ result: 'deleted' | 'hidden' | 'not_found' }>(storeId, 'DELETE', `/products/${encodeURIComponent(externalId)}`),
  orders: (storeId: string, params: { since?: string; status?: string; limit?: number } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]));
    return shopRequest<{ orders: ShopOrder[] }>(storeId, 'GET', `/orders?${q}`);
  },
  updateOrder: (storeId: string, code: string, patch: { supplier_order_no?: string; tracking_no?: string; status?: string }) =>
    shopRequest<{ order: ShopOrder }>(storeId, 'PATCH', `/orders/${encodeURIComponent(code)}`, patch),
};
