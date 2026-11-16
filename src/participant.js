// Participant-facing API.
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { all, get, run, tx, rowParticipant, rowSurvey, rowResponse, rowWinner, saveParticipant, saveWinner, getSetting, audit } from './db.js';
const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { HttpError, bad, newId, sha256, sixDigits, jsonBody, sendJson, createSession, readSession, endSession, rateLimit, clientIp, safeEqual } from './http.js';
import { T as MSG, sendBoth, queueSms, queueEmail, checkUnsubToken } from './messaging.js';
import { STATES, fmtPhone, normPhone, emailOk, maskPhone, maskEmail, localDay, addDays, wStatus, cleanAnswers, L, winnersCountOf, tiersOf, noteOzOf, notesOf, winnerGoldOz, surveyPrizeShort, topPrizeValue, WIN_CAP } from '../public/js/shared.js';

const today = () => localDay(Date.now(), config.timeZone);
const PENDING_SECONDS = 15 * 60;
const OTP_MS = 10 * 60 * 1000;

/* ---------- helpers ---------- */
export function participantById(id) { return rowParticipant(get('SELECT * FROM participants WHERE id = ?', id)); }
function participantBy(field, value) { return rowParticipant(get(`SELECT * FROM participants WHERE ${field === 'email' ? 'email' : 'phone'} = ?`, value)); }
export function requireParticipant(req) {
  const s = readSession(req, 'participant'); const p = s && participantById(s.subject);
  if (!p) throw new HttpError(401, 'Please log in.', { code: 'login_required' });
  return p;
}
const isLive = s => s && s.status === 'live' && (!s.endsAt || s.endsAt >= today());
const surveyById = id => rowSurvey(get('SELECT * FROM surveys WHERE id = ?', id));
const fmtDay = (d, lang) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
const entryNumber = () => randomBytes(5).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6).padEnd(6, 'X');

