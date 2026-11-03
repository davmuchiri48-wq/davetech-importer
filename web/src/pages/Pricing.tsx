import { useEffect, useState } from 'react';
import { Save, Calculator, Trash2, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { useSession } from '../lib/session';
import { Button, Card, ErrorBox, Field, Notice, PageHeader, Skeleton, useApiData, useUi } from '../components/ui';
import type { PricingRule, PricingRuleSet } from '../../../shared/pricing';

const ROUNDING: [PricingRule['rounding'], string][] = [['none', 'No rounding'], ['nearest_1', 'Whole shillings'], ['nearest_10', 'Up to next 10'], ['nearest_50', 'Up to next 50'], ['nearest_100', 'Up to next 100'], ['end_99', 'End in 99 (e.g. 2,599)']];

function RuleForm({ rule, onChange, partial }: { rule: Partial<PricingRule>; onChange: (r: Partial<PricingRule>) => void; partial?: boolean }) {
  const num = (k: keyof PricingRule) => ({
    type: 'number', min: 0, step: 'any', className: 'input', placeholder: partial ? 'global' : '0',
    value: (rule[k] as number | undefined) ?? '', onChange: (e: any) => onChange({ ...rule, [k]: e.target.value === '' ? undefined : Number(e.target.value) }),
  });
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Markup type"><select className="input" value={rule.markupType ?? ''} onChange={(e) => onChange({ ...rule, markupType: (e.target.value || undefined) as any })}>{partial && <option value="">global</option>}<option value="percent">Percentage</option><option value="fixed">Fixed amount (KES)</option></select></Field>
      <Field label={rule.markupType === 'fixed' ? 'Markup (KES)' : 'Markup (%)'}><input {...num('markupValue')} /></Field>
      <Field label="Additional costs per item (KES)" hint="Packaging, clearing, local courier…"><input {...num('additionalCosts')} /></Field>
      <Field label="Minimum profit (KES)"><input {...num('minProfit')} /></Field>
      <Field label="Minimum selling price (KES)"><input {...num('minSellingPrice')} /></Field>
      <Field label="Rounding"><select className="input" value={rule.rounding ?? ''} onChange={(e) => onChange({ ...rule, rounding: (e.target.value || undefined) as any })}>{partial && <option value="">global</option>}{ROUNDING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
    </div>
  );
}

export default function Pricing() {
  const { store, isAdmin } = useSession();
  const { toast } = useUi();
  const rules = useApiData(() => api<PricingRuleSet>('/pricing-rules'), [store?.id]);
  const cats = useApiData(() => api<{ categories: any[] }>('/categories'), [store?.id]);
  const [set, setSet] = useState<PricingRuleSet | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addCat, setAddCat] = useState('');
  const [calc, setCalc] = useState({ supplierPrice: '1300', supplierShipping: '390', currency: 'KES', categoryId: '' });
  const [result, setResult] = useState<any>(null);
  const [calcErr, setCalcErr] = useState<string | null>(null);
  useEffect(() => { if (rules.data) setSet(rules.data); }, [rules.data]);

  const save = async () => {
    if (!set) return;
    setBusy('save');
    const clean = Object.fromEntries(Object.entries(set.categories).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined))]));
    try { await api('/pricing-rules', { method: 'PUT', body: { global: set.global, categories: clean } }); toast('success', 'Pricing rules saved'); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };
  const recalc = async () => {
    setBusy('recalc');
    try { const r = await api('/pricing/recalculate', { body: {} }); toast(r.errors.length ? 'error' : 'success', `${r.updated} products recalculated${r.errors.length ? `; ${r.errors[0]}` : ''}`); }
    catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };
  const runCalc = async (e?: React.FormEvent) => {
    e?.preventDefault(); setCalcErr(null);
    try { setResult(await api('/pricing/preview', { body: { supplierPrice: Number(calc.supplierPrice), supplierShipping: Number(calc.supplierShipping), currency: calc.currency, categoryId: calc.categoryId || null } })); }
    catch (err) { setCalcErr((err as Error).message); setResult(null); }
  };

  return (
    <div>
      <PageHeader title="Pricing Rules" subtitle="Landed Cost = (Supplier Price + Supplier Shipping) × Exchange Rate + Additional Costs · Selling Price = Landed Cost + Markup"
        actions={isAdmin && <><Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy === 'recalc'} onClick={recalc}>Recalculate all products</Button><Button icon={<Save className="h-4 w-4" />} loading={busy === 'save'} onClick={save}>Save rules</Button></>} />
      {rules.error && <ErrorBox error={rules.error} onRetry={rules.reload} />}
      {!set ? <Skeleton className="h-64" /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Global defaults"><RuleForm rule={set.global} onChange={(g) => setSet({ ...set, global: g as PricingRule })} /></Card>
            <Card title="Category rules" actions={isAdmin && (
              <div className="flex gap-2"><select className="input !py-1 text-xs" value={addCat} onChange={(e) => setAddCat(e.target.value)} aria-label="Category"><option value="">Choose category…</option>{cats.data?.categories.filter((c) => !set.categories[c.id]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <Button size="sm" disabled={!addCat} onClick={() => { setSet({ ...set, categories: { ...set.categories, [addCat]: {} } }); setAddCat(''); }}>Add rule</Button></div>
            )}>
              {Object.keys(set.categories).length === 0 && <p className="text-sm text-slate-500">No category rules — every product uses the global defaults. Product-specific markup is set on each product.</p>}
              <div className="space-y-5">
                {Object.entries(set.categories).map(([cid, r]) => (
                  <div key={cid}>
                    <div className="mb-2 flex items-center justify-between"><b className="text-sm">{cats.data?.categories.find((c) => c.id === cid)?.name || 'Deleted category'}</b>
                      <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { const c = { ...set.categories }; delete c[cid]; setSet({ ...set, categories: c }); }}>Remove</Button></div>
                    <RuleForm partial rule={r} onChange={(nr) => setSet({ ...set, categories: { ...set.categories, [cid]: nr } })} />
                  </div>
                ))}
              </div>
            </Card>
            <Notice>Products with a <b>locked manual price</b> are never changed by these rules. Save, then press <b>Recalculate all products</b> to apply new rules (published products update in the shop when you next publish or sync).</Notice>
          </div>
          <Card title={<span className="flex items-center gap-2"><Calculator className="h-4 w-4" />Price calculator</span>}>
            <form className="space-y-3" onSubmit={runCalc}>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Supplier price"><input className="input" type="number" step="any" min="0" value={calc.supplierPrice} onChange={(e) => setCalc({ ...calc, supplierPrice: e.target.value })} /></Field>
                <Field label="Supplier shipping"><input className="input" type="number" step="any" min="0" value={calc.supplierShipping} onChange={(e) => setCalc({ ...calc, supplierShipping: e.target.value })} /></Field>
                <Field label="Currency"><select className="input" value={calc.currency} onChange={(e) => setCalc({ ...calc, currency: e.target.value })}>{['KES', 'USD', 'EUR', 'CNY', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Category"><select className="input" value={calc.categoryId} onChange={(e) => setCalc({ ...calc, categoryId: e.target.value })}><option value="">Global</option>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              </div>
              <Button className="w-full" variant="secondary">Calculate (uses saved rules)</Button>
            </form>
            {calcErr && <div className="mt-3"><ErrorBox error={calcErr} /></div>}
            {result && (
              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Exchange rate</dt><dd>1 {calc.currency} = {result.exchangeRate} KES</dd></div>
                {[['Supplier cost', result.supplierCostConverted], ['Shipping', result.shippingConverted], ['Additional', result.additionalCosts], ['Landed cost', result.landedCost], ['Markup', result.markupAmount]].map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd>{money(v)}</dd></div>)}
                <div className="flex justify-between border-t pt-2 font-semibold dark:border-slate-700"><dt>Selling price</dt><dd>{money(result.sellingPrice)}</dd></div>
                <div className="flex justify-between font-semibold text-emerald-600"><dt>Profit</dt><dd>{money(result.expectedProfit)} ({result.marginPercent}%)</dd></div>
                {result.warnings.map((w: string) => <p key={w} className="text-xs text-amber-600">⚠ {w}</p>)}
              </dl>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
