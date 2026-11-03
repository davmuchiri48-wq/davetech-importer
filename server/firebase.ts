import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { config } from './config.js';

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(config.firebaseServiceAccount)) });
}

export const db: Firestore = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
export const auth = getAuth();

export const nowIso = () => new Date().toISOString();

/** Collections from the spec. Every store-specific document carries a storeId field. */
export const col = {
  users: () => db.collection('users'),
  invites: () => db.collection('invites'),
  stores: () => db.collection('stores'),
  secrets: () => db.collection('secrets'),          // server-only: encrypted keys/tokens
  suppliers: () => db.collection('suppliers'),
  products: () => db.collection('products'),
  categories: () => db.collection('categories'),
  customers: () => db.collection('customers'),
  orders: () => db.collection('orders'),
  supplierOrders: () => db.collection('supplierOrders'),
  payments: () => db.collection('payments'),
  transactions: () => db.collection('transactions'),
  pricingRules: () => db.collection('pricingRules'),
  automationRules: () => db.collection('automationRules'),
  importJobs: () => db.collection('importJobs'),
  syncJobs: () => db.collection('syncJobs'),
  trackingEvents: () => db.collection('trackingEvents'),
  notifications: () => db.collection('notifications'),
  auditLogs: () => db.collection('auditLogs'),
};

/**
 * Runs an equality-only query and sorts newest-first in memory, so Firestore never needs
 * composite indexes (nothing extra to set up). Fine for the data sizes of one shop.
 */
export async function newest(q: FirebaseFirestore.Query, field: string, limit: number, filter?: (d: FirebaseFirestore.DocumentData) => boolean) {
  const snap = await q.get();
  return snap.docs
    .filter((d) => !filter || filter(d.data()))
    .sort((a, b) => String(b.get(field) ?? '').localeCompare(String(a.get(field) ?? '')))
    .slice(0, limit);
}
