// Tiny HTTP toolkit: router, JSON bodies, cookies, sessions, rate limits, errors. No dependencies.
import { randomBytes, createHash, scryptSync, timingSafeEqual, randomInt } from 'node:crypto';
import { config } from './config.js';
import { get, run, tx } from './db.js';

export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
export const bad = (msg, extra) => new HttpError(400, msg, extra);

export const newId = (prefix = '') => prefix + randomBytes(9).toString('base64url');
export const sha256 = s => createHash('sha256').update(String(s)).digest('hex');
export const sixDigits = () => String(randomInt(0, 1000000)).padStart(6, '0');
export function hashPassword(pw) { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(pw, salt, 64).toString('hex'); }
export function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':'); if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex'); const b = scryptSync(String(pw), salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function safeEqual(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }

/* ---------- router ---------- */
export function router() {
  const routes = [];
  const add = (method, path, ...handlers) => {
    const keys = []; const rx = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, rx, keys, handlers });
  };
  const api = { routes, get: (p, ...h) => add('GET', p, ...h), post: (p, ...h) => add('POST', p, ...h), put: (p, ...h) => add('PUT', p, ...h), del: (p, ...h) => add('DELETE', p, ...h) };
  api.match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.rx); if (!m) continue;
      const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handlers: r.handlers, params };
    }
    return null;
  };
  return api;
}

/* ---------- request helpers ---------- */
export function clientIp(req) {
  if (config.trustProxy) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
  return req.socket.remoteAddress || '';
}
export function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
export async function jsonBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try { const v = JSON.parse(raw.toString('utf8')); return v && typeof v === 'object' ? v : {}; } catch { throw bad('Invalid JSON'); }
}
export function parseCookies(req) {
  const out = {}; const h = req.headers.cookie; if (!h) return out;
  for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
export function setCookie(res, name, value, { maxAge, path = '/' } = {}) {
  const secure = config.publicUrl.startsWith('https://');
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  const prev = res.getHeader('Set-Cookie'); const list = prev ? [].concat(prev) : [];
  list.push(parts.join('; ')); res.setHeader('Set-Cookie', list);
}
export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/* ---------- sessions (random token in an HttpOnly cookie; only its hash is stored) ---------- */
export const COOKIE = { participant: 'go_sess', admin: 'go_admin', pending: 'go_pending' };
export function createSession(res, kind, subject, seconds) {
  const token = randomBytes(32).toString('base64url');
  run('INSERT INTO sessions (token_hash, kind, subject, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', sha256(token), kind, subject, Date.now() + seconds * 1000, Date.now());
  setCookie(res, COOKIE[kind], token, { maxAge: seconds, path: kind === 'admin' ? '/' : '/' });
  return token;
}
export function readSession(req, kind) {
  const token = parseCookies(req)[COOKIE[kind]]; if (!token) return null;
  const s = get('SELECT * FROM sessions WHERE token_hash = ? AND kind = ?', sha256(token), kind);
  if (!s || s.expires_at < Date.now()) return null;
  return s;
}
export function endSession(req, res, kind) {
  const token = parseCookies(req)[COOKIE[kind]];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  setCookie(res, COOKIE[kind], '', { maxAge: 0 });
}

/* ---------- rate limits (fixed window, stored in the database so they survive restarts) ---------- */
export function rateLimit(key, max, windowSec) {
  const now = Date.now();
  const ok = tx(() => {
    const r = get('SELECT count, reset_at FROM rate_limits WHERE key = ?', key);
    if (!r || r.reset_at < now) { run('INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at', key, now + windowSec * 1000); return true; }
    if (r.count >= max) return false;
    run('UPDATE rate_limits SET count = count + 1 WHERE key = ?', key); return true;
  });
  if (!ok) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.', { code: 'rate_limited' });
}
