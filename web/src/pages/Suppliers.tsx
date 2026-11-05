import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, MessageCircle, MapPin, Pencil, Trash2, Store, PackagePlus } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Notice, PageHeader, Skeleton, useApiData, useUi } from '../components/ui';
import { whatsappLink, type LocalSupplier } from '../../../shared/types';

const blank = { name: '', contactPerson: '', phone: '', location: '', paymentTerms: '', deliveryNote: '', notes: '', active: true };
const prettyPhone = (p: string) => (p.startsWith('254') ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);

export default function Suppliers() {
  const { store, isAdmin } = useSession();
  const { toast, confirm } = useUi();
  const { data, error, loading, reload } = useApiData(() => api<{ suppliers: LocalSupplier[] }>('/suppliers'), [store?.id]);
  const [edit, setEdit] = useState<(typeof blank & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!edit) return;
    setBusy(true); setErr(null);
    try {
      const { id, ...body } = edit;
      if (id) await api(`/suppliers/${id}`, { method: 'PUT', body });
      else await api('/suppliers', { body });
      toast('success', id ? 'Supplier updated' : 'Supplier added');
      setEdit(null); void reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (s: LocalSupplier) => {
    if (!(await confirm({ title: `Delete ${s.name}?`, text: 'Only suppliers without products can be deleted. You can also mark them inactive.', danger: true, confirmLabel: 'Delete' }))) return;
    try { await api(`/suppliers/${s.id}`, { method: 'DELETE' }); toast('success', 'Deleted'); void reload(); } catch (e) { toast('error', (e as Error).message); }
  };
  const f = (k: keyof typeof blank) => ({ value: (edit?.[k] as string) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEdit({ ...edit!, [k]: e.target.value }) });

  return (
    <div>
      <PageHeader title="Local Suppliers" subtitle="Nairobi wholesalers you dropship from — fast delivery, local prices."
        actions={<>
          <Link to="/import?tab=local"><Button variant="secondary" icon={<PackagePlus className="h-4 w-4" />}>Add local product</Button></Link>
          {isAdmin && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ ...blank })}>Add supplier</Button>}
        </>} />
      <Notice>How it works: list a supplier's products in your shop → a customer pays by M-Pesa → open the order in <b>Supplier Orders</b> and tap <b>WhatsApp supplier</b> → a rider collects, or the supplier delivers → add the rider or parcel number as tracking.</Notice>

      <div className="mt-4">
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data && <div className="grid gap-3 md:grid-cols-2">{[1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>}
        {data && data.suppliers.length === 0 && (
          <Empty title="No local suppliers yet" text="Add the wholesalers you work with (e.g. in Eastleigh, Kamukunji, Luthuli Avenue) with their WhatsApp number."
            action={isAdmin && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ ...blank })}>Add your first supplier</Button>} />
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {data?.suppliers.map((s) => (
            <Card key={s.id} title={<span className="flex items-center gap-2"><Store className="h-4 w-4" />{s.name} {!s.active && <Badge tone="red">inactive</Badge>}</span>}
              actions={isAdmin && <>
                <Button size="sm" variant="ghost" aria-label="Edit" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit({ ...blank, ...s })} />
                <Button size="sm" variant="ghost" aria-label="Delete" icon={<Trash2 className="h-3.5 w-3.5 text-red-600" />} onClick={() => remove(s)} />
              </>}>
              <div className="space-y-1 text-sm">
                <div>{s.contactPerson && <b>{s.contactPerson} · </b>}{prettyPhone(s.phone)}</div>
                {s.location && <div className="flex items-start gap-1 text-slate-600 dark:text-slate-400"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{s.location}</div>}
                {s.paymentTerms && <div><span className="text-slate-500">Payment:</span> {s.paymentTerms}</div>}
                {s.deliveryNote && <div><span className="text-slate-500">Pickup/delivery:</span> {s.deliveryNote}</div>}
                {s.notes && <div className="text-slate-500">{s.notes}</div>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={whatsappLink(s.phone)} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary" icon={<MessageCircle className="h-3.5 w-3.5 text-emerald-600" />}>WhatsApp</Button></a>
                <Link to={`/import?tab=local&supplier=${s.id}`}><Button size="sm" variant="secondary" icon={<PackagePlus className="h-3.5 w-3.5" />}>Add product</Button></Link>
                <Badge tone="blue">{s.productCount || 0} products</Badge>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Drawer open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Edit supplier' : 'Add supplier'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save supplier</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Business / shop name *"><input className="input" {...f('name')} placeholder="e.g. Eastleigh Gadgets Wholesale" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contact person"><input className="input" {...f('contactPerson')} placeholder="e.g. Hassan" /></Field>
              <Field label="WhatsApp number *"><input className="input" type="tel" {...f('phone')} placeholder="0712 345 678" /></Field>
            </div>
            <Field label="Location (for riders)"><input className="input" {...f('location')} placeholder="e.g. Eastleigh 1st Ave, Garissa Lodge, Shop B12" /></Field>
            <Field label="Payment terms"><input className="input" {...f('paymentTerms')} placeholder="e.g. Pay on pickup via M-Pesa till 123456" /></Field>
            <Field label="Pickup / delivery arrangement"><input className="input" {...f('deliveryNote')} placeholder="e.g. Rider collects 9am–5pm Mon–Sat; supplier delivers in CBD" /></Field>
            <Field label="Notes"><textarea className="input h-20" {...f('notes')} placeholder="Agreed prices, return policy, best products…" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            {err && <ErrorBox error={err} />}
          </div>
        )}
      </Drawer>
    </div>
  );
}
