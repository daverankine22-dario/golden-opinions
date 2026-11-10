// Golden Opinions server: serves the participant app, the admin console and the JSON API.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { router, HttpError, sendJson, readBody, safeEqual } from './http.js';
import { participantRoutes, webhookRoutes } from './participant.js';
import { adminRoutes, runReminderJob } from './admin.js';
import { processOutbox } from './messaging.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const ADMIN = join(ROOT, 'admin');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
if (config.publicUrl.startsWith('https://')) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';

function verifyTwilio(req, params) {
  if (!config.twilio.token) return !config.production; // allow in local test mode only
  const sig = req.headers['x-twilio-signature']; if (!sig) return false;
  const url = config.publicUrl + req.url;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expected = createHmac('sha1', config.twilio.token).update(data).digest('base64');
  return safeEqual(sig, expected);
}

export function buildApp() {
  openDb();
  const r = router();
  participantRoutes(r);
  adminRoutes(r);
  webhookRoutes(r, { verifyTwilio });
  r.get('/healthz', async (req, res) => sendJson(res, 200, { ok: true }));

  const isAdminHost = req => !config.adminHost || String(req.headers.host || '').toLowerCase().split(':')[0] === config.adminHost;

  async function serveFile(res, file, cache) {
    try {
      const st = await stat(file); if (!st.isFile()) return false;
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': cache || 'no-cache', 'Content-Length': body.length });
      res.end(body); return true;
    } catch { return false; }
  }

  return async function handler(req, res) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://x'); const path = url.pathname;
    try {
      // API
      if (path.startsWith('/api/') || path.startsWith('/u/') || path === '/healthz') {
        if (path.startsWith('/api/admin') && !isAdminHost(req)) throw new HttpError(404, 'Not found');
        const m = r.match(req.method, path);
        if (!m) throw new HttpError(404, 'Not found');
        const ctx = { params: m.params, query: url.searchParams };
        if (path === '/api/webhooks/twilio') ctx.form = Object.fromEntries(new URLSearchParams((await readBody(req)).toString('utf8')));
        else if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Forbidden'); // CSRF guard: only our own pages send this header
        for (const h of m.handlers) await h(req, res, ctx);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      // Admin console
      if (path === '/admin' || path.startsWith('/admin/')) {
        if (!isAdminHost(req)) throw new HttpError(404, 'Not found');
        const rel = normalize(path.replace(/^\/admin\/?/, '') || 'index.html');
        if (rel.startsWith('..')) throw new HttpError(404, 'Not found');
        if (await serveFile(res, join(ADMIN, rel))) return;
        if (await serveFile(res, join(ADMIN, 'index.html'))) return;
      }
      if (config.adminHost && isAdminHost(req) && path === '/') { res.writeHead(302, { Location: '/admin' }); res.end(); return; }
      // Participant app + static assets
      const rel = normalize(path === '/' ? 'index.html' : path.slice(1));
      if (rel.startsWith('..')) throw new HttpError(404, 'Not found');
      const longCache = /^(img|css|js)\//.test(rel) ? 'public, max-age=3600' : undefined;
      if (await serveFile(res, join(PUBLIC, rel), longCache)) return;
      if (!extname(rel) && await serveFile(res, join(PUBLIC, 'index.html'))) return; // app routes
      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (res.headersSent) { res.end(); return; }
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...(err.extra || {}) });
      if (String(err && err.message).includes('UNIQUE constraint failed: responses')) return sendJson(res, 409, { error: 'This email address or phone number has already completed this survey. Each person can enter once.', code: 'already' });
      console.error('[error]', req.method, path, err);
      sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  };
}

// Start when run directly (not when imported by tests)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const handler = buildApp();
  const server = createServer(handler);
  server.listen(config.port, () => {
    console.log(`Golden Opinions running on ${config.publicUrl} (port ${config.port})`);
    console.log(`  Texts: ${config.smsEnabled ? 'Twilio' : 'TEST MODE (logged only)'} · Email: ${config.emailEnabled ? 'Postmark' : 'TEST MODE (logged only)'}`);
  });
  const tick = () => { try { runReminderJob(); } catch (e) { console.error('[job]', e); } processOutbox().catch(e => console.error('[outbox]', e)); };
  setTimeout(tick, 5000); setInterval(tick, 15 * 60 * 1000);
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
