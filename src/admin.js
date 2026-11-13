// Admin API (staff only). Log-in = email + password + a 6-digit code emailed to the staff member.
import { randomInt } from 'node:crypto';
import { config } from './config.js';
import { all, get, run, tx, rowParticipant, rowSurvey, rowResponse, rowWinner, saveSurvey, saveWinner, getSetting, setSetting, audit, parse } from './db.js';
import { HttpError, bad, newId, sha256, sixDigits, jsonBody, sendJson, createSession, readSession, endSession, rateLimit, clientIp, checkPassword, safeEqual } from './http.js';
import { T as MSG, queueEmail, queueSms, sendBoth } from './messaging.js';
import { WIN_CAP, CLAIM_DAYS, STATES, localDay, addDays, wStatus, surveyProblems, estValue, prizeLabel, prizePhrase, shortPrize, gbOf, noteParts, GB_OZ, winnersCountOf, fmtPhone, answerText, L } from '../public/js/shared.js';

const today = () => localDay(Date.now(), config.timeZone);
const dayRx = /^\d{4}-\d{2}-\d{2}$/;
const fmtDay = (d, lang) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

export function requireAdmin(req) {
  const s = readSession(req, 'admin'); const a = s && get('SELECT id, email, name FROM admins WHERE id = ?', s.subject);
  if (!a) throw new HttpError(401, 'Please log in.', { code: 'login_required' });
  return a;
}
const surveyById = id => rowSurvey(get('SELECT * FROM surveys WHERE id = ?', id));
const winnerById = id => rowWinner(get('SELECT * FROM winners WHERE id = ?', id));
const participantById = id => rowParticipant(get('SELECT * FROM participants WHERE id = ?', id));

/* $999 in any 12 consecutive months, measured by each prize's value on its drawing day */
export function wonLast12(pid, asOfDay = today(), exceptId = null) {
  const from = addDays(asOfDay, -365);
  const r = get(`SELECT COALESCE(SUM(est_value), 0) AS total FROM winners WHERE participant_id = ? AND status != 'forfeited' AND draw_date > ? AND draw_date <= ? AND id != ?`, pid, from, asOfDay, exceptId || '');
  return r.total;
}
function prizeFields(x) {
  const qty = Math.max(1, Math.min(50, parseInt(x.noteQty) || 1));
  const denom = Number(x.noteDenom) || (gbOf(x) / qty) || 0;
  const n = +(denom * qty).toFixed(3);
  return { noteDenom: denom, noteQty: qty, goldbacks: n, goldAmt: +(n * GB_OZ).toFixed(6), goldUnit: x.goldUnit === 'g' ? 'g' : 'oz' };
}
function notifyWinner(w, kind) {
  const p = participantById(w.participantId); if (!p) return;
  const s = surveyById(w.surveyId) || {}; const lang = p.lang === 'es' ? 'es' : 'en';
  const prize = shortPrize(w); const deadline = fmtDay(w.claimDeadline, lang);
  const tpl = kind === 'win' ? MSG.win(lang, { firstName: p.firstName, title: L(s, 'title', lang) || '', prize, est: w.estValue, deadline })
    : kind === 'reminder' ? MSG.reminder(lang, { firstName: p.firstName, prize, deadline })
    : MSG.shipped(lang, { firstName: p.firstName, prize, tracking: w.tracking });
  sendBoth(p, tpl, kind, { sms: !p.smsStopped });
}

