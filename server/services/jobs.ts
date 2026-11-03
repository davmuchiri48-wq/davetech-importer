import cron from 'node-cron';
import { col, nowIso } from '../firebase.js';
import { aliexpress } from '../aliexpress/adapter.js';
import { HttpError } from '../http.js';
import type { ImportJob, SupplierSnapshot } from '../../shared/types.js';
import { createProductFromSnapshot, findDuplicate, applySupplierUpdate } from './products.js';
import { getSettings } from './settings.js';
import { notify } from '../audit.js';

/**
 * Background import queue. Jobs live in Firestore `importJobs`, so the dashboard can show
 * progress and nothing is lost if the server restarts (queued jobs are picked up again).
 */
let running = false;

export async function enqueueImport(storeId: string, uid: string, source: ImportJob['source'], supplierProductId: string, input: Record<string, unknown>) {
  const dup = await findDuplicate(storeId, supplierProductId);
  const ref = col.importJobs().doc();
  const job: Omit<ImportJob, 'id'> = {
    storeId, source, supplierProductId, input, createdBy: uid, createdAt: nowIso(),
    status: dup ? 'duplicate' : 'queued', productId: dup, error: dup ? 'Already imported' : null, finishedAt: dup ? nowIso() : null,
  };
  await ref.set(job);
  if (!dup) void drain();
  return { id: ref.id, ...job };
}

export async function drain() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const q = await col.importJobs().where('status', 'in', ['queued', 'running']).orderBy('createdAt').limit(5).get();
      if (q.empty) break;
      for (const d of q.docs) await runJob(d.id, d.data() as ImportJob);
    }
  } catch (e) {
    console.error('[queue]', e);
  } finally {
    running = false;
  }
}

async function runJob(id: string, job: ImportJob) {
  const ref = col.importJobs().doc(id);
  await ref.update({ status: 'running' });
  try {
    let snapshot: SupplierSnapshot;
    if (job.source === 'aliexpress_api') {
      const r = await aliexpress.getProductDetails(job.storeId, job.supplierProductId);
      if (!r.ok) throw new HttpError(400, `${r.message}${r.manualWorkflow ? ` — ${r.manualWorkflow}` : ''}`);
      snapshot = r.data;
      const ship = await aliexpress.calculateShipping(job.storeId, job.supplierProductId, snapshot.variants[0]?.sku || '');
      if (ship.ok && ship.data.cost != null) snapshot.shipping = ship.data.cost;
    } else {
      snapshot = job.input.snapshot as SupplierSnapshot;
    }
    const product = await createProductFromSnapshot(job.storeId, snapshot, (job.input.edits || {}) as any);
    await ref.update({ status: 'done', productId: product.id, finishedAt: nowIso(), error: null });
  } catch (e) {
    const err = e as HttpError;
    const duplicate = err.code === 'duplicate';
    await ref.update({
      status: duplicate ? 'duplicate' : 'failed', error: err.message,
      productId: duplicate ? (err.details as any)?.productId ?? null : null, finishedAt: nowIso(),
    });
  }
}

/** Checks every non-archived AliExpress-API product of a store against the supplier. */
export async function syncStore(storeId: string, onlyIds?: string[]) {
  const settings = await getSettings(storeId);
  let docs = (await col.products().where('storeId', '==', storeId).get()).docs.filter((d) => d.data().status !== 'archived');
  if (onlyIds?.length) docs = docs.filter((d) => onlyIds.includes(d.id));
  const summary = { checked: 0, changed: 0, unavailable: 0, failed: 0, skippedManual: 0, errors: [] as string[] };
  for (const d of docs) {
    const p = d.data();
    if (p.supplier?.source !== 'aliexpress_api') { summary.skippedManual++; continue; }
    summary.checked++;
    const r = await aliexpress.getProductDetails(storeId, p.supplierProductId);
    if (!r.ok) {
      summary.failed++;
      summary.errors.push(`${p.name}: ${r.message}`);
      await d.ref.update({ syncError: r.message, lastSyncedAt: nowIso() });
      await col.syncJobs().add({ storeId, productId: d.id, at: nowIso(), result: 'failed', error: r.message });
      if (r.reason === 'not_configured' || r.reason === 'not_authorized' || r.reason === 'unsupported') break; // all others would fail the same way
      continue;
    }
    const res = await applySupplierUpdate(storeId, d.id, r.data, settings.sync);
    if (res.changes.length) summary.changed++;
    if (res.availability === 'unavailable') summary.unavailable++;
  }
  if (summary.failed) await notify(storeId, 'error', 'Synchronization errors', `${summary.failed} product(s) could not be checked. ${summary.errors[0] || ''}`, '/sync');
  return summary;
}

/** Hourly tick: runs sync for stores whose schedule is due. */
export function startScheduler() {
  cron.schedule('7 * * * *', async () => {
    const stores = await col.stores().get();
    for (const s of stores.docs) {
      const settings = await getSettings(s.id);
      if (!settings.sync.enabled) continue;
      const last = s.data().lastAutoSyncAt ? Date.parse(s.data().lastAutoSyncAt) : 0;
      if (Date.now() - last < settings.sync.everyHours * 3600e3 - 60e3) continue;
      await s.ref.update({ lastAutoSyncAt: nowIso() });
      await syncStore(s.id).catch((e) => console.error('[sync]', s.id, e));
    }
  });
  void drain();
}
