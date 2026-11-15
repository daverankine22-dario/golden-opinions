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

  const LEGAL_PAGES = { '/terms': ['terms', 'Terms and Conditions'], '/privacy': ['privacy', 'Privacy Policy'], '/rules': ['rules', 'Official Rules'] };
  LEGAL_PAGES['/official-rules'] = LEGAL_PAGES['/rules']; LEGAL_PAGES['/privacy-policy'] = LEGAL_PAGES['/privacy']; LEGAL_PAGES['/terms-and-conditions'] = LEGAL_PAGES['/terms'];
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
      // Legal documents as plain web pages (for Twilio / app-store registration, printing and linking)
      const doc = LEGAL_PAGES[path.replace(/\/$/, '')];
      if (doc) {
        const body = await readFile(join(PUBLIC, 'legal', doc[0] + '.html'), 'utf8');
        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${doc[1]} · Golden Opinions</title><link rel="icon" href="/img/icon-192.png">
<style>body{font:15px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1d2433;background:#f6f7fb;margin:0}main{max-width:820px;margin:0 auto;padding:28px 20px 60px;background:#fff;min-height:100vh}
header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #d4a52a;padding-bottom:14px;margin-bottom:6px}header img{height:44px}h1{font-size:24px;margin:0;color:#0b2a8a}
h2{font-size:18px;margin:26px 0 6px;color:#0b2a8a}.updated{color:#667;font-size:13px}table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 14px}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #e3e6ef}th{background:#f1f3f9}
.tscroll{overflow-x:auto}nav{margin-top:30px;font-size:14px;color:#667}a{color:#0b2a8a}@media print{body{background:#fff}main{padding:0}nav{display:none}}</style></head>
<body><main><header><img src="/img/logo.png" alt="Golden Opinions"><h1>${doc[1]}</h1></header>${body}
<nav>${Object.values(LEGAL_PAGES).filter((v, i, a) => a.indexOf(v) === i && v !== doc).map(v => `<a href="/${v[0]}">${v[1]}</a>`).join(' · ')} · <a href="/">Golden Opinions app</a></nav></main></body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : html); return;
      }
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
