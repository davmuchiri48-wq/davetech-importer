import { col, nowIso } from '../firebase.js';
import { HttpError } from '../http.js';
import { getSettings } from './settings.js';

/**
 * Returns "1 <currency> = x <store currency>".
 * Provider "manual" uses rates typed into Settings. Provider "open_er_api" fetches
 * https://open.er-api.com (free, no key) and caches the result for 12 hours.
 * If a rate is missing we throw — we never guess a rate.
 */
export async function getRate(storeId: string, currency: string): Promise<number> {
  const settings = await getSettings(storeId);
  const cur = currency.toUpperCase();
  if (cur === settings.storeCurrency) return 1;

  if (settings.exchange.provider === 'open_er_api') {
    const fresh = settings.exchange.lastFetchedAt && Date.now() - Date.parse(settings.exchange.lastFetchedAt) < 12 * 3600e3;
    let rates = settings.exchange.lastRates || {};
    if (!fresh || !rates[cur]) {
      try { rates = await refreshRates(storeId); } catch (e) {
        if (!rates[cur]) throw e; // fall back to the cached rate only if we have one
      }
    }
    if (rates[cur]) return rates[cur];
  }
  const manual = settings.exchange.manualRates?.[cur];
  if (manual && manual > 0) return manual;
  throw new HttpError(400, `No exchange rate set for ${cur} → ${settings.storeCurrency}. Add it in Settings → Currency.`, 'no_rate');
}

export async function refreshRates(storeId: string): Promise<Record<string, number>> {
  const settings = await getSettings(storeId);
  const base = settings.storeCurrency;
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
  if (!res.ok) throw new HttpError(502, `Exchange rate service returned ${res.status}`, 'rate_service');
  const data = (await res.json()) as { result: string; rates: Record<string, number> };
  if (data.result !== 'success') throw new HttpError(502, 'Exchange rate service failed', 'rate_service');
  // API gives 1 KES = r X  → we store 1 X = 1/r KES
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.rates)) if (v > 0) rates[k] = Math.round((1 / v) * 10000) / 10000;
  await col.stores().doc(storeId).set({ settings: { exchange: { lastRates: rates, lastFetchedAt: nowIso() } } }, { merge: true });
  return rates;
}
