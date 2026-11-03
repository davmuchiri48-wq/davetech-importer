import { useState } from 'react';
import { Plus, Trash2, Download, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Badge, Button, Card, Empty, ErrorBox, Field, PageHeader, Skeleton, useApiData, useUi } from '../components/ui';

export default function Categories() {
  const { store, isAdmin } = useSession();
  const { toast, confirm } = useUi();
  const { data, error, loading, reload } = useApiData(() => api<{ categories: any[] }>('/categories'), [store?.id]);
  const [name, setName] = useState('');
  const [map, setMap] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast('success', ok); await reload(); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };
  const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <div>
      <PageHeader title="Categories" subtitle="Store categories, and which AliExpress categories map into them on import."
        actions={isAdmin && <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={busy === 'imp'} onClick={() => run('imp', async () => { const r = await api('/categories/import-from-shop', { body: {} }); toast('info', `${r.added} added from the shop`); }, 'Shop categories loaded')}>Load from shop</Button>} />
      {isAdmin && (
        <Card title="Add category" className="mb-4">
          <form className="grid gap-3 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); void run('add', () => api('/categories', { body: { name, supplierCategoryNames: split(map) } }), 'Category added').then(() => { setName(''); setMap(''); }); }}>
            <div className="sm:col-span-2"><Field label="Name"><input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
            <div className="sm:col-span-2"><Field label="AliExpress categories (comma separated)" hint="Exact category names as returned by AliExpress"><input className="input" value={map} onChange={(e) => setMap(e.target.value)} /></Field></div>
            <div className="flex items-end"><Button className="w-full" icon={<Plus className="h-4 w-4" />} loading={busy === 'add'}>Add</Button></div>
          </form>
        </Card>
      )}
      <div className="card">
        {error && <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data && <Skeleton className="m-4 h-32" />}
        {data && data.categories.length === 0 && <Empty title="No categories yet" text="Add one above or load your shop's existing categories." />}
        {data?.categories.map((c) => (
          <div key={c.id} className="grid items-center gap-2 border-b border-slate-100 p-3 last:border-0 dark:border-slate-800 sm:grid-cols-6">
            <div className="font-medium sm:col-span-2">{c.name} {c.shopCategoryId ? <Badge tone="green">in shop</Badge> : <Badge>created on first publish</Badge>}</div>
            <input className="input sm:col-span-3" disabled={!isAdmin} placeholder="AliExpress category names, comma separated" value={edits[c.id] ?? c.supplierCategoryNames.join(', ')} onChange={(e) => setEdits({ ...edits, [c.id]: e.target.value })} />
            {isAdmin && <div className="flex justify-end gap-1">
              <Button size="sm" variant="secondary" icon={<Save className="h-3.5 w-3.5" />} loading={busy === `s${c.id}`} disabled={edits[c.id] === undefined} onClick={() => run(`s${c.id}`, () => api(`/categories/${c.id}`, { method: 'PUT', body: { supplierCategoryNames: split(edits[c.id]) } }), 'Mapping saved')}>Save</Button>
              <Button size="sm" variant="ghost" aria-label="Delete" icon={<Trash2 className="h-3.5 w-3.5 text-red-600" />} loading={busy === `d${c.id}`} onClick={async () => { if (await confirm({ title: `Delete ${c.name}?`, text: 'Only empty categories can be deleted. The shop keeps its own copy.', danger: true, confirmLabel: 'Delete' })) void run(`d${c.id}`, () => api(`/categories/${c.id}`, { method: 'DELETE' }), 'Deleted'); }} />
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}
