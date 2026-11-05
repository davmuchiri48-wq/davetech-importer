import type { PricingRule, PriceBreakdown } from './pricing.js';

export type Role = 'admin' | 'staff';
export type PublicationStatus = 'draft' | 'published' | 'unpublished' | 'archived';
export type Availability = 'available' | 'unavailable' | 'unknown';
export type ImportSource = 'aliexpress_api' | 'manual' | 'local';

export interface AppUser {
  uid: string;
  email: string;
  role: Role;
  storeIds: string[];
  disabled?: boolean;
}

export interface Store {
  id: string;
  name: string;
  type: 'flask_shop';
  baseUrl: string;          // e.g. https://davetech-shop.onrender.com
  hasApiKey: boolean;       // the key itself is never sent to the browser
  currency: string;         // KES
  createdAt: string;
}

export interface Variant {
  sku: string;              // supplier SKU id where supplied
  attributes: Record<string, string>; // { Color: 'Black', Size: 'XL' }
  supplierPrice: number | null;
  stock: number | null;     // null = not supplied (NOT unlimited)
  image?: string;
}

/** Original supplier data. Never edited by the admin; refreshed only by sync. */
export interface SupplierSnapshot {
  source: ImportSource;
  supplierProductId: string;
  supplierUrl: string;
  title: string;
  description: string;
  images: string[];
  price: number | null;
  shipping: number | null;
  currency: string;
  variants: Variant[];
  stock: number | null;
  categoryName?: string;
  storeName?: string;       // AliExpress seller name if supplied
  supplierId?: string;      // local supplier (suppliers/ collection)
  fetchedAt: string;
}

export interface Product {
  id: string;
  storeId: string;
  supplierProductId: string;
  supplierId?: string | null; // set for local-supplier products
  supplier: SupplierSnapshot;
  // editable store copy
  name: string;
  slug: string;
  description: string;
  images: string[];
  mainImage: string;
  categoryId: string | null;
  sku: string;
  seoTitle: string;
  seoDescription: string;
  variants: Variant[];
  pricingOverride: Partial<PricingRule> | null;
  manualPrice: number | null;
  priceLocked: boolean;
  pricing: PriceBreakdown | null;
  exchangeRate: number | null;
  availability: Availability;
  status: PublicationStatus;
  shopProductId: number | null; // id in the Flask shop once published
  lastPublishedAt: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  storeId: string;
  name: string;
  supplierCategoryNames: string[]; // AliExpress categories mapped to this store category
  shopCategoryId: number | null;
}

export interface ImportJob {
  id: string;
  storeId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'duplicate';
  source: ImportSource;
  supplierProductId: string;
  input: Record<string, unknown>;
  productId: string | null;
  error: string | null;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface Settings {
  storeCurrency: string;
  exchange: {
    provider: 'manual' | 'open_er_api';
    manualRates: Record<string, number>; // 1 <code> = x store currency
    lastRates?: Record<string, number>;
    lastFetchedAt?: string | null;
  };
  sync: {
    enabled: boolean;
    everyHours: number;
    priceChangeThresholdPercent: number;
    onUnavailable: 'unpublish' | 'mark_only';
    autoRecalculate: boolean;
  };
  dropshipMode: 'manual' | 'semi_automatic' | 'fully_automatic';
  automatedPurchasingEnabled: boolean; // master emergency switch
  maxAutoOrderValue: number;
}

export interface ShopOrder {
  id: number;
  code: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  subtotal: number;
  delivery: number;
  total: number;
  payment_method: string;
  payment_status: string;
  mpesa_receipt: string | null;
  status: string;
  supplier_order_no: string;
  tracking_no: string;
  created: string;
  items: {
    product_id: number | null; name: string; price: number; qty: number;
    dropship: boolean; supplier_url: string; supplier_cost: number; external_id: string | null;
  }[];
}

export interface AuditLog {
  id: string;
  storeId: string | null;
  uid: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
  at: string;
}

export interface LocalSupplier {
  id: string;
  storeId: string;
  name: string;            // shop / business name
  contactPerson: string;
  phone: string;           // WhatsApp number, stored as 2547XXXXXXXX
  location: string;        // e.g. "Eastleigh, 1st Avenue, Shop B12"
  paymentTerms: string;    // e.g. "Pay on pickup", "M-Pesa till 123456"
  deliveryNote: string;    // e.g. "Rider collects 9am-5pm"
  notes: string;
  active: boolean;
  productCount?: number;
  createdAt: string;
}

/** 0712 345 678 / +254712345678 / 254712345678 → 254712345678 (null if not a Kenyan mobile) */
export function normalizeKePhone(input: string): string | null {
  const d = String(input || '').replace(/\D/g, '');
  let n = d;
  if (/^0[17]\d{8}$/.test(d)) n = '254' + d.slice(1);
  else if (/^[17]\d{8}$/.test(d)) n = '254' + d;
  return /^254[17]\d{8}$/.test(n) ? n : null;
}

export const whatsappLink = (phone: string, text?: string) =>
  `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