export function adminRoutes(r) {
  /* ----- staff log-in ----- */
  r.post('/api/admin/login', async (req, res) => {
    const b = await jsonBody(req);
    rateLimit('admin-login:ip:' + clientIp(req), 10, 900);
    const a = get('SELECT * FROM admins WHERE email = ?', String(b.email || '').trim().toLowerCase());
    if (!a || !checkPassword(b.password || '', a.password_hash)) { audit(null, 'admin.login_failed', { email: b.email }); throw bad('Wrong email or password.'); }
    const id = newId('o_'); const code = sixDigits();
    run('INSERT INTO otps (id, purpose, code_hash, payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, 'admin', sha256(id + code), JSON.stringify({ adminId: a.id }), Date.now() + 10 * 60000, Date.now());
    createSession(res, 'pending', id, 15 * 60);
    queueEmail(a.email, `Golden Opinions admin code: ${code}`, `Your admin log-in code is ${code}. It expires in 10 minutes.`, `<p>Your admin log-in code is <b style="font-size:22px;letter-spacing:4px">${code}</b></p><p>It expires in 10 minutes. If this wasn't you, change your password.</p>`, 'code');
    sendJson(res, 200, { ok: true, devCode: (!config.emailEnabled && config.devShowCodes) ? code : undefined });
  });
  r.post('/api/admin/verify', async (req, res) => {
    const b = await jsonBody(req); const s = readSession(req, 'pending');
    const o = s && get("SELECT * FROM otps WHERE id = ? AND purpose = 'admin' AND consumed_at IS NULL", s.subject);
    if (!o || o.expires_at < Date.now()) throw bad('Your code has expired. Please log in again.');
    if (o.attempts >= 5) throw new HttpError(429, 'Too many wrong codes. Please log in again.');
    run('UPDATE otps SET attempts = attempts + 1 WHERE id = ?', o.id);
    if (!safeEqual(sha256(o.id + String(b.code || '').replace(/\D/g, '')), o.code_hash)) throw bad("That code doesn't match.");
    run('UPDATE otps SET consumed_at = ? WHERE id = ?', Date.now(), o.id);
    const { adminId } = JSON.parse(o.payload);
    endSession(req, res, 'pending');
    createSession(res, 'admin', adminId, config.adminSessionHours * 3600);
    audit(adminId, 'admin.login');
    sendJson(res, 200, { ok: true });
  });
  r.post('/api/admin/logout', async (req, res) => { endSession(req, res, 'admin'); sendJson(res, 200, { ok: true }); });
  r.get('/api/admin/me', async (req, res) => { const s = readSession(req, 'admin'); if (!s) return sendJson(res, 200, { admin: null }); sendJson(res, 200, { admin: requireAdmin(req), today: today(), smsEnabled: config.smsEnabled, emailEnabled: config.emailEnabled }); });

  /* ----- everything the console needs (fine for thousands of rows; add paging later if needed) ----- */
  r.get('/api/admin/data', async (req, res) => {
    requireAdmin(req);
    sendJson(res, 200, {
      today: today(),
      surveys: all('SELECT * FROM surveys ORDER BY created_at DESC').map(rowSurvey),
      participants: all('SELECT * FROM participants ORDER BY created_at DESC').map(rowParticipant),
      responses: all('SELECT * FROM responses').map(rowResponse),
      winners: all('SELECT * FROM winners ORDER BY draw_date DESC, created_at DESC').map(rowWinner),
      campaigns: all('SELECT * FROM campaigns ORDER BY sent_at DESC').map(c => ({ ...parse(c.data), id: c.id, sentAt: c.sent_at })),
      settings: { goldback: getSetting('goldback') },
      outbox: { queued: get("SELECT COUNT(*) n FROM outbox WHERE status = 'queued'").n, failed: get("SELECT COUNT(*) n FROM outbox WHERE status = 'failed'").n },
      smsEnabled: config.smsEnabled, emailEnabled: config.emailEnabled,
    });
  });

  /* ----- surveys ----- */
  r.put('/api/admin/surveys/:id', async (req, res, { params }) => {
    const a = requireAdmin(req); const b = await jsonBody(req); const s = b.survey || {};
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(params.id)) throw bad('Invalid survey id');
    const prev = surveyById(params.id);
    const clean = { ...s, id: params.id, status: ['draft', 'live', 'closed'].includes(s.status) ? s.status : 'draft', winnersCount: winnersCountOf(s), ...prizeFields(s), createdAt: prev ? prev.createdAt : Date.now() };
    delete clean.updatedAt;
    clean.prize = prizeLabel(clean);
    for (const k of ['endsAt', 'drawDate']) if (clean[k] && !dayRx.test(clean[k])) clean[k] = '';
    const errs = surveyProblems(clean);
    if (errs.length) throw bad(errs[0], { problems: errs });
    saveSurvey(clean);
    audit(a.id, prev ? 'survey.update' : 'survey.create', { id: params.id, status: clean.status });
    sendJson(res, 200, { ok: true, survey: surveyById(params.id) });
  });
  r.del('/api/admin/surveys/:id', async (req, res, { params }) => {
    const a = requireAdmin(req);
    if (get('SELECT 1 FROM winners WHERE survey_id = ? LIMIT 1', params.id)) throw bad('This survey has winners, so it can’t be deleted. Close it instead.');
    run('DELETE FROM surveys WHERE id = ?', params.id); audit(a.id, 'survey.delete', { id: params.id });
    sendJson(res, 200, { ok: true });
  });
  r.get('/api/admin/surveys/:id/export.csv', async (req, res, { params }) => {
    const a = requireAdmin(req); const s = surveyById(params.id); if (!s) throw new HttpError(404, 'Survey not found');
    const rs = all("SELECT * FROM responses WHERE survey_id = ? AND status = 'submitted' ORDER BY submitted_at", s.id).map(rowResponse);
    const qs = s.questions || [];
    const cell = v => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const rows = [['Entry', 'Email', 'Phone', 'Language', 'Submitted', ...qs.map(q => q.text)].map(cell).join(',')];
    for (const x of rs) rows.push([x.entryNo, x.email, fmtPhone(x.phone), x.lang || 'en', new Date(x.submittedAt).toISOString(), ...qs.map(q => answerText(q, x.answers[q.id]))].map(cell).join(','));
    audit(a.id, 'survey.export', { id: s.id, rows: rs.length });
    const name = (s.title || 'survey').replace(/[^\w-]+/g, '-').slice(0, 50);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-responses.csv"`, 'Cache-Control': 'no-store' });
    res.end('﻿' + rows.join('\r\n'));
  });

  /* ----- Gold Note exchange rate (per 1/1000 oz) ----- */
  r.put('/api/admin/settings/goldback', async (req, res) => {
    const a = requireAdmin(req); const b = await jsonBody(req); const v = Number(b.rate);
    if (!(v > 0 && v < 10000)) throw bad('Enter the rate for a 1/1000 oz Gold Note');
    const old = getSetting('goldback') || {};
    setSetting('goldback', { rate: +v.toFixed(2), updatedAt: Date.now(), history: [...(old.history || []), { rate: +v.toFixed(2), at: Date.now(), by: a.email }].slice(-120) });
    audit(a.id, 'settings.goldback', { rate: v });
    sendJson(res, 200, { ok: true });
  });

  /* ----- draws (random selection happens here, on the server, and is logged) ----- */
  r.post('/api/admin/surveys/:id/draw', async (req, res, { params }) => {
    const a = requireAdmin(req); const b = await jsonBody(req);
    const date = dayRx.test(b.date || '') ? b.date : today();
    const deadline = dayRx.test(b.claimDeadline || '') ? b.claimDeadline : addDays(today(), CLAIM_DAYS);
    const rate = Number(b.gbRate) || (getSetting('goldback') || {}).rate;
    if (!(rate > 0)) throw bad(`Set the Gold Note rate first: the draw checks the $${WIN_CAP} limit per person over 12 months.`, { code: 'no_rate' });
    const result = tx(() => {
      const s = surveyById(params.id); if (!s) throw new HttpError(404, 'Survey not found');
      const prizeVal = estValue(s, rate);
      if (prizeVal > WIN_CAP) throw bad(`Each prize is worth about $${prizeVal.toFixed(2)} at this rate — more than the $${WIN_CAP} a person can win in 12 months. Use a smaller prize per winner.`, { code: 'over_cap' });
      const existing = all('SELECT * FROM winners WHERE survey_id = ?', s.id).map(rowWinner);
      const need = Math.min(winnersCountOf(s) - existing.filter(w => w.status !== 'forfeited').length, Math.max(1, parseInt(b.count) || 999));
      if (need <= 0) throw bad(`All ${winnersCountOf(s)} winners have been drawn.`, { code: 'full' });
      const already = new Set(existing.map(w => w.responseId));
      const notWon = all("SELECT * FROM responses WHERE survey_id = ? AND status = 'submitted'", s.id).map(rowResponse).filter(x => !already.has(x.id) && participantById(x.participantId));
      const pool = notWon.filter(x => wonLast12(x.participantId, date) + prizeVal <= WIN_CAP);
      const capped = notWon.length - pool.length;
      if (!pool.length) throw bad(notWon.length ? `No eligible entries — ${capped} skipped by the $${WIN_CAP} / 12-month limit.` : 'There are no remaining entries to draw from.', { code: 'empty' });
      for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; } // cryptographic shuffle
      const picks = pool.slice(0, need); const saved = [];
      for (const x of picks) {
        const p = participantById(x.participantId);
        const w = { id: newId('w_'), surveyId: s.id, responseId: x.id, participantId: p.id, status: 'notified', date, ...prizeFields(s),
          firstName: p.firstName, lastInitial: (p.lastName || '').slice(0, 1).toUpperCase(), state: p.state, fullName: `${p.firstName} ${p.lastName}`,
          contact: `${p.email} · ${fmtPhone(p.phone)} · Entry #${x.entryNo}`, gbRate: rate, estValue: prizeVal, claimDeadline: deadline, notifiedAt: Date.now(), log: [{ at: Date.now(), kind: 'won' }] };
        w.prize = prizeLabel(w); saveWinner(w); saved.push(w);
      }
      audit(a.id, 'draw', { surveyId: s.id, poolSize: pool.length, capped, need, picks: saved.map(w => w.responseId), rate, date });
      return { saved, poolSize: pool.length, capped, need };
    });
    for (const w of result.saved) notifyWinner(w, 'win');
    sendJson(res, 200, { ok: true, winners: result.saved, poolSize: result.poolSize, capped: result.capped, requested: result.need });
  });

  /* ----- winners ----- */
  r.post('/api/admin/winners', async (req, res) => { // manual entry (e.g. a mail-in winner)
    const a = requireAdmin(req); const b = await jsonBody(req);
    const w = winnerFromBody({ id: newId('w_'), status: 'claimed', consentPublish: true, log: [] }, b);
    saveWinner(w); audit(a.id, 'winner.manual_add', { id: w.id });
    sendJson(res, 200, { ok: true, winner: winnerById(w.id) });
  });
  r.put('/api/admin/winners/:id', async (req, res, { params }) => {
    const a = requireAdmin(req); const b = await jsonBody(req); const prev = winnerById(params.id); if (!prev) throw new HttpError(404, 'Winner not found');
    const w = winnerFromBody({ ...prev }, b);
    if (w.participantId && w.status !== 'forfeited') {
      const other = wonLast12(w.participantId, w.date, w.id);
      if (other + w.estValue > WIN_CAP) throw bad(`Over the $${WIN_CAP} limit: this person has won $${other.toFixed(2)} in the last 12 months, so a $${w.estValue.toFixed(2)} prize can't be awarded.`);
    }
    saveWinner(w); audit(a.id, 'winner.update', { id: w.id });
    sendJson(res, 200, { ok: true, winner: winnerById(w.id) });
  });
  r.del('/api/admin/winners/:id', async (req, res, { params }) => {
    const a = requireAdmin(req); const w = winnerById(params.id); if (!w) throw new HttpError(404, 'Winner not found');
    run('DELETE FROM winners WHERE id = ?', w.id); audit(a.id, 'winner.delete', { id: w.id, participantId: w.participantId, surveyId: w.surveyId });
    sendJson(res, 200, { ok: true });
  });
  r.post('/api/admin/winners/:id/remind', async (req, res, { params }) => {
    const a = requireAdmin(req); const w = winnerById(params.id); if (!w || wStatus(w, today()) !== 'notified') throw bad('Only winners awaiting a claim can be reminded.');
    saveWinner({ ...w, log: [...(w.log || []), { at: Date.now(), kind: 'reminder', by: a.email }] }); notifyWinner(w, 'reminder');
    audit(a.id, 'winner.remind', { id: w.id }); sendJson(res, 200, { ok: true });
  });
  r.post('/api/admin/winners/:id/ship', async (req, res, { params }) => {
    const a = requireAdmin(req); const b = await jsonBody(req); const w = winnerById(params.id);
    if (!w || w.status !== 'claimed') throw bad('Only claimed prizes can be marked shipped.');
    const nw = { ...w, status: 'shipped', shippedAt: Date.now(), tracking: String(b.tracking || '').trim().slice(0, 80), log: [...(w.log || []), { at: Date.now(), kind: 'shipped' }] };
    saveWinner(nw); notifyWinner(nw, 'shipped'); audit(a.id, 'winner.ship', { id: w.id });
    sendJson(res, 200, { ok: true });
  });
  r.post('/api/admin/winners/:id/forfeit', async (req, res, { params }) => {
    const a = requireAdmin(req); const w = winnerById(params.id);
    if (!w || wStatus(w, today()) !== 'expired') throw bad('Only prizes past their claim deadline can be forfeited.');
    saveWinner({ ...w, status: 'forfeited', log: [...(w.log || []), { at: Date.now(), kind: 'forfeited', by: a.email }] }); audit(a.id, 'winner.forfeit', { id: w.id });
    sendJson(res, 200, { ok: true, surveyId: w.surveyId });
  });

  /* ----- campaigns: announce a live survey to opted-in participants ----- */
  r.post('/api/admin/campaigns', async (req, res) => {
    const a = requireAdmin(req); const b = await jsonBody(req);
    const s = surveyById(b.surveyId); if (!s || s.status !== 'live') throw bad('Choose a live survey to promote.');
    if (!b.sms && !b.email) throw bad('Choose text, email or both.');
    rateLimit('campaign:' + a.id, 10, 3600);
    const title = String(b.title || '').trim().slice(0, 120) || 'New survey — win gold!';
    const defaultMsg = lang => lang === 'es' ? `Hay una nueva encuesta de Golden Opinions: "${L(s, 'title', 'es')}". Responde unas preguntas y participa para ganar ${prizePhrase(s, 'es')}.` : `A new Golden Opinions survey is live: "${s.title}". Answer a few questions for a chance to win ${prizePhrase(s)}!`;
    const msgEn = String(b.message || '').trim().slice(0, 600) || defaultMsg('en');
    const msgEs = String(b.message_es || '').trim().slice(0, 600) || (b.message ? msgEn : defaultMsg('es'));
    const titleEs = String(b.title_es || '').trim().slice(0, 120) || title;
    const people = all('SELECT * FROM participants').map(rowParticipant).filter(p => p.optIn);
    const audience = people.filter(p => !(b.onlyNew && get("SELECT 1 FROM responses WHERE survey_id = ? AND participant_id = ? AND status = 'submitted'", s.id, p.id)));
    for (const p of audience) {
      const es = p.lang === 'es';
      sendBoth(p, MSG.campaign(es ? 'es' : 'en', { title: es ? titleEs : title, message: es ? msgEs : msgEn, participantId: p.id }), 'campaign', { sms: !!b.sms && !p.smsStopped, mail: !!b.email });
    }
    const c = { id: newId('c_'), title, title_es: titleEs, message: msgEn, message_es: msgEs, surveyId: s.id, sms: !!b.sms, email: !!b.email, recipients: audience.length, by: a.email };
    run('INSERT INTO campaigns (id, data, sent_at) VALUES (?, ?, ?)', c.id, JSON.stringify(c), Date.now());
    audit(a.id, 'campaign.send', { id: c.id, recipients: audience.length });
    sendJson(res, 200, { ok: true, recipients: audience.length });
  });

  /* ----- message log (useful in test mode and for troubleshooting) ----- */
  r.get('/api/admin/outbox', async (req, res) => {
    requireAdmin(req);
    sendJson(res, 200, { messages: all('SELECT id, channel, to_addr, subject, kind, status, error, created_at, sent_at, CASE WHEN channel = \'sms\' THEN body ELSE NULL END AS body FROM outbox ORDER BY id DESC LIMIT 200') });
  });
  r.get('/api/admin/audit', async (req, res) => {
    requireAdmin(req);
    sendJson(res, 200, { entries: all('SELECT * FROM audit ORDER BY id DESC LIMIT 300').map(x => ({ ...x, detail: parse(x.detail) })) });
  });
}

