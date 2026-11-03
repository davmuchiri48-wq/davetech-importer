import { FieldValue } from 'firebase-admin/firestore';
import { db, col, nowIso } from '../firebase.js';
import { HttpError } from '../http.js';
import { calculatePrice, resolveRule } from '../../shared/pricing.js';
import type { Product, SupplierSnapshot, Category } from '../../shared/types.js';
import { getPricingRules } from './settings.js';
import { getRate } from './exchange.js';
import { shop } from '../shop/client.js';
import { notify } from '../audit.js';

/** AliExpress descriptions are HTML; the shop shows plain text, so convert it. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>(?!\n)/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim().slice(0, 20000);
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 70) || 'product';

/** Key document that makes "one product per supplier item per store" atomic. */
const keyRef = (storeId: string, key: string) => db.collection('productKeys').doc(`${storeId}__${key}`);

export async function findDuplicate(storeId: string, supplierProductId: string): Promise<string | null> {
  const k = await keyRef(storeId, supplierProductId).get();
  return k.exists ? String(k.data()!.productId) : null;
}

export async function getProduct(storeId: string, id: string): Promise<Product> {
  const snap = await col.products().doc(id).get();
  if (!snap.exists || snap.data()!.storeId !== storeId) throw new HttpError(404, 'Product not found');
  return { id: snap.id, ...(snap.data() as Omit<Product, 'id'>) };
}

/** Finds the store category mapped to an AliExpress category name, if any. */
async function mapCategory(storeId: string, supplierCategory?: string): Promise<string | null> {
  if (!supplierCategory) return null;
  const q = await col.categories().where('storeId', '==', storeId).get();
  const hit = q.docs.find((d) => (d.get('supplierCategoryNames') || []).includes(supplierCategory));
  return hit ? hit.id : null;
}

export async function priceFor(storeId: string, p: Pick<Product, 'supplier' | 'categoryId' | 'pricingOverride' | 'manualPrice' | 'priceLocked'>) {
  if (p.supplier.price == null) return { pricing: null, exchangeRate: null };
  const [rules, rate] = await Promise.all([getPricingRules(storeId), getRate(storeId, p.supplier.currency)]);
  const rule = resolveRule(rules, p.categoryId, p.pricingOverride);
  const pricing = calculatePrice({
    supplierPrice: p.supplier.price, supplierShipping: p.supplier.shipping ?? 0, supplierCurrency: p.supplier.currency,
    exchangeRate: rate, rule, manualPrice: p.priceLocked ? p.manualPrice : null,
  });
  if (p.supplier.shipping == null) pricing.warnings.push('Supplier shipping cost unknown — counted as 0. Add it before publishing.');
  return { pricing, exchangeRate: rate };
}

/** Creates a draft product from a supplier snapshot. Fails with 409 on duplicates. */
export async function createProductFromSnapshot(storeId: string, snap: SupplierSnapshot, edits: Partial<Product> = {}): Promise<Product> {
  const ref = col.products().doc();
  const categoryId = edits.categoryId ?? await mapCategory(storeId, snap.categoryName);
  const now = nowIso();
  const base: Omit<Product, 'id'> = {
    storeId,
    supplierProductId: snap.supplierProductId,
    supplier: snap,
    name: edits.name || snap.title,
    slug: `${slugify(edits.name || snap.title)}-${ref.id.slice(0, 5).toLowerCase()}`,
    description: edits.description ?? (snap.source === 'aliexpress_api' ? htmlToText(snap.description) : snap.description),
    images: edits.images ?? snap.images,
    mainImage: edits.mainImage || (edits.images ?? snap.images)[0] || '',
    categoryId,
    sku: edits.sku || snap.variants[0]?.sku || '',
    seoTitle: edits.seoTitle || (edits.name || snap.title).slice(0, 60),
    seoDescription: edits.seoDescription || '',
    variants: snap.variants,
    pricingOverride: edits.pricingOverride ?? null,
    manualPrice: edits.manualPrice ?? null,
    priceLocked: Boolean(edits.priceLocked && edits.manualPrice),
    pricing: null,
    exchangeRate: null,
    availability: snap.stock == null ? 'unknown' : snap.stock > 0 ? 'available' : 'unavailable',
    status: 'draft',
    shopProductId: null,
    lastPublishedAt: null,
    lastSyncedAt: now,
    syncError: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const priced = await priceFor(storeId, base);
    base.pricing = priced.pricing; base.exchangeRate = priced.exchangeRate;
  } catch (e) {
    base.syncError = (e as Error).message; // e.g. no exchange rate yet — product is still saved as draft
  }

  await db.runTransaction(async (tx) => {
    const k = keyRef(storeId, snap.supplierProductId);
    const existing = await tx.get(k);
    if (existing.exists) throw new HttpError(409, 'This AliExpress product is already in your store', 'duplicate', { productId: existing.data()!.productId });
    tx.create(k, { storeId, productId: ref.id, at: now });
    tx.create(ref, base);
  });
  return { id: ref.id, ...base };
}

