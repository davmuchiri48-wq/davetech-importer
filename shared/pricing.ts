/**
 * Pricing engine — pure functions shared by the server and the dashboard.
 *
 * Landed Cost   = (Supplier Price + Supplier Shipping) × Exchange Rate + Additional Costs
 * Selling Price = Landed Cost + Markup   (then minimum-profit, minimum-price and rounding rules)
 *
 * All money values are plain numbers. Supplier amounts are in the supplier currency,
 * everything after conversion is in the store currency (default KES).
 */

export type MarkupType = 'percent' | 'fixed';
export type RoundingMode = 'none' | 'nearest_1' | 'nearest_10' | 'nearest_50' | 'nearest_100' | 'end_99';

export interface PricingRule {
  markupType: MarkupType;
  markupValue: number;          // 40 = 40% when percent, 40 = KES 40 when fixed
  additionalCosts: number;      // store currency, per unit (packaging, clearing, local delivery to you…)
  minProfit: number;            // store currency; 0 = no minimum
  minSellingPrice: number;      // store currency; 0 = no minimum
  rounding: RoundingMode;
}

export interface PricingRuleSet {
  global: PricingRule;
  categories: Record<string, Partial<PricingRule>>; // keyed by store category id
}

export interface PriceInput {
  supplierPrice: number;
  supplierShipping: number;
  supplierCurrency: string;
  exchangeRate: number;         // 1 unit of supplier currency = exchangeRate store currency
  rule: PricingRule;
  manualPrice?: number | null;  // locked / overridden selling price
}

export interface PriceBreakdown {
  supplierCostConverted: number;
  shippingConverted: number;
  additionalCosts: number;
  landedCost: number;
  markupAmount: number;
  calculatedPrice: number;      // what the rules produce
  sellingPrice: number;         // what will be charged (manual price wins)
  expectedProfit: number;
  marginPercent: number;
  usedManualPrice: boolean;
  warnings: string[];
}

export const DEFAULT_RULE: PricingRule = {
  markupType: 'percent',
  markupValue: 40,
  additionalCosts: 0,
  minProfit: 0,
  minSellingPrice: 0,
  rounding: 'none',
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function roundPrice(value: number, mode: RoundingMode): number {
  switch (mode) {
    case 'nearest_1': return Math.round(value);
    case 'nearest_10': return Math.ceil(value / 10) * 10;
    case 'nearest_50': return Math.ceil(value / 50) * 50;
    case 'nearest_100': return Math.ceil(value / 100) * 100;
    case 'end_99': return Math.max(Math.ceil((value + 1) / 100) * 100 - 1, 99);
    default: return r2(value);
  }
}

/** Product rule > category rule > global rule. Missing fields fall back to the next level. */
export function resolveRule(
  set: PricingRuleSet,
  categoryId?: string | null,
  productOverride?: Partial<PricingRule> | null,
): PricingRule {
  const cat = (categoryId && set.categories?.[categoryId]) || {};
  return { ...DEFAULT_RULE, ...set.global, ...clean(cat), ...clean(productOverride || {}) };
}

function clean<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

export function calculatePrice(input: PriceInput): PriceBreakdown {
  const { supplierPrice, supplierShipping, exchangeRate, rule } = input;
  const warnings: string[] = [];
  if (!(exchangeRate > 0)) throw new Error('Exchange rate must be greater than 0');
  if (supplierPrice < 0 || supplierShipping < 0) throw new Error('Supplier amounts cannot be negative');

  const supplierCostConverted = r2(supplierPrice * exchangeRate);
  const shippingConverted = r2(supplierShipping * exchangeRate);
  const additionalCosts = r2(rule.additionalCosts || 0);
  const landedCost = r2(supplierCostConverted + shippingConverted + additionalCosts);

  const markupAmount = r2(rule.markupType === 'percent' ? landedCost * (rule.markupValue / 100) : rule.markupValue);
  let price = landedCost + markupAmount;

  if (rule.minProfit > 0 && price - landedCost < rule.minProfit) {
    price = landedCost + rule.minProfit;
    warnings.push(`Raised to meet minimum profit of ${rule.minProfit}`);
  }
  if (rule.minSellingPrice > 0 && price < rule.minSellingPrice) {
    price = rule.minSellingPrice;
    warnings.push(`Raised to minimum selling price of ${rule.minSellingPrice}`);
  }
  const calculatedPrice = roundPrice(price, rule.rounding);

  const usedManualPrice = input.manualPrice != null && input.manualPrice > 0;
  const sellingPrice = usedManualPrice ? r2(input.manualPrice as number) : calculatedPrice;
  const expectedProfit = r2(sellingPrice - landedCost);
  if (expectedProfit < 0) warnings.push('Selling price is below landed cost — this product loses money');
  else if (usedManualPrice && rule.minProfit > 0 && expectedProfit < rule.minProfit)
    warnings.push('Manual price is below the minimum profit rule');

  return {
    supplierCostConverted, shippingConverted, additionalCosts, landedCost, markupAmount,
    calculatedPrice, sellingPrice, expectedProfit,
    marginPercent: sellingPrice > 0 ? r2((expectedProfit / sellingPrice) * 100) : 0,
    usedManualPrice, warnings,
  };
}

/** Convert an amount between currencies with a rate table expressed as "1 USD = x". */
export function convert(amount: number, from: string, to: string, ratesPerUsd: Record<string, number>): number {
  if (from === to) return amount;
  const f = ratesPerUsd[from.toUpperCase()];
  const t = ratesPerUsd[to.toUpperCase()];
  if (!f || !t) throw new Error(`No exchange rate for ${from} → ${to}`);
  return (amount / f) * t;
}

export function rateBetween(from: string, to: string, ratesPerUsd: Record<string, number>): number {
  return convert(1, from, to, ratesPerUsd);
}

/** Percentage change between two supplier prices, used by sync thresholds. */
export function percentChange(oldValue: number, newValue: number): number {
  if (!oldValue) return newValue ? 100 : 0;
  return r2(((newValue - oldValue) / oldValue) * 100);
}
