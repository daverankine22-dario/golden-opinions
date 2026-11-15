// Admin API (staff only). Log-in = email + password + a 6-digit code emailed to the staff member.
import { randomInt } from 'node:crypto';
import { config } from './config.js';
import { all, get, run, tx, rowParticipant, rowSurvey, rowResponse, rowWinner, saveSurvey, saveWinner, getSetting, setSetting, audit, parse } from './db.js';
import { HttpError, bad, newId, sha256, sixDigits, jsonBody, sendJson, createSession, readSession, endSession, rateLimit, clientIp, checkPassword, safeEqual } from './http.js';
import { T as MSG, queueEmail, queueSms, sendBoth } from './messaging.js';
import { WIN_CAP, CLAIM_DAYS, STATES, localDay, addDays, wStatus, surveyProblems, estValue, surveyRateOf, topPrizeValue, prizeLabel, shortPrize, winnersCountOf, fmtPhone, answerText, L, tiersOf, noteOzOf, notesOf, goldOzOf, placeLabel, PLACES, DEFAULT_NOTE_OZ, POOL_CAP, poolValue, surveyPrizeShort, fmtOz, topGoldOz, summaryOf, fmtPct } from '../public/js/shared.js';

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
const noteOzSetting = () => (getSetting('goldnote') || {}).noteOz || DEFAULT_NOTE_OZ;
// a winner's prize fields, from a place's number of notes and the survey's note size
function winnerPrize(place, notes, noteOz, rate) {
  const n = Math.max(1, Math.min(10000, parseInt(notes) || 0)); const oz = Number(noteOz) > 0 ? +noteOz : DEFAULT_NOTE_OZ;
  const w = { place: PLACES.includes(+place) ? +place : 1, notes: n, noteOz: oz, goldOz: goldOzOf(n, oz), gbRate: +rate || 0, estValue: estValue(n, rate) };
  w.prize = prizeLabel(w); return w;
}
function notifyWinner(w, kind) {
  const p = participantById(w.participantId); if (!p) return;
  const s = surveyById(w.surveyId) || {}; const lang = p.lang === 'es' ? 'es' : 'en';
  const prize = prizeLabel(w, lang); const deadline = fmtDay(w.claimDeadline, lang);
  const tpl = kind === 'win' ? MSG.win(lang, { firstName: p.firstName, title: L(s, 'title', lang) || '', prize, place: placeLabel(w.place || 1, lang), deadline })
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
      settings: { goldback: getSetting('goldback'), goldnote: { noteOz: noteOzSetting() } },
      outbox: { queued: get("SELECT COUNT(*) n FROM outbox WHERE status = 'queued'").n, failed: get("SELECT COUNT(*) n FROM outbox WHERE status = 'failed'").n },
      smsEnabled: config.smsEnabled, emailEnabled: config.emailEnabled,
    });
  });

  /* ----- surveys ----- */
  r.put('/api/admin/surveys/:id', async (req, res, { params }) => {
    const a = requireAdmin(req); const b = await jsonBody(req); const s = b.survey || {};
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(params.id)) throw bad('Invalid survey id');
    const prev = surveyById(params.id);
    const tiers = PLACES.map(pl => { const t = (s.tiers || []).find(x => +x.place === pl) || {}; return { place: pl, winners: Math.max(0, Math.min(1000, parseInt(t.winners) || 0)), notes: Math.max(0, Math.min(10000, parseInt(t.notes) || 0)) }; });
    const clean = { ...s, id: params.id, status: ['draft', 'live', 'closed'].includes(s.status) ? s.status : 'draft', tiers, noteOz: Number(s.noteOz) > 0 ? +Number(s.noteOz).toFixed(6) : noteOzSetting(), createdAt: prev ? prev.createdAt : Date.now() };
    for (const k of ['updatedAt', 'goldbacks', 'noteDenom', 'noteQty', 'goldAmt', 'goldUnit', 'winnersCount', 'prize']) delete clean[k];
    clean.winnersCount = winnersCountOf(clean); clean.prize = surveyPrizeShort(clean);
    for (const k of ['endsAt', 'drawDate']) if (clean[k] && !dayRx.test(clean[k])) clean[k] = '';
    // Gold Note value ($ per note), entered when the survey is created. Locked once anyone has entered, so every entrant is checked against the same value.
    const hasEntries = prev && get("SELECT 1 FROM responses WHERE survey_id = ? AND status = 'submitted' LIMIT 1", prev.id);
    if (hasEntries && surveyRateOf(prev)) { clean.noteRate = prev.noteRate; clean.rateDate = prev.rateDate; }
    else {
      const v = Number(s.noteRate);
      if (v > 0 && v < 10000) { clean.noteRate = +v.toFixed(2); clean.rateDate = prev && +prev.noteRate === clean.noteRate && prev.rateDate ? prev.rateDate : today(); }
      else { delete clean.noteRate; delete clean.rateDate; }
    }
    const errs = surveyProblems(clean);
    const rate = surveyRateOf(clean);
    if (clean.status === 'live' && !rate) errs.push("Enter today's dollar value of one Gold Note before making the survey live. It's used to check each person's yearly prize limit when they enter.");
    if (rate && topPrizeValue(clean) > WIN_CAP) errs.push(`The top prize is worth about $${topPrizeValue(clean).toFixed(2)} at $${rate} per Gold Note — more than the $${WIN_CAP} a person can win in 12 months. Use fewer Gold Notes.`);
    if (rate && poolValue(clean, rate) > POOL_CAP) errs.push(`The total prize pool is worth about $${poolValue(clean, rate).toFixed(2)} at $${rate} per Gold Note — over the $${POOL_CAP.toLocaleString()} limit per survey. Use fewer winners or fewer Gold Notes.`);
    if (errs.length) throw bad(errs[0], { problems: errs });
    saveSurvey(clean);
    if (rate && (!prev || +prev.noteRate !== rate)) setSetting('goldback', { ...(getSetting('goldback') || {}), rate, updatedAt: Date.now() }); // remembered as the default for the next survey
    audit(a.id, prev ? 'survey.update' : 'survey.create', { id: params.id, status: clean.status, noteRate: clean.noteRate });
    sendJson(res, 200, { ok: true, survey: surveyById(params.id) });
  });
  r.del('/api/admin/surveys/:id', async (req, res, { params }) => {
    const a = requireAdmin(req);
    if (get('SELECT 1 FROM winners WHERE survey_id = ? LIMIT 1', params.id)) throw bad('This survey has winners, so it can’t be deleted. Close it instead.');
    run('DELETE FROM surveys WHERE id = ?', params.id); audit(a.id, 'survey.delete', { id: params.id });
    sendJson(res, 200, { ok: true });
  });
  /* Report downloads. type: personal (with names and contact details) | anonymous (no personal data) | summary (question, answer, percent).
     Every download is written to the audit log with its type. */
  r.get('/api/admin/surveys/:id/export.csv', async (req, res, { params, query }) => {
    const a = requireAdmin(req); const s = surveyById(params.id); if (!s) throw new HttpError(404, 'Survey not found');
    const type = ['personal', 'anonymous', 'summary'].includes(query.get('type')) ? query.get('type') : 'personal';
    const rs = all("SELECT * FROM responses WHERE survey_id = ? AND status = 'submitted' ORDER BY submitted_at", s.id).map(rowResponse);
    const qs = s.questions || [];
    const cell = v => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const line = arr => arr.map(cell).join(',');
    const people = {}; const person = id => people[id] || (people[id] = participantById(id) || {});
    const when = ms => new Date(ms).toLocaleString('en-US', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const rows = [];
    if (type === 'personal') {
      rows.push(line(['Entry', 'First name', 'Last name', 'Email', 'Phone', 'State', 'Language', 'Submitted', ...qs.map(q => q.text)]));
      for (const x of rs) { const p = person(x.participantId); rows.push(line([x.entryNo, p.firstName, p.lastName, x.email, fmtPhone(x.phone), p.state, x.lang || 'en', when(x.submittedAt), ...qs.map(q => answerText(q, x.answers[q.id]))])); }
    } else if (type === 'anonymous') {
      rows.push(line(['Respondent', 'State', 'Language', 'Submitted (date)', ...qs.map(q => q.text)]));
      rs.forEach((x, i) => rows.push(line([i + 1, person(x.participantId).state, x.lang || 'en', localDay(x.submittedAt, config.timeZone), ...qs.map(q => answerText(q, x.answers[q.id]))])));
    } else {
      rows.push(line(['Survey', s.title])); rows.push(line(['Completed entries', rs.length])); rows.push('');
      rows.push(line(['#', 'Question', 'Answered', 'Answer', 'Percent', 'Count']));
      qs.forEach((q, i) => {
        const sm = summaryOf(q, rs.map(x => x.answers[q.id]));
        const head = [i + 1, q.text, sm.n];
        if (sm.kind === 'matrix') for (const r of sm.matrix.rows) sm.matrix.cols.forEach((c, j) => rows.push(line([...head, `${r.label}: ${c}`, fmtPct(r.cells[j].pct), r.cells[j].count])));
        else if (sm.kind === 'text') rows.push(line([...head, '(written answers)', '', sm.n]));
        else for (const r of sm.rows) rows.push(line([...head, r.label, fmtPct(r.pct), r.count]));
        for (const st of sm.stats) rows.push(line([...head, st.label, st.value, '']));
      });
    }
    audit(a.id, 'survey.export', { id: s.id, type, rows: rs.length });
    const name = (s.title || 'survey').replace(/[^\w-]+/g, '-').slice(0, 50);
    const suffix = { personal: 'responses-with-personal-data', anonymous: 'responses-anonymous', summary: 'summary' }[type];
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${suffix}.csv"`, 'Cache-Control': 'no-store' });
    res.end('﻿' + rows.join('\r\n'));
  });

  /* ----- Gold in each Gold Note (default for new surveys) ----- */
  r.put('/api/admin/settings/note', async (req, res) => {
    const a = requireAdmin(req); const b = await jsonBody(req); const v = Number(b.noteOz);
    if (!(v > 0 && v <= 10)) throw bad('Enter how much gold is in each Gold Note, in ounces (for example 0.001).');
    setSetting('goldnote', { noteOz: +v.toFixed(6), updatedAt: Date.now() });
    audit(a.id, 'settings.note_oz', { noteOz: v });
    sendJson(res, 200, { ok: true });
  });
  /* ----- internal Gold Note rate ($ per note) — used only for the $999 limit, the $2,500 pool cap and records ----- */
  r.put('/api/admin/settings/goldback', async (req, res) => {
    const a = requireAdmin(req); const b = await jsonBody(req); const v = Number(b.rate);
    if (!(v > 0 && v < 10000)) throw bad('Enter the dollar rate for one Gold Note');
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
    const result = tx(() => {
      const s = surveyById(params.id); if (!s) throw new HttpError(404, 'Survey not found');
      const rate = surveyRateOf(s) || (getSetting('goldback') || {}).rate; // the value set when the survey was created
      if (!(rate > 0)) throw bad(`Set this survey's Gold Note value first: the draw checks the $${WIN_CAP} limit per person over 12 months.`, { code: 'no_rate' });
      const tiers = tiersOf(s); const noteOz = noteOzOf(s);
      if (!tiers.length) throw bad('This survey has no prize places set.');
      const top = tiers.find(t => estValue(t.notes, rate) > WIN_CAP);
      if (top) throw bad(`${placeLabel(top.place)} (${top.notes} Gold Notes) is worth about $${estValue(top.notes, rate).toFixed(2)} at this rate — more than the $${WIN_CAP} a person can win in 12 months. Use fewer Gold Notes for that place.`, { code: 'over_cap' });
      const existing = all('SELECT * FROM winners WHERE survey_id = ?', s.id).map(rowWinner);
      const open = tiers.map(t => ({ ...t, need: t.winners - existing.filter(w => w.status !== 'forfeited' && (w.place || 1) === t.place).length })).filter(t => t.need > 0);
      const totalNeed = open.reduce((a2, t) => a2 + t.need, 0);
      if (totalNeed <= 0) throw bad(`All ${winnersCountOf(s)} winners have been drawn.`, { code: 'full' });
      const already = new Set(existing.map(w => w.responseId));
      const pool = all("SELECT * FROM responses WHERE survey_id = ? AND status = 'submitted'", s.id).map(rowResponse).filter(x => !already.has(x.id) && participantById(x.participantId));
      if (!pool.length) throw bad('There are no remaining entries to draw from.', { code: 'empty' });
      for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; } // cryptographic shuffle
      // fill 1st place first, then 2nd, then 3rd, walking the shuffled entries; skip anyone the prize would put over the limit
      const used = new Set(); const skipped = new Set(); const saved = [];
      for (const t of open) {
        const value = estValue(t.notes, rate); let got = 0;
        for (const x of pool) {
          if (got >= t.need) break;
          if (used.has(x.id)) continue;
          if (wonLast12(x.participantId, date) + value > WIN_CAP) { skipped.add(x.id); continue; }
          used.add(x.id); got++;
          const p = participantById(x.participantId);
          const w = { id: newId('w_'), surveyId: s.id, responseId: x.id, participantId: p.id, status: 'notified', date, ...winnerPrize(t.place, t.notes, noteOz, rate),
            firstName: p.firstName, lastInitial: (p.lastName || '').slice(0, 1).toUpperCase(), state: p.state, fullName: `${p.firstName} ${p.lastName}`,
            contact: `${p.email} · ${fmtPhone(p.phone)} · Entry #${x.entryNo}`, claimDeadline: deadline, notifiedAt: Date.now(), log: [{ at: Date.now(), kind: 'won' }] };
          saveWinner(w); saved.push(w);
        }
      }
      const capped = [...skipped].filter(id => !used.has(id)).length;
      if (!saved.length) throw bad(capped ? `No eligible entries — ${capped} skipped by the $${WIN_CAP} / 12-month limit.` : 'There are no remaining entries to draw from.', { code: 'empty' });
      audit(a.id, 'draw', { surveyId: s.id, poolSize: pool.length, capped, need: totalNeed, picks: saved.map(w => ({ response: w.responseId, place: w.place })), rate: saved[0] && saved[0].gbRate, date });
      return { saved, poolSize: pool.length, capped, need: totalNeed };
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
    const defaultMsg = lang => lang === 'es' ? `Hay una nueva encuesta de Golden Opinions: "${L(s, 'title', 'es')}". Responde unas preguntas y participa para ganar oro: ${surveyPrizeShort(s, 'es')}.` : `A new Golden Opinions survey is live: "${s.title}". Answer a few questions for a chance to win gold: ${surveyPrizeShort(s)}!`;
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
  if (!(parseInt(b.notes ?? notesOf(w)) > 0)) throw bad('Enter the number of Gold Notes');
  for (const k of ['goldbacks', 'noteDenom', 'noteQty', 'goldAmt', 'goldUnit']) delete w[k];
  w.date = dayRx.test(b.date || '') ? b.date : (w.date || today());
  Object.assign(w, winnerPrize(b.place ?? w.place ?? 1, b.notes ?? notesOf(w), b.noteOz ?? noteOzOf(w), Number(b.gbRate ?? w.gbRate) || 0));
  if (b.claimDeadline && dayRx.test(b.claimDeadline)) w.claimDeadline = b.claimDeadline;
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
