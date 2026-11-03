import { auth } from './firebase';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) { super(message); }
}

let currentStoreId = localStorage.getItem('storeId') || '';
export const setStoreId = (id: string) => { currentStoreId = id; localStorage.setItem('storeId', id); };
export const getStoreId = () => currentStoreId;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await auth?.currentUser?.getIdToken();
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(currentStoreId ? { 'X-Store-Id': currentStoreId } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.details) ? ` (${data.details.map((d: any) => `${d.path}: ${d.message}`).join('; ')})` : '';
    throw new ApiError(res.status, (data.error || `Request failed (${res.status})`) + detail, data.code, data.details);
  }
  return data as T;
}
