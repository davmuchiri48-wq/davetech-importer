import crypto from 'node:crypto';
import { config } from './config.js';

/** AES-256-GCM encryption for secrets stored in Firestore (store API keys, AliExpress tokens). */
function key() {
  if (config.encryptionKey.length < 32) throw new Error('ENCRYPTION_KEY is not set (needs 32+ characters)');
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(token: string): string {
  const [iv, tag, data] = token.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
