import { col } from '../firebase.js';
import { DEFAULT_RULE, type PricingRuleSet } from '../../shared/pricing.js';
import type { Settings } from '../../shared/types.js';

export const DEFAULT_SETTINGS: Settings = {
  storeCurrency: 'KES',
  exchange: { provider: 'manual', manualRates: { USD: 130, KES: 1 }, lastRates: {}, lastFetchedAt: null },
  sync: { enabled: false, everyHours: 12, priceChangeThresholdPercent: 5, onUnavailable: 'unpublish', autoRecalculate: true },
  dropshipMode: 'manual',
  automatedPurchasingEnabled: false,
  maxAutoOrderValue: 0,
};

export async function getSettings(storeId: string): Promise<Settings> {
  const snap = await col.stores().doc(storeId).get();
  const s = (snap.data()?.settings || {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS, ...s,
    exchange: { ...DEFAULT_SETTINGS.exchange, ...(s.exchange || {}) },
    sync: { ...DEFAULT_SETTINGS.sync, ...(s.sync || {}) },
  };
}

export async function getPricingRules(storeId: string): Promise<PricingRuleSet> {
  const snap = await col.pricingRules().doc(storeId).get();
  const d = snap.data() || {};
  return { global: { ...DEFAULT_RULE, ...(d.global || {}) }, categories: d.categories || {} };
}
