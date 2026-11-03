import crypto from 'node:crypto';
import { config, aliexpressConfigured } from '../config.js';
import { col, nowIso } from '../firebase.js';
import { encrypt, decrypt } from '../crypto.js';

/**
 * Low-level AliExpress Open Platform client.
 *  - Business APIs:  POST {gateway}/sync   with `method=<api name>`
 *  - System APIs:    POST {gateway}/rest{path}  (e.g. /auth/token/create)
 * Signature: sort params by name, join name+value, HMAC-SHA256 with the App Secret,
 * upper-case hex. System APIs prefix the path to the string being signed.
 */

export type AeFailure = {
  ok: false;
  reason: 'not_configured' | 'not_authorized' | 'unsupported' | 'api_error' | 'rate_limited';
  message: string;
  apiMethod?: string;
  raw?: unknown;
};
export type AeResult<T> = { ok: true; data: T; apiMethod?: string } | AeFailure;

export function sign(params: Record<string, string>, secret: string, apiPath = ''): string {
  const base = apiPath + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex').toUpperCase();
}

// Simple pacing so we never burst the API; retries with backoff for throttling and 5xx.
let lastCall = 0;
const MIN_GAP_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SYS_KEYS = new Set(['app_key', 'timestamp', 'sign_method', 'sign', 'method', 'session', 'access_token', 'simplify', 'format', 'partner_id']);

async function post(url: string, params: Record<string, string>): Promise<{ status: number; body: any }> {
  // Official IOP SDK layout: system parameters go in the URL, API parameters in the form body.
  const sys = new URLSearchParams(), api = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) (SYS_KEYS.has(k) ? sys : api).set(k, v);
  const fullUrl = `${url}?${sys.toString()}`;
  for (let attempt = 1; ; attempt++) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: api.toString(),
        signal: AbortSignal.timeout(25_000),
      });
      const text = await res.text();
      let body: any;
      try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
      const throttled = res.status === 429 || /ApiCallLimit|frequency|throttl/i.test(String(body?.code || body?.error_response?.code || ''));
      if ((throttled || res.status >= 500) && attempt < 4) { await sleep(800 * 2 ** attempt); continue; }
      return { status: res.status, body };
    } catch (e) {
      if (attempt < 3) { await sleep(800 * 2 ** attempt); continue; }
      throw e;
    }
  }
}

function baseParams(): Record<string, string> {
  return {
    app_key: config.aliexpress.appKey,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
  };
}

function extractError(body: any): string | null {
  const er = body?.error_response || (body?.code && body.code !== '0' && body?.message ? body : null);
  if (er) return `${er.code || ''} ${er.msg || er.message || ''} ${er.sub_msg || ''}`.trim();
  return null;
}

/** Call a business API (e.g. aliexpress.ds.product.get). */
export async function callApi(method: string, params: Record<string, unknown>, accessToken?: string): Promise<AeResult<any>> {
  if (!aliexpressConfigured()) {
    return { ok: false, reason: 'not_configured', apiMethod: method, message: 'AliExpress App Key and App Secret are not set on the server (ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET).' };
  }
  const p: Record<string, string> = { ...baseParams(), method };
  if (accessToken) p.session = accessToken;
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  p.sign = sign(p, config.aliexpress.appSecret);
  const { status, body } = await post(`${config.aliexpress.gateway}/sync`, p);
  const err = extractError(body);
  if (err || status >= 400) {
    const msg = err || `HTTP ${status}`;
    const reason = /permission|InsufficientPermission|isv\.|not.*authori|AppKey.*not|api.*not.*exist|InvalidApiPath/i.test(msg)
      ? 'unsupported' : /session|token|IllegalAccessToken/i.test(msg) ? 'not_authorized'
        : /limit|frequency/i.test(msg) ? 'rate_limited' : 'api_error';
    return { ok: false, reason, apiMethod: method, message: `AliExpress said: ${msg}`, raw: body };
  }
  return { ok: true, data: body, apiMethod: method };
}

/** Call a system API such as /auth/token/create. */
async function callSystem(path: string, params: Record<string, string>): Promise<AeResult<any>> {
  if (!aliexpressConfigured()) return { ok: false, reason: 'not_configured', message: 'AliExpress App Key/Secret not set.' };
  const p = { ...baseParams(), ...params };
  p.sign = sign(p, config.aliexpress.appSecret, path);
  const { status, body } = await post(`${config.aliexpress.gateway}/rest${path}`, p);
  const err = extractError(body);
  if (err || status >= 400 || !body?.access_token && path.includes('token')) {
    return { ok: false, reason: 'api_error', message: `AliExpress said: ${err || body?.message || `HTTP ${status}`}`, raw: body };
  }
  return { ok: true, data: body };
}

// ---------------------------------------------------------------- OAuth / tokens

export function authorizeUrl(state: string): string {
  const redirect = `${config.publicUrl}/api/integrations/aliexpress/callback`;
  const q = new URLSearchParams({ response_type: 'code', force_auth: 'true', redirect_uri: redirect, client_id: config.aliexpress.appKey, state });
  return `${config.aliexpress.gateway}/oauth/authorize?${q}`;
}

interface TokenDoc { accessToken: string; refreshToken: string; expiresAt: number; refreshExpiresAt: number; account: string; }

const tokenRef = (storeId: string) => col.secrets().doc(`${storeId}_aliexpress`);

async function saveToken(storeId: string, data: any) {
  const now = Date.now();
  const doc: TokenDoc = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: Number(data.expire_time) || now + Number(data.expires_in || 0) * 1000,
    refreshExpiresAt: Number(data.refresh_token_valid_time) || now + Number(data.refresh_expires_in || 0) * 1000,
    account: data.account || data.user_nick || '',
  };
  await tokenRef(storeId).set({ storeId, enc: encrypt(JSON.stringify(doc)), account: doc.account, expiresAt: doc.expiresAt, updatedAt: nowIso() });
  return doc;
}

export async function exchangeCode(storeId: string, code: string) {
  const r = await callSystem('/auth/token/create', { code });
  if (!r.ok) return r;
  const t = await saveToken(storeId, r.data);
  return { ok: true as const, data: { account: t.account, expiresAt: t.expiresAt } };
}

/** Returns a valid access token, refreshing it if it is about to expire. */
export async function getAccessToken(storeId: string): Promise<string | null> {
  const snap = await tokenRef(storeId).get();
  if (!snap.exists) return null;
  let t: TokenDoc = JSON.parse(decrypt(snap.data()!.enc));
  if (t.expiresAt - Date.now() < 10 * 60e3 && t.refreshToken && t.refreshExpiresAt > Date.now()) {
    const r = await callSystem('/auth/token/refresh', { refresh_token: t.refreshToken });
    if (r.ok) t = await saveToken(storeId, r.data);
  }
  return t.expiresAt > Date.now() ? t.accessToken : null;
}

export async function connectionInfo(storeId: string) {
  const snap = await tokenRef(storeId).get();
  return {
    appConfigured: aliexpressConfigured(),
    authorized: snap.exists && (snap.data()!.expiresAt || 0) > Date.now(),
    account: snap.data()?.account || null,
    expiresAt: snap.data()?.expiresAt || null,
    redirectUri: `${config.publicUrl}/api/integrations/aliexpress/callback`,
  };
}

export async function disconnect(storeId: string) { await tokenRef(storeId).delete(); }
