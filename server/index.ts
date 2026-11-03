import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, assertProductionConfig } from './config.js';

assertProductionConfig();

const { api } = await import('./routes/api.js');
const { errorHandler } = await import('./http.js');
const { startScheduler } = await import('./services/jobs.js');

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': ["'self'", 'data:', 'https:'],
      'connect-src': ["'self'", 'https://*.googleapis.com', 'https://*.firebaseio.com', 'https://securetoken.googleapis.com', 'https://identitytoolkit.googleapis.com'],
      'frame-src': ["'self'", 'https://*.firebaseapp.com'],
      'script-src': ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.get('/healthz', (_req, res) => { res.json({ ok: true }); });
app.use('/api', api);
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });
app.use(errorHandler);

// Serve the built dashboard
const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = [path.resolve(here, '../../web'), path.resolve(here, '../dist/web'), path.resolve(process.cwd(), 'dist/web')]
  .find((d) => fs.existsSync(path.join(d, 'index.html')));
if (webDir) {
  app.use(express.static(webDir, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => { res.sendFile(path.join(webDir, 'index.html')); });
}

app.listen(config.port, () => {
  console.log(`Davetech Importer listening on :${config.port}${webDir ? '' : ' (dashboard not built — run npm run build)'}`);
  if (config.cronEnabled) startScheduler();
});