export async function updateProduct(storeId: string, id: string, patch: Partial<Product>, opts: { allowUnlock?: boolean } = {}) {
  const current = await getProduct(storeId, id);
  // Store copy is editable; the supplier snapshot never is.
  const allowed: (keyof Product)[] = ['name', 'description', 'images', 'mainImage', 'categoryId', 'sku', 'seoTitle', 'seoDescription', 'pricingOverride', 'manualPrice', 'priceLocked', 'variants'];
  const next: any = { ...current };
  for (const k of allowed) if (k in patch) next[k] = (patch as any)[k];
  if ('supplierShipping' in (patch as any)) next.supplier = { ...current.supplier, shipping: (patch as any).supplierShipping };
  if ('supplierPrice' in (patch as any) && current.supplier.source === 'manual') next.supplier = { ...next.supplier, price: (patch as any).supplierPrice };
  if (current.priceLocked && next.priceLocked === false && !opts.allowUnlock) throw new HttpError(403, 'Only an administrator can unlock a locked price');
  if (next.priceLocked && !(next.manualPrice > 0)) throw new HttpError(400, 'Enter a manual price before locking it');
  if (next.name !== current.name) next.slug = `${slugify(next.name)}-${id.slice(0, 5).toLowerCase()}`;
  if (!next.images.includes(next.mainImage)) next.mainImage = next.images[0] || '';
  try {
    const priced = await priceFor(storeId, next);
    next.pricing = priced.pricing; next.exchangeRate = priced.exchangeRate; next.syncError = null;
  } catch (e) { next.syncError = (e as Error).message; }
  next.updatedAt = nowIso();
  const { id: _id, ...data } = next;
  await col.products().doc(id).set(data);
  return next as Product;
}

export async function deleteProduct(storeId: string, id: string) {
  const p = await getProduct(storeId, id);
  if (p.shopProductId) await shop.removeProduct(storeId, id);
  await db.runTransaction(async (tx) => {
    tx.delete(col.products().doc(id));
    const k = keyRef(storeId, (p as any).importKey || p.supplierProductId);
    const ks = await tx.get(k);
    if (ks.exists && ks.data()!.productId === id) tx.delete(k);
  });
}

export async function duplicateProduct(storeId: string, id: string) {
  const p = await getProduct(storeId, id);
  const ref = col.products().doc();
  const now = nowIso();
  const { id: _i, ...rest } = p;
  const copy = { ...rest, name: `${p.name} (copy)`, slug: `${p.slug}-copy-${ref.id.slice(0, 4).toLowerCase()}`, status: 'draft', shopProductId: null, lastPublishedAt: null, createdAt: now, updatedAt: now, importKey: `${p.supplierProductId}#${ref.id}` };
  await db.runTransaction(async (tx) => {
    tx.create(keyRef(storeId, copy.importKey), { storeId, productId: ref.id, at: now });
    tx.create(ref, copy);
  });
  return { id: ref.id, ...copy };
}

