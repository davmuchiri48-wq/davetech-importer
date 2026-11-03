import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { auth, col, nowIso } from './firebase.js';
import { config } from './config.js';
import type { AppUser, Role } from '../shared/types.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: unknown) {
    super(message);
  }
}

export interface AuthedRequest extends Request {
  params: Record<string, string>;
  user: AppUser;
  storeId: string;
}

/** Wraps async handlers so thrown errors reach the error middleware. */
export const h = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req as AuthedRequest, res).catch(next); };

/** Verifies the Firebase ID token and loads the user's role from Firestore (never from the browser). */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'Sign in required', 'unauthenticated');
    const decoded = await auth.verifyIdToken(token, true).catch(() => {
      throw new HttpError(401, 'Your session has expired. Please sign in again.', 'unauthenticated');
    });
    const email = (decoded.email || '').toLowerCase();
    const ref = col.users().doc(decoded.uid);
    let snap = await ref.get();

    if (!snap.exists) {
      // First login: admins listed in ADMIN_EMAILS, or people an admin invited.
      const invite = email ? await col.invites().doc(email).get() : null;
      if (config.adminEmails.includes(email)) {
        const stores = await col.stores().get();
        await ref.set({ uid: decoded.uid, email, role: 'admin', storeIds: stores.docs.map((d) => d.id), createdAt: nowIso() });
      } else if (invite?.exists) {
        const inv = invite.data()!;
        await ref.set({ uid: decoded.uid, email, role: inv.role, storeIds: inv.storeIds || [], createdAt: nowIso() });
        await invite.ref.delete();
      } else {
        throw new HttpError(403, 'This account has not been given access. Ask an administrator to invite you.', 'forbidden');
      }
      snap = await ref.get();
    }
    const user = snap.data() as AppUser;
    if (user.disabled) throw new HttpError(403, 'This account is disabled', 'forbidden');
    (req as AuthedRequest).user = { ...user, uid: decoded.uid };
    next();
  } catch (e) { next(e); }
};

export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  const user = (req as AuthedRequest).user;
  if (!user || !roles.includes(user.role)) return next(new HttpError(403, 'You do not have permission for this action', 'forbidden'));
  next();
};

/** Every store-scoped route reads the store from the X-Store-Id header and checks membership. */
export const requireStore: RequestHandler = (req, _res, next) => {
  const r = req as AuthedRequest;
  const storeId = String(req.headers['x-store-id'] || '');
  if (!storeId) return next(new HttpError(400, 'No store selected', 'no_store'));
  if (!r.user.storeIds?.includes(storeId)) return next(new HttpError(403, 'You do not have access to this store', 'forbidden'));
  r.storeId = storeId;
  next();
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Some fields are invalid', code: 'validation', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server', code: 'server_error' });
}
