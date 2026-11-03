import { col, nowIso } from './firebase.js';

export async function audit(uid: string, storeId: string | null, action: string, target: string, details: Record<string, unknown> = {}) {
  try {
    await col.auditLogs().add({ uid, storeId, action, target, details, at: nowIso() });
  } catch (e) {
    console.error('[audit] failed', e);
  }
}

export async function notify(storeId: string, level: 'info' | 'warning' | 'error', title: string, body: string, link?: string) {
  await col.notifications().add({ storeId, level, title, body, link: link || null, read: false, at: nowIso() });
}
