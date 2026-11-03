/** All configuration comes from environment variables. Nothing secret is hardcoded. */
const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  nodeEnv: env.NODE_ENV || 'development',
  // Firebase Admin: paste the whole service-account JSON into FIREBASE_SERVICE_ACCOUNT (one line),
  // or base64-encode it into FIREBASE_SERVICE_ACCOUNT_B64.
  firebaseServiceAccount: env.FIREBASE_SERVICE_ACCOUNT || (env.FIREBASE_SERVICE_ACCOUNT_B64
    ? Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8') : ''),
  // Comma-separated emails that become admins on first login.
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // 32+ character random string used to encrypt store API keys and AliExpress tokens at rest.
  encryptionKey: env.ENCRYPTION_KEY || '',
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  aliexpress: {
    appKey: env.ALIEXPRESS_APP_KEY || '',
    appSecret: env.ALIEXPRESS_APP_SECRET || '',
    gateway: (env.ALIEXPRESS_GATEWAY || 'https://api-sg.aliexpress.com').replace(/\/$/, ''),
    // Shipping destination used for freight queries.
    shipTo: env.ALIEXPRESS_SHIP_TO || 'KE',
    targetCurrency: env.ALIEXPRESS_TARGET_CURRENCY || 'USD',
    targetLanguage: env.ALIEXPRESS_TARGET_LANGUAGE || 'EN',
  },
  cronEnabled: env.CRON_ENABLED !== '0',
};

export const aliexpressConfigured = () => Boolean(config.aliexpress.appKey && config.aliexpress.appSecret);

export function assertProductionConfig() {
  const missing: string[] = [];
  if (!config.firebaseServiceAccount) missing.push('FIREBASE_SERVICE_ACCOUNT');
  if (config.encryptionKey.length < 32) missing.push('ENCRYPTION_KEY (32+ chars)');
  if (!config.adminEmails.length) missing.push('ADMIN_EMAILS');
  if (missing.length) {
    console.error(`\n[config] Missing required environment variables: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}