/** Pushes a product to the Flask shop. Never publishes unavailable or loss-making items without permission. */
export async function publishProduct(storeId: string, id: string, opts: { allowLoss?: boolean } = {}) {
  const p = await getProduct(storeId, id);
  if (p.availability === 'unavailable') throw new HttpError(400, 'This product is unavailable at the supplier, so it cannot be published', 'unavailable');
  const priced = await priceFor(storeId, p);
  if (!priced.pricing || !(priced.pricing.sellingPrice > 0)) throw new HttpError(400, 'Set a supplier price first so a selling price can be calculated', 'no_price');
  if (priced.pricing.expectedProfit < 0 && !opts.allowLoss) throw new HttpError(400, 'Selling price is below landed cost. Fix the price or confirm you want to sell at a loss.', 'loss');
  if (p.supplier.shipping == null) throw new HttpError(400, 'Enter the supplier shipping cost before publishing', 'no_shipping');
  if (!p.mainImage) throw new HttpError(400, 'Add at least one image before publishing', 'no_image');

  let shopCategoryId: number | null = null;
  if (p.categoryId) {
    const cs = await col.categories().doc(p.categoryId).get();
    const c = cs.data() as Category | undefined;
    if (c && c.storeId === storeId) {
      shopCategoryId = c.shopCategoryId ?? (await shop.ensureCategory(storeId, c.name)).id;
      if (!c.shopCategoryId) await cs.ref.update({ shopCategoryId });
    }
  }
  const pr = priced.pricing;
  const res = await shop.upsertProduct(storeId, id, {
    name: p.name,
    description: p.description,
    price: Math.round(pr.sellingPrice),
    image: p.mainImage,
    images: [p.mainImage, ...p.images.filter((i) => i !== p.mainImage)].slice(0, 10),
    category_id: shopCategoryId,
    active: true,
    dropship: true,
    supplier_url: p.supplier.supplierUrl,
    supplier_cost: Math.round(pr.supplierCostConverted + pr.additionalCosts),
    supplier_shipping: Math.round(pr.shippingConverted),
    sku: p.sku,
    seo_title: p.seoTitle,
    seo_description: p.seoDescription,
  });
  const now = nowIso();
  await col.products().doc(id).update({ status: 'published', shopProductId: res.id, lastPublishedAt: now, updatedAt: now, pricing: pr, exchangeRate: priced.exchangeRate });
  return { shopProductId: res.id };
}

export async function unpublishProduct(storeId: string, id: string, status: 'unpublished' | 'archived' = 'unpublished') {
  const p = await getProduct(storeId, id);
  if (p.shopProductId) await shop.removeProduct(storeId, id);
  await col.products().doc(id).update({ status, shopProductId: status === 'archived' ? null : p.shopProductId, updatedAt: nowIso() });
}

/** Applies a fresh supplier snapshot (from sync). Respects locked prices and the unavailable rule. */
export async function applySupplierUpdate(storeId: string, id: string, snap: SupplierSnapshot, settings: { priceChangeThresholdPercent: number; onUnavailable: 'unpublish' | 'mark_only'; autoRecalculate: boolean }) {
  const p = await getProduct(storeId, id);
  const changes: string[] = [];
  const oldPrice = p.supplier.price;
  const merged: SupplierSnapshot = { ...snap, shipping: snap.shipping ?? p.supplier.shipping };
  if (oldPrice != null && merged.price != null && oldPrice !== merged.price) {
    const pct = Math.round(((merged.price - oldPrice) / oldPrice) * 10000) / 100;
    if (Math.abs(pct) >= settings.priceChangeThresholdPercent) {
      changes.push(`Supplier price changed ${pct > 0 ? '+' : ''}${pct}% (${oldPrice} → ${merged.price} ${merged.currency})`);
    }
  }
  const availability = merged.stock == null ? 'unknown' : merged.stock > 0 ? 'available' : 'unavailable';
  const patch: any = { supplier: merged, variants: merged.variants, availability, lastSyncedAt: nowIso(), syncError: null, updatedAt: nowIso() };
  if (settings.autoRecalculate) {
    const priced = await priceFor(storeId, { ...p, supplier: merged });
    patch.pricing = priced.pricing; patch.exchangeRate = priced.exchangeRate;
  }
  await col.products().doc(id).update(patch);
  await col.syncJobs().add({ storeId, productId: id, at: nowIso(), result: 'ok', changes, availability });

  if (availability === 'unavailable' && p.status === 'published') {
    if (settings.onUnavailable === 'unpublish') {
      await unpublishProduct(storeId, id);
      changes.push('Out of stock at supplier — removed from the shop');
    } else changes.push('Out of stock at supplier — still listed (your setting is "mark only")');
    await notify(storeId, 'warning', 'Product unavailable', `${p.name}: ${changes.join('. ')}`, `/products/${id}`);
  } else if (changes.length) {
    await notify(storeId, 'info', 'Supplier price change', `${p.name}: ${changes.join('. ')}`, `/products/${id}`);
    // Re-push the new price if the product is live and the price is not locked
    if (p.status === 'published' && settings.autoRecalculate && !p.priceLocked) await publishProduct(storeId, id).catch(() => undefined);
  }
  return { changes, availability };
}

export const increment = FieldValue.increment;