function winnerFromBody(base, b) {
  const w = { ...base };
  w.firstName = String(b.firstName ?? w.firstName ?? '').trim().slice(0, 60);
  w.lastInitial = String(b.lastInitial ?? w.lastInitial ?? '').trim().slice(0, 1).toUpperCase();
  w.state = STATES.includes(b.state) ? b.state : w.state;
  if (!w.firstName || !w.state) throw bad('Add a first name and state');
  Object.assign(w, prizeFields({ ...w, ...b }));
  if (!(w.goldbacks > 0)) throw bad('Choose the Gold Note');
  w.date = dayRx.test(b.date || '') ? b.date : (w.date || today());
  w.gbRate = Number(b.gbRate ?? w.gbRate) || 0;
  w.estValue = estValue(w, w.gbRate);
  if (b.claimDeadline && dayRx.test(b.claimDeadline)) w.claimDeadline = b.claimDeadline;
  w.prize = prizeLabel(w);
  return w;
}

/* ---------- background job: automatic reminders on day 3 and day 7 ---------- */
export function runReminderJob() {
  const t = today();
  for (const w of all("SELECT * FROM winners WHERE status = 'notified'").map(rowWinner)) {
    if (wStatus(w, t) !== 'notified' || !w.notifiedAt) continue;
    const notifiedDay = localDay(w.notifiedAt, config.timeZone);
    for (const d of [3, 7]) {
      const key = 'auto' + d;
      if (t >= addDays(notifiedDay, d) && !(w.log || []).some(l => l.kind === 'reminder' && l.auto === key)) {
        const nw = { ...w, log: [...(w.log || []), { at: Date.now(), kind: 'reminder', auto: key }] };
        saveWinner(nw); notifyWinner(nw, 'reminder'); audit(null, 'winner.auto_remind', { id: w.id, day: d });
        break; // at most one reminder per run
      }
    }
  }
  const now = Date.now();
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run('DELETE FROM otps WHERE expires_at < ?', now - 864e5);
  run('DELETE FROM rate_limits WHERE reset_at < ?', now);
}
