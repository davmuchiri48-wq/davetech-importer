import { describe, it, expect } from 'vitest';
import { calculatePrice, resolveRule, roundPrice, convert, percentChange, DEFAULT_RULE } from '../shared/pricing';

const rule = (o = {}) => ({ ...DEFAULT_RULE, ...o });

describe('pricing engine', () => {
  it('matches the example in the brief (KES 1,300 + 390 + 100, 40% → 2,506)', () => {
    const r = calculatePrice({ supplierPrice: 1300, supplierShipping: 390, supplierCurrency: 'KES', exchangeRate: 1, rule: rule({ additionalCosts: 100, markupValue: 40 }) });
    expect(r.landedCost).toBe(1790);
    expect(r.sellingPrice).toBe(2506);
    expect(r.expectedProfit).toBe(716);
  });

  it('converts supplier currency before adding costs', () => {
    const r = calculatePrice({ supplierPrice: 10, supplierShipping: 3, supplierCurrency: 'USD', exchangeRate: 130, rule: rule({ additionalCosts: 100, markupValue: 50 }) });
    expect(r.supplierCostConverted).toBe(1300);
    expect(r.shippingConverted).toBe(390);
    expect(r.landedCost).toBe(1790);
    expect(r.sellingPrice).toBe(2685);
  });

  it('supports fixed markup, minimum profit and minimum price', () => {
    expect(calculatePrice({ supplierPrice: 100, supplierShipping: 0, supplierCurrency: 'KES', exchangeRate: 1, rule: rule({ markupType: 'fixed', markupValue: 250 }) }).sellingPrice).toBe(350);
    const mp = calculatePrice({ supplierPrice: 100, supplierShipping: 0, supplierCurrency: 'KES', exchangeRate: 1, rule: rule({ markupValue: 10, minProfit: 300 }) });
    expect(mp.sellingPrice).toBe(400);
    expect(mp.warnings.join()).toMatch(/minimum profit/);
    expect(calculatePrice({ supplierPrice: 100, supplierShipping: 0, supplierCurrency: 'KES', exchangeRate: 1, rule: rule({ minSellingPrice: 999 }) }).sellingPrice).toBe(999);
  });

  it('rounds prices', () => {
    expect(roundPrice(2506.4, 'nearest_10')).toBe(2510);
    expect(roundPrice(2506.4, 'nearest_50')).toBe(2550);
    expect(roundPrice(2506.4, 'end_99')).toBe(2599);
    expect(roundPrice(2499, 'end_99')).toBe(2599 - 100);
    expect(roundPrice(2506.4, 'nearest_1')).toBe(2506);
  });

  it('manual (locked) price wins and loss is flagged', () => {
    const r = calculatePrice({ supplierPrice: 1000, supplierShipping: 0, supplierCurrency: 'KES', exchangeRate: 1, rule: rule(), manualPrice: 900 });
    expect(r.usedManualPrice).toBe(true);
    expect(r.sellingPrice).toBe(900);
    expect(r.calculatedPrice).toBe(1400);
    expect(r.expectedProfit).toBe(-100);
    expect(r.warnings.join()).toMatch(/loses money/);
  });

  it('product override > category > global', () => {
    const set = { global: rule({ markupValue: 40 }), categories: { phones: { markupValue: 25 } } };
    expect(resolveRule(set, 'phones').markupValue).toBe(25);
    expect(resolveRule(set, 'phones', { markupValue: 60 }).markupValue).toBe(60);
    expect(resolveRule(set, 'other').markupValue).toBe(40);
  });

  it('rejects invalid exchange rates rather than guessing', () => {
    expect(() => calculatePrice({ supplierPrice: 1, supplierShipping: 0, supplierCurrency: 'USD', exchangeRate: 0, rule: rule() })).toThrow();
  });

  it('currency conversion and percent change', () => {
    expect(convert(10, 'USD', 'KES', { USD: 1, KES: 130 })).toBe(1300);
    expect(() => convert(10, 'USD', 'EUR', { USD: 1 })).toThrow();
    expect(percentChange(10, 11)).toBe(10);
  });
});