function startOtp(res, purpose, payload, to) {
  const id = newId('o_'); const code = sixDigits();
  run('INSERT INTO otps (id, purpose, code_hash, payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, purpose, sha256(id + code), JSON.stringify(payload), Date.now() + OTP_MS, Date.now());
  createSession(res, 'pending', id, PENDING_SECONDS);
  sendCode(to, code, payload.lang);
  return { id, code };
}
function sendCode({ phone, email }, code, lang) {
  const t = MSG.code(lang, code);
  if (phone) queueSms(phone, t.sms, 'code');
  if (email) queueEmail(email, t.subject, t.text, t.html(), 'code');
}
function checkOtp(req, purposes, code) {
  const s = readSession(req, 'pending');
  if (!s) throw new HttpError(400, 'Your code has expired. Please start again.', { code: 'expired' });
  const o = get('SELECT * FROM otps WHERE id = ?', s.subject);
  if (!o || !purposes.includes(o.purpose) || o.consumed_at || o.expires_at < Date.now()) throw new HttpError(400, 'Your code has expired. Please start again.', { code: 'expired' });
  if (o.attempts >= 5) throw new HttpError(429, 'Too many wrong codes. Please start again.', { code: 'too_many' });
  run('UPDATE otps SET attempts = attempts + 1 WHERE id = ?', o.id);
  if (!safeEqual(sha256(o.id + String(code || '').replace(/\D/g, '')), o.code_hash)) throw new HttpError(400, "That code doesn't match. Check it and try again.", { code: 'bad_code' });
  run('UPDATE otps SET consumed_at = ? WHERE id = ?', Date.now(), o.id);
  return { otp: o, payload: JSON.parse(o.payload) };
}
const devCode = c => (!config.smsEnabled && !config.emailEnabled && config.devShowCodes) ? c : undefined;

/* What a participant may see about themselves */
function meView(p) {
  const { id, firstName, lastName, state, email, phone, optIn, lang, address, createdAt } = p;
  return { id, firstName, lastName, state, email, phone, optIn: !!optIn, lang: lang || 'en', address: address || {}, createdAt };
}
/* What anyone may see about a winner */
function publicWinner(w) {
  return { firstName: w.firstName, lastInitial: w.lastInitial, state: w.state, place: w.place || 1, notes: notesOf(w), noteOz: noteOzOf(w), goldOz: winnerGoldOz(w), date: w.date };
}
/* Yearly limit: a person can enter a survey only if winning its top prize would keep their prizes from the last 12 months at or under $WIN_CAP.
   Returns null if they can enter, or { until } = the first day they can enter again. Values never leave the server. */
function yearlyLimit(pid, s, asOf = today()) {
  const top = topPrizeValue(s); if (!top) return null;
  const wins = all(`SELECT draw_date, est_value FROM winners WHERE participant_id = ? AND status != 'forfeited' AND draw_date > ? AND draw_date <= ? ORDER BY draw_date`, pid, addDays(asOf, -365), asOf);
  let total = wins.reduce((a, w) => a + (w.est_value || 0), 0);
  if (total + top <= WIN_CAP) return null;
  for (const w of wins) { total -= w.est_value || 0; if (total + top <= WIN_CAP) return { until: addDays(w.draw_date, 365) }; }
  return { until: null };
}
function assertUnderLimit(p, s) {
  const lim = yearlyLimit(p.id, s);
  if (lim) throw new HttpError(403, `You've reached the yearly prize limit of $${WIN_CAP} in 12 months, so you can't enter this survey${lim.until ? ` until ${lim.until}` : ' right now'}.`, { code: 'limit', until: lim.until });
}
function publicSurvey(s, withQuestions) {
  const { id, title, title_es, description, description_es, endsAt, drawDate, status, questions } = s;
  const out = { id, title, title_es, description, description_es, tiers: tiersOf(s), noteOz: noteOzOf(s), winnersCount: winnersCountOf(s), endsAt, drawDate, status, questionCount: (questions || []).length };
  if (withQuestions) out.questions = questions;
  return out;
}

/* ---------- routes ---------- */
export function participantRoutes(r) {
  /* "Run a survey with us": a business asks about having a survey run. Public (no log-in). Saved for the admin console and emailed to config.inquiryEmail. */
  r.post('/api/inquiries', async (req, res) => {
    const b = await jsonBody(req);
    if (String(b.website || '').trim()) return sendJson(res, 200, { ok: true }); // hidden field only bots fill in
    rateLimit('inquiry:ip:' + clientIp(req), 5, 3600);
    const clip = (v, n) => String(v ?? '').replace(/\s+$/g, '').trim().slice(0, n);
    const d = { name: clip(b.name, 100), company: clip(b.company, 120), email: clip(b.email, 200).toLowerCase(), phone: '', message: clip(b.message, 3000), lang: b.lang === 'es' ? 'es' : 'en' };
    const es = d.lang === 'es';
    if (d.name.length < 2) throw bad(es ? 'Escribe tu nombre.' : 'Please enter your name.', { field: 'name' });
    if (!emailOk(d.email)) throw bad(es ? 'Escribe un correo electrónico válido.' : 'Please enter a valid email address.', { field: 'email' });
    if (String(b.phone || '').trim()) { d.phone = normPhone(b.phone); if (!d.phone) throw bad(es ? 'Escribe un número de teléfono de EE. UU. válido, o déjalo en blanco.' : 'Please enter a valid US phone number, or leave it blank.', { field: 'phone' }); }
    if (d.message.length < 10) throw bad(es ? 'Cuéntanos un poco sobre la encuesta que quieres hacer.' : 'Please tell us a little about the survey you have in mind.', { field: 'message' });
    const id = newId('inq_'); const now = Date.now();
    run('INSERT INTO inquiries (id, created_at, updated_at, status, data) VALUES (?, ?, ?, ?, ?)', id, now, now, 'new', JSON.stringify(d));
    audit(null, 'inquiry.create', { id });
    const when = new Date(now).toLocaleString('en-US', { timeZone: config.timeZone, dateStyle: 'medium', timeStyle: 'short' });
    const lines = [['Name', d.name], ['Company', d.company || '—'], ['Email', d.email], ['Phone', d.phone ? fmtPhone(d.phone) : '—'], ['Language', es ? 'Spanish' : 'English'], ['Received', when]];
    const text = `New request to run a survey with Golden Opinions.\n\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nMessage:\n${d.message}\n\nReply to this email to answer ${d.name} directly. It's also in the admin console under Inquiries: ${config.publicUrl}/admin`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1d2433"><p><b>New request to run a survey with Golden Opinions.</b></p><table style="border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#667">${k}</td><td style="padding:4px 0"><b>${escHtml(v)}</b></td></tr>`).join('')}</table><p style="margin-top:16px;color:#667">Message</p><p style="white-space:pre-wrap;border-left:3px solid #d4a52a;padding-left:12px">${escHtml(d.message)}</p><p style="color:#667;font-size:13px">Reply to this email to answer ${escHtml(d.name)} directly. It's also in the <a href="${config.publicUrl}/admin">admin console</a> under Inquiries.</p></div>`;
    queueEmail(config.inquiryEmail, `New survey inquiry: ${d.company || d.name}`, text, html, 'inquiry', d.email);
    sendJson(res, 200, { ok: true });
  });

  // Public home data: live surveys and recent winners (public fields only). No dollar values are ever sent to participants.
  r.get('/api/public', async (req, res) => {
    const surveys = all("SELECT * FROM surveys WHERE status = 'live' ORDER BY created_at DESC").map(rowSurvey).filter(isLive).map(s => publicSurvey(s));
    const t = today();
    const winners = all("SELECT * FROM winners WHERE status IN ('claimed','shipped') ORDER BY draw_date DESC, created_at DESC LIMIT 200").map(rowWinner)
      .filter(w => ['claimed', 'shipped'].includes(wStatus(w, t)) && w.consentPublish !== false);
    sendJson(res, 200, { surveys, winners: winners.slice(0, 25).map(publicWinner), winnerCount: winners.length, testMode: !config.smsEnabled && !config.emailEnabled, supportEmail: config.supportEmail, inquiryEmail: config.inquiryEmail });
  });

  /* ----- sign up / log in with a 6-digit code ----- */
  r.post('/api/auth/start', async (req, res) => {
    const b = await jsonBody(req);
    const mode = b.mode === 'signup' ? 'signup' : 'login';
    const email = String(b.email || '').trim().toLowerCase(); const phone = normPhone(b.phone);
    const lang = b.lang === 'es' ? 'es' : 'en';
    rateLimit('start:ip:' + clientIp(req), 30, 3600);
    const firstName = String(b.firstName || '').trim().slice(0, 60); const lastName = String(b.lastName || '').trim().slice(0, 60);
    if (mode === 'signup' && (!firstName || !lastName)) throw bad('Please enter your first and last name.');
    if (!emailOk(email)) throw bad('Please enter a valid email address.');
    if (phone.length !== 10) throw bad('Please enter a 10-digit US mobile number.');
    if (mode === 'signup' && !STATES.includes(b.state)) throw bad('Please choose your state.');
    if (mode === 'signup' && !b.agree) throw bad('Please confirm you are 18+ and agree to the Terms, Official Rules and Privacy Policy.');
    rateLimit('start:phone:' + phone, 5, 900);
    const byE = participantBy('email', email); const byP = participantBy('phone', phone);
    if (mode === 'signup') {
      if (byE) throw bad('An account with this email already exists.', { code: 'email_exists' });
      if (byP) throw bad('An account with this mobile number already exists.', { code: 'phone_exists' });
      const { code } = startOtp(res, 'signup', { email, phone, firstName, lastName, state: b.state, optIn: !!b.optIn, lang, agreedAt: Date.now() }, { phone, email });
      return sendJson(res, 200, { ok: true, maskedPhone: maskPhone(phone), maskedEmail: maskEmail(email), devCode: devCode(code) });
    }
    if (!byE && !byP) throw bad("We couldn't find an account with that email and mobile number.", { code: 'not_found' });
    if (!byE || !byP || byE.id !== byP.id) throw bad("That email and mobile number don't match the same account.", { code: 'mismatch' });
    const { code } = startOtp(res, 'login', { pid: byE.id, lang }, { phone, email });
    sendJson(res, 200, { ok: true, maskedPhone: maskPhone(phone), maskedEmail: maskEmail(email), devCode: devCode(code) });
  });

  r.post('/api/auth/resend', async (req, res) => {
    const s = readSession(req, 'pending'); if (!s) throw bad('Your code has expired. Please start again.', { code: 'expired' });
    rateLimit('resend:' + s.subject, 3, 900);
    const o = get('SELECT * FROM otps WHERE id = ? AND consumed_at IS NULL', s.subject); if (!o) throw bad('Your code has expired. Please start again.', { code: 'expired' });
    const payload = JSON.parse(o.payload); const code = sixDigits();
    run('UPDATE otps SET code_hash = ?, expires_at = ?, attempts = 0 WHERE id = ?', sha256(o.id + code), Date.now() + OTP_MS, o.id);
    let to;
    if (o.purpose === 'signup') to = { phone: payload.phone, email: payload.email };
    else if (o.purpose === 'login') { const p = participantById(payload.pid); to = { phone: p.phone, email: p.email }; }
    else if (o.purpose === 'recover') { const p = participantById(payload.pid); to = payload.via === 'email' ? { email: p.email } : { phone: p.phone }; }
    else if (o.purpose === 'change') to = payload.field === 'email' ? { email: payload.value } : { phone: payload.value };
    sendCode(to || {}, code, payload.lang);
    sendJson(res, 200, { ok: true, devCode: devCode(code) });
  });

  r.post('/api/auth/verify', async (req, res) => {
    const b = await jsonBody(req);
    const { otp, payload } = checkOtp(req, ['signup', 'login'], b.code);
    let p;
    if (otp.purpose === 'signup') {
      p = tx(() => {
        if (participantBy('email', payload.email) || participantBy('phone', payload.phone)) throw bad('An account with this email or mobile number already exists.', { code: 'exists' });
        const np = { id: newId('p_'), email: payload.email, phone: payload.phone, firstName: payload.firstName, lastName: payload.lastName, state: payload.state, optIn: payload.optIn, optInAt: payload.optIn ? Date.now() : null, lang: payload.lang, agreedAt: payload.agreedAt, lastLogin: Date.now() };
        saveParticipant(np); return participantById(np.id);
      });
      audit(p.id, 'participant.signup', { optIn: !!payload.optIn });
    } else {
      p = participantById(payload.pid); if (!p) throw bad('Account not found.');
      saveParticipant({ ...p, lastLogin: Date.now() });
    }
    endSession(req, res, 'pending');
    createSession(res, 'participant', p.id, config.sessionDays * 86400);
    sendJson(res, 200, { ok: true, me: meView(p) });
  });

  r.post('/api/auth/logout', async (req, res) => { endSession(req, res, 'participant'); sendJson(res, 200, { ok: true }); });

  /* ----- account recovery: prove one channel, see the account ----- */
  r.post('/api/auth/recover/start', async (req, res) => {
    const b = await jsonBody(req); const via = b.via === 'phone' ? 'phone' : 'email'; const lang = b.lang === 'es' ? 'es' : 'en';
    rateLimit('recover:ip:' + clientIp(req), 10, 3600);
    let p;
    if (via === 'email') { const e = String(b.value || '').trim().toLowerCase(); if (!emailOk(e)) throw bad('Please enter a valid email address.'); p = participantBy('email', e); }
    else { const d = normPhone(b.value); if (d.length !== 10) throw bad('Please enter a 10-digit US mobile number.'); p = participantBy('phone', d); }
    if (!p) throw bad(`We couldn't find an account with that ${via === 'email' ? 'email address' : 'mobile number'}.`, { code: 'not_found', via });
    rateLimit('recover:p:' + p.id, 5, 900);
    const { code } = startOtp(res, 'recover', { pid: p.id, via, lang }, via === 'email' ? { email: p.email } : { phone: p.phone });
    sendJson(res, 200, { ok: true, masked: via === 'email' ? maskEmail(p.email) : maskPhone(p.phone), devCode: devCode(code) });
  });
  r.post('/api/auth/recover/verify', async (req, res) => {
    const b = await jsonBody(req);
    const { payload } = checkOtp(req, ['recover'], b.code);
    const p = participantById(payload.pid); if (!p) throw bad('Account not found.');
    endSession(req, res, 'pending');
    createSession(res, 'participant', p.id, config.sessionDays * 86400);
    audit(p.id, 'participant.recover', { via: payload.via });
    sendJson(res, 200, { ok: true, me: meView(p), verifiedVia: payload.via });
  });

  /* ----- my account ----- */
  r.get('/api/me', async (req, res) => {
    const sess = readSession(req, 'participant'); if (!sess || !participantById(sess.subject)) return sendJson(res, 200, { me: null });
    const p = requireParticipant(req); const t = today();
    const responses = all('SELECT * FROM responses WHERE participant_id = ?', p.id).map(rowResponse)
      .map(x => ({ surveyId: x.surveyId, status: x.status, entryNo: x.entryNo, submittedAt: x.submittedAt, answers: x.status === 'draft' ? x.answers : undefined, startedAt: x.startedAt }));
    const wins = all('SELECT * FROM winners WHERE participant_id = ? ORDER BY created_at DESC', p.id).map(rowWinner)
      .filter(w => wStatus(w, t) !== 'forfeited')
      .map(w => { const s = surveyById(w.surveyId); return { id: w.id, surveyId: w.surveyId, surveyTitle: s ? s.title : '', surveyTitle_es: s ? s.title_es : '', status: wStatus(w, t), claimDeadline: w.claimDeadline, date: w.date, place: w.place || 1, notes: notesOf(w), noteOz: noteOzOf(w), goldOz: winnerGoldOz(w), firstName: w.firstName, lastInitial: w.lastInitial, state: w.state, shipTo: w.shipTo, tracking: w.tracking, claimedAt: w.claimedAt, shippedAt: w.shippedAt, log: (w.log || []).map(l => ({ at: l.at, kind: l.kind })) }; });
    const surveyTitles = {};
    for (const x of responses) { const s = surveyById(x.surveyId); if (s) surveyTitles[s.id] = { title: s.title, title_es: s.title_es }; }
    const campaigns = p.optIn ? all('SELECT * FROM campaigns WHERE sent_at >= ? ORDER BY sent_at DESC LIMIT 20', (p.createdAt || 0) - 30 * 864e5).map(c => { const d = JSON.parse(c.data); return { id: c.id, title: d.title, title_es: d.title_es, message: d.message, message_es: d.message_es, surveyId: d.surveyId, sentAt: c.sent_at }; }) : [];
    const limits = {};
    for (const s of all("SELECT * FROM surveys WHERE status = 'live'").map(rowSurvey).filter(isLive)) {
      if (responses.some(x => x.surveyId === s.id && x.status === 'submitted')) continue;
      const lim = yearlyLimit(p.id, s); if (lim) limits[s.id] = { until: lim.until };
    }
    sendJson(res, 200, { me: meView(p), responses, wins, campaigns, surveyTitles, limits, winCap: WIN_CAP });
  });

  r.put('/api/me/profile', async (req, res) => {
    const p = requireParticipant(req); const b = await jsonBody(req);
    const g = k => String(b[k] || '').trim().slice(0, 120);
    if (!g('firstName') || !g('lastName')) throw bad('Please enter your first and last name');
    if (!STATES.includes(b.state)) throw bad('Please choose your state');
    const a = b.address || {}; const zip = String(a.zip || '').trim();
    if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) throw bad('ZIP should be 5 digits');
    saveParticipant({ ...p, firstName: g('firstName'), lastName: g('lastName'), state: b.state, address: { street: String(a.street || '').trim().slice(0, 200), city: String(a.city || '').trim().slice(0, 100), zip } });
    sendJson(res, 200, { ok: true, me: meView(participantById(p.id)) });
  });
  r.put('/api/me/prefs', async (req, res) => {
    const p = requireParticipant(req); const b = await jsonBody(req); const np = { ...p };
    if ('optIn' in b) { np.optIn = !!b.optIn; np[b.optIn ? 'optInAt' : 'optOutAt'] = Date.now(); }
    if ('lang' in b) np.lang = b.lang === 'es' ? 'es' : 'en';
    saveParticipant(np); sendJson(res, 200, { ok: true, me: meView(participantById(p.id)) });
  });
  // change email or phone: code goes to the NEW address/number
  r.post('/api/me/contact/start', async (req, res) => {
    const p = requireParticipant(req); const b = await jsonBody(req); const field = b.field === 'phone' ? 'phone' : 'email';
    rateLimit('change:' + p.id, 5, 900);
    let v;
    if (field === 'phone') { v = normPhone(b.value); if (v.length !== 10) throw bad('Please enter a 10-digit US mobile number.'); if (v === p.phone) throw bad("That's already your number."); if (participantBy('phone', v)) throw bad('That mobile number is already used by another account.'); }
    else { v = String(b.value || '').trim().toLowerCase(); if (!emailOk(v)) throw bad('Please enter a valid email address.'); if (v === p.email) throw bad("That's already your email."); if (participantBy('email', v)) throw bad('That email is already used by another account.'); }
    const { code } = startOtp(res, 'change', { pid: p.id, field, value: v, lang: p.lang }, field === 'phone' ? { phone: v } : { email: v });
    sendJson(res, 200, { ok: true, value: v, devCode: devCode(code) });
  });
  r.post('/api/me/contact/verify', async (req, res) => {
    const p = requireParticipant(req); const b = await jsonBody(req);
    const { payload } = checkOtp(req, ['change'], b.code);
    if (payload.pid !== p.id) throw bad('Please start again.');
    tx(() => {
      if (participantBy(payload.field, payload.value)) throw bad(`That ${payload.field === 'phone' ? 'mobile number' : 'email'} is already used by another account.`);
      saveParticipant({ ...participantById(p.id), [payload.field]: payload.value });
    });
    endSession(req, res, 'pending');
    audit(p.id, 'participant.contact_change', { field: payload.field });
    sendJson(res, 200, { ok: true, me: meView(participantById(p.id)) });
  });
  r.del('/api/me', async (req, res) => {
    const p = requireParticipant(req);
    tx(() => {
      run("DELETE FROM responses WHERE participant_id = ? AND status = 'draft'", p.id);
      run('DELETE FROM participants WHERE id = ?', p.id);
      run("DELETE FROM sessions WHERE kind = 'participant' AND subject = ?", p.id);
    });
    audit(p.id, 'participant.delete');
    endSession(req, res, 'participant');
    sendJson(res, 200, { ok: true });
  });

  /* ----- surveys ----- */
  r.get('/api/surveys/:id', async (req, res, { params }) => {
    requireParticipant(req);
    const s = surveyById(params.id); if (!isLive(s)) throw new HttpError(404, 'This survey is closed.', { code: 'closed' });
    const p = requireParticipant(req);
    const mine = get("SELECT status FROM responses WHERE survey_id = ? AND participant_id = ?", s.id, p.id);
    if (!mine || mine.status !== 'submitted') assertUnderLimit(p, s);
    sendJson(res, 200, { survey: publicSurvey(s, true) });
  });
  r.put('/api/surveys/:id/draft', async (req, res, { params }) => {
    const p = requireParticipant(req); const b = await jsonBody(req);
    const s = surveyById(params.id); if (!isLive(s)) throw new HttpError(404, 'This survey is closed.', { code: 'closed' });
    const id = s.id + '__' + p.id; const prev = rowResponse(get('SELECT * FROM responses WHERE id = ?', id));
    if (prev && prev.status === 'submitted') throw new HttpError(409, "You're already entered", { code: 'already' });
    assertUnderLimit(p, s);
    const { answers } = cleanAnswers(s, b.answers); const now = Date.now();
    run(`INSERT INTO responses (id, survey_id, participant_id, email, phone, status, answers, lang, started_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET answers = excluded.answers, lang = excluded.lang, updated_at = excluded.updated_at`, id, s.id, p.id, p.email, p.phone, JSON.stringify(answers), b.lang === 'es' ? 'es' : 'en', now, now);
    sendJson(res, 200, { ok: true });
  });
  r.post('/api/surveys/:id/submit', async (req, res, { params }) => {
    const p = requireParticipant(req); const b = await jsonBody(req);
    const s = surveyById(params.id); if (!isLive(s)) throw new HttpError(404, 'Sorry, this survey has closed.', { code: 'closed' });
    const { answers, missing } = cleanAnswers(s, b.answers);
    if (missing.length) throw bad(`Please answer ${missing.length} required question${missing.length > 1 ? 's' : ''} before submitting.`, { code: 'missing', missing });
    assertUnderLimit(p, s);
    const lang = b.lang === 'es' ? 'es' : 'en'; const id = s.id + '__' + p.id; const now = Date.now(); const entryNo = entryNumber();
    tx(() => {
      // Rule: one entry per survey per email address and per phone number
      const dup = get("SELECT id FROM responses WHERE survey_id = ? AND status = 'submitted' AND (participant_id = ? OR email = ? OR phone = ?)", s.id, p.id, p.email, p.phone);
      if (dup) throw new HttpError(409, 'This email address or phone number has already completed this survey. Each person can enter once.', { code: 'already' });
      const prev = get('SELECT started_at FROM responses WHERE id = ?', id);
      run(`INSERT INTO responses (id, survey_id, participant_id, email, phone, status, answers, lang, entry_no, started_at, updated_at, submitted_at) VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = 'submitted', answers = excluded.answers, lang = excluded.lang, entry_no = excluded.entry_no, email = excluded.email, phone = excluded.phone, updated_at = excluded.updated_at, submitted_at = excluded.submitted_at`,
        id, s.id, p.id, p.email, p.phone, JSON.stringify(answers), lang, entryNo, prev ? prev.started_at : now, now, now);
    });
    sendBoth(p, MSG.confirm(lang, { firstName: p.firstName, title: L(s, 'title', lang), entryNo, prize: surveyPrizeShort(s, lang), drawDate: fmtDay(s.drawDate || s.endsAt, lang) }), 'confirm');
    sendJson(res, 200, { ok: true, entryNo, submittedAt: now });
  });

  /* ----- claim a prize ----- */
  r.post('/api/wins/:id/claim', async (req, res, { params }) => {
    const p = requireParticipant(req); const b = await jsonBody(req);
    const w = rowWinner(get('SELECT * FROM winners WHERE id = ?', params.id));
    if (!w || w.participantId !== p.id) throw new HttpError(404, "This prize couldn't be found.");
    if (wStatus(w, today()) !== 'notified') throw bad('This prize can no longer be claimed.', { code: 'not_claimable' });
    const a = b.shipTo || {}; const g = k => String(a[k] || '').trim().slice(0, 200);
    if (!g('name') || !g('street') || !g('city') || !g('zip')) throw bad('Please fill in your full shipping address.');
    if (!/^\d{5}(-\d{4})?$/.test(g('zip'))) throw bad('ZIP code should be 5 digits.');
    if (!STATES.includes(a.state)) throw bad('Please choose your state');
    if (!b.affidavit) throw bad('Please confirm your eligibility to claim the prize.');
    const shipTo = { name: g('name'), street: g('street'), city: g('city'), state: a.state, zip: g('zip') };
    tx(() => {
      saveWinner({ ...w, status: 'claimed', claimedAt: Date.now(), shipTo, affidavitAt: Date.now(), consentPublish: !!b.consent, log: [...(w.log || []), { at: Date.now(), kind: 'claimed' }] });
      saveParticipant({ ...participantById(p.id), address: { street: shipTo.street, city: shipTo.city, zip: shipTo.zip } });
    });
    audit(p.id, 'winner.claim', { winnerId: w.id });
    sendJson(res, 200, { ok: true });
  });

  /* ----- email unsubscribe link (no login) ----- */
  r.get('/u/:token', async (req, res, { params }) => {
    const pid = checkUnsubToken(params.token); const p = pid && participantById(pid);
    if (p) { saveParticipant({ ...p, optIn: false, optOutAt: Date.now() }); audit(p.id, 'participant.unsubscribe'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Golden Opinions</title><body style="font-family:Arial;background:#0a2f96;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:20px"><div><h1 style="color:#f2c44a">Golden Opinions</h1><p>${p ? "You're unsubscribed from new-survey alerts. / Cancelaste las alertas de nuevas encuestas." : 'This link is not valid. / Este enlace no es válido.'}</p><p><a style="color:#f2c44a" href="/">Golden Opinions</a></p></div></body>`);
  });
}

/* ---------- Twilio inbound webhook: STOP / START keywords update alert preferences ---------- */
export function webhookRoutes(r, { verifyTwilio }) {
  r.post('/api/webhooks/twilio', async (req, res, ctx) => {
    const params = ctx.form || {};
    if (!verifyTwilio(req, params)) throw new HttpError(403, 'Invalid signature');
    const phone = normPhone(params.From); const word = String(params.Body || '').trim().toUpperCase();
    const p = participantBy('phone', phone);
    if (p) {
      if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'ALTO', 'PARAR'].includes(word)) { saveParticipant({ ...p, optIn: false, optOutAt: Date.now(), smsStopped: true }); audit(p.id, 'participant.sms_stop'); }
      if (['START', 'UNSTOP', 'YES'].includes(word)) { saveParticipant({ ...p, smsStopped: false }); audit(p.id, 'participant.sms_start'); }
    }
    res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<Response></Response>');
  });
}
