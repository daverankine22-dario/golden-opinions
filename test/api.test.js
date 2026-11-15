// End-to-end API tests: run with `npm test`. Uses an in-memory database and test-mode messaging.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.DB_FILE = ':memory:';
process.env.DEV_SHOW_CODES = '1';
process.env.NODE_ENV = 'test';
process.env.PUBLIC_URL = 'http://localhost';
const { buildApp } = await import('../src/server.js');
const db = await import('../src/db.js');
const { hashPassword } = await import('../src/http.js');
const { newQuestion, STATES } = await import('../public/js/shared.js');

let server, base;
before(async () => { server = createServer(buildApp()); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); db.closeDb(); });

class Client {
  constructor() { this.jar = {}; }
  async req(method, path, body, headers = {}) {
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1); if (/Max-Age=0/.test(c)) delete this.jar[k]; else this.jar[k] = v; }
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  }
  get(p) { return this.req('GET', p); } post(p, b) { return this.req('POST', p, b || {}); } put(p, b) { return this.req('PUT', p, b || {}); } del(p) { return this.req('DELETE', p); }
}
async function signup(c, i, extra = {}) {
  const r = await c.post('/api/auth/start', { mode: 'signup', firstName: 'Test' + i, lastName: 'Person', email: `t${i}@x.com`, phone: `60255500${String(i).padStart(2, '0')}`, state: 'Arizona', agree: true, optIn: true, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await c.post('/api/auth/verify', { code: r.body.devCode });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body.me;
}
const admin = new Client(); let surveyId;
const fullAnswers = s => Object.fromEntries(s.questions.map(q => [q.id, q.type === 'single' || q.type === 'dropdown' ? q.options[0] : q.type === 'multi' ? [q.options[0]] : q.type === 'likert' ? 'Agree' : q.type === 'rating' ? 5 : q.type === 'slider' ? 50 : q.type === 'matrix' ? Object.fromEntries(q.rows.map(r => [r, 'Satisfied'])) : 'hello']));

test('public data and CSRF guard', async () => {
  const c = new Client();
  const r = await c.get('/api/public'); assert.equal(r.status, 200); assert.deepEqual(r.body.surveys, []);
  const raw = await fetch(base + '/api/auth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(raw.status, 403, 'POST without our header is refused');
});

test('admin log-in with password + emailed code', async () => {
  db.run('INSERT INTO admins (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', 'a_1', 'boss@x.com', 'Boss', hashPassword('correct horse battery'), Date.now());
  assert.equal((await admin.post('/api/admin/login', { email: 'boss@x.com', password: 'wrong' })).status, 400);
  const r = await admin.post('/api/admin/login', { email: 'boss@x.com', password: 'correct horse battery' }); assert.equal(r.status, 200);
  assert.equal((await admin.post('/api/admin/verify', { code: '000000' === r.body.devCode ? '111111' : '000000' })).status, 400);
  assert.equal((await admin.post('/api/admin/verify', { code: r.body.devCode })).status, 200);
  assert.equal((await admin.get('/api/admin/me')).status, 200);
  assert.equal((await new Client().get('/api/admin/data')).status, 401, 'participants cannot reach admin data');
});

test('admin creates a survey and sets the Gold Note rate', async () => {
  const qs = ['single', 'multi', 'dropdown', 'likert', 'rating', 'slider', 'matrix', 'text'].map((t, i) => Object.assign(newQuestion(t, 'q' + i), { text: 'Question ' + i }));
  qs[2].options = [...STATES];
  surveyId = 's_test1';
  const bad = await admin.put('/api/admin/surveys/' + surveyId, { survey: { title: '', questions: qs, tiers: [{ place: 1, winners: 1, notes: 10 }] } });
  assert.equal(bad.status, 400);
  const base1 = { title: 'Test survey', status: 'live', questions: qs, tiers: [{ place: 1, winners: 1, notes: 10 }, { place: 2, winners: 1, notes: 5 }, { place: 3, winners: 1, notes: 1 }], noteOz: 0.001, title_es: 'Encuesta' };
  const noRate = await admin.put('/api/admin/surveys/' + surveyId, { survey: base1 });
  assert.equal(noRate.status, 400, 'a live survey needs its Gold Note value'); assert.match(noRate.body.error, /dollar value of one Gold Note/);
  const r = await admin.put('/api/admin/surveys/' + surveyId, { survey: { ...base1, noteRate: 7.5 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.survey.winnersCount, 3); assert.equal(r.body.survey.tiers.filter(t => t.winners).length, 3);
  assert.equal(r.body.survey.noteRate, 7.5); assert.ok(/^\d{4}-\d\d-\d\d$/.test(r.body.survey.rateDate), 'value is dated the day it was entered');
  const pub = await new Client().get('/api/public');
  assert.equal(pub.body.surveys.length, 1); assert.equal(pub.body.surveys[0].questions, undefined, 'questions are not exposed publicly');
  assert.equal(pub.body.rate, undefined, 'no dollar rate is sent to participants'); assert.equal(pub.body.surveys[0].noteRate, undefined);
  assert.deepEqual(pub.body.surveys[0].tiers.map(t => t.notes), [10, 5, 1]);
  assert.equal(pub.body.surveys[0].noteOz, 0.001);
  const tooBig = await admin.put('/api/admin/surveys/s_toobig', { survey: { title: 'Too big', status: 'draft', questions: qs, tiers: [{ place: 1, winners: 10, notes: 80 }], noteRate: 7.5 } });
  const topTooBig = await admin.put('/api/admin/surveys/s_toobig', { survey: { title: 'Top too big', status: 'draft', questions: qs, tiers: [{ place: 1, winners: 1, notes: 80 }], noteRate: 20 } });
  assert.match(topTooBig.body.error, /\$999/, '80 notes at $20 = $1,600 is over the yearly limit');
  assert.match(tooBig.body.error, /\$5,000/, '800 notes × $7.50 = $6,000 is over the per-survey cap');
});

test('sign up, duplicate accounts, log in, wrong codes', async () => {
  const c = new Client(); const me = await signup(c, 1);
  assert.equal(me.firstName, 'Test1');
  const d = await new Client().post('/api/auth/start', { mode: 'signup', firstName: 'X', lastName: 'Y', email: 't1@x.com', phone: '6025559999', state: 'Ohio', agree: true });
  assert.equal(d.body.code, 'email_exists');
  const m = await new Client().post('/api/auth/start', { mode: 'login', email: 't1@x.com', phone: '6025559999' });
  assert.equal(m.body.code, 'mismatch');
  const c2 = new Client(); const s = await c2.post('/api/auth/start', { mode: 'login', email: 'T1@x.com', phone: '(602) 555-0001' });
  assert.equal(s.status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await c2.post('/api/auth/verify', { code: '999999' === s.body.devCode ? '888888' : '999999' })).status, 400);
  assert.equal((await c2.post('/api/auth/verify', { code: s.body.devCode })).status, 429, 'locked after 5 wrong codes');
});

test('take a survey: drafts, validation, one entry per email and phone', async () => {
  const c = new Client(); await signup(c, 2);
  const { body: { survey } } = await c.get('/api/surveys/' + surveyId);
  assert.equal(survey.questions.length, 8);
  assert.equal((await c.put(`/api/surveys/${surveyId}/draft`, { answers: { q0: survey.questions[0].options[1] } })).status, 200);
  const me = await c.get('/api/me'); assert.equal(me.body.responses[0].status, 'draft'); assert.equal(me.body.responses[0].answers.q0, survey.questions[0].options[1]);
  const miss = await c.post(`/api/surveys/${surveyId}/submit`, { answers: { q0: 'Option 1' } }); assert.equal(miss.body.code, 'missing');
  const junk = await c.post(`/api/surveys/${surveyId}/submit`, { answers: { ...fullAnswers(survey), q0: 'Not an option' } }); assert.equal(junk.body.code, 'missing', 'invalid values are rejected');
  const ok = await c.post(`/api/surveys/${surveyId}/submit`, { answers: fullAnswers(survey), lang: 'es' }); assert.equal(ok.status, 200); assert.match(ok.body.entryNo, /^[A-Z0-9]{6}$/);
  assert.equal((await c.post(`/api/surveys/${surveyId}/submit`, { answers: fullAnswers(survey) })).status, 409);
  const out = db.all("SELECT * FROM outbox WHERE kind = 'confirm'"); assert.equal(out.length, 2, 'confirmation text + email');
  assert.match(out[0].body, /Ya estás participando/, 'confirmation in the language used');
});

test('recovery and changing phone number (code goes to the new number)', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/recover/start', { via: 'email', value: 't2@x.com' }); assert.equal(r.status, 200);
  const v = await c.post('/api/auth/recover/verify', { code: r.body.devCode }); assert.equal(v.status, 200); assert.equal(v.body.me.phone, '6025550002');
  assert.equal((await c.post('/api/me/contact/start', { field: 'phone', value: '6025550001' })).status, 400, 'number used by someone else');
  const s = await c.post('/api/me/contact/start', { field: 'phone', value: '480 555 0002' }); assert.equal(s.status, 200);
  const sms = db.get("SELECT * FROM outbox WHERE kind = 'code' ORDER BY id DESC LIMIT 1"); assert.equal(sms.to_addr, '4805550002');
  const done = await c.post('/api/me/contact/verify', { code: s.body.devCode }); assert.equal(done.body.me.phone, '4805550002');
  const p = await c.put('/api/me/profile', { firstName: 'Ann', lastName: 'Lee', state: 'Ohio', address: { street: '1 A St', city: 'Mesa', zip: '85201' } });
  assert.equal(p.body.me.address.city, 'Mesa');
});

test('draws: server-side, winners notified, $999 / 12-month limit, claim and ship', async () => {
  // more entrants
  const clients = [];
  for (let i = 3; i <= 6; i++) { const c = new Client(); await signup(c, i); const { body: { survey } } = await c.get('/api/surveys/' + surveyId); assert.equal((await c.post(`/api/surveys/${surveyId}/submit`, { answers: fullAnswers(survey) })).status, 200); clients.push(c); }
  const d = await admin.post(`/api/admin/surveys/${surveyId}/draw`, {});
  assert.equal(d.status, 200, JSON.stringify(d.body)); assert.equal(d.body.winners.length, 3); assert.equal(d.body.poolSize, 5);
  assert.deepEqual(d.body.winners.map(w => [w.place, w.notes, w.goldOz]), [[1, 10, 0.01], [2, 5, 0.005], [3, 1, 0.001]]);
  assert.equal(new Set(d.body.winners.map(w => w.participantId)).size, 3, 'no one picked twice');
  assert.equal((await admin.post(`/api/admin/surveys/${surveyId}/draw`, {})).body.code, 'full');
  assert.ok(db.get("SELECT * FROM audit WHERE action = 'draw'"), 'draw is in the audit log');
  assert.equal(db.all("SELECT * FROM outbox WHERE kind = 'win'").length, 6, 'text + email per winner');
  // a winner logs in and claims
  const w = d.body.winners[0];
  const wc = [admin, ...clients].find(() => false) || null;
  const pid = w.participantId; const p = db.get('SELECT email, phone FROM participants WHERE id = ?', pid);
  const c = new Client(); const s = await c.post('/api/auth/start', { mode: 'login', email: p.email, phone: p.phone }); await c.post('/api/auth/verify', { code: s.body.devCode });
  const me = await c.get('/api/me'); assert.equal(me.body.wins[0].status, 'notified');
  assert.equal((await c.post(`/api/wins/${w.id}/claim`, { shipTo: { name: 'A', street: '1 St', city: 'Mesa', state: 'Arizona', zip: '85201' } })).status, 400, 'eligibility box required');
  assert.equal((await c.post(`/api/wins/${w.id}/claim`, { shipTo: { name: 'A', street: '1 St', city: 'Mesa', state: 'Arizona', zip: '85201' }, affidavit: true, consent: true })).status, 200);
  assert.equal((await new Client().get('/api/public')).body.winners.length, 1, 'only claimed + consented winners are public');
  assert.equal((await admin.post(`/api/admin/winners/${w.id}/ship`, { tracking: '9400' })).status, 200);
  const pubW = (await new Client().get('/api/public')).body.winners[0];
  assert.equal(pubW.estValue, undefined, 'no dollar values in public winners'); assert.ok(pubW.goldOz > 0 && pubW.place >= 1);
  // yearly limit: two $600 prizes (80 notes × $7.50). Everyone enters both; the first winner is skipped in the second draw.
  const s2 = { title: 'Big prize', status: 'live', questions: [Object.assign(newQuestion('text', 'q0'), { text: 'Hi' })], tiers: [{ place: 1, winners: 1, notes: 80 }], noteRate: 7.5 };
  assert.equal((await admin.put('/api/admin/surveys/s_test2', { survey: s2 })).status, 200);
  assert.equal((await admin.put('/api/admin/surveys/s_test3', { survey: s2 })).status, 200);
  for (const cl of [c, ...clients]) for (const id of ['s_test2', 's_test3']) assert.ok([200, 409].includes((await cl.post(`/api/surveys/${id}/submit`, { answers: { q0: 'x' } })).status)); // c may be one of clients
  const big1 = await admin.post('/api/admin/surveys/s_test2/draw', {}); assert.equal(big1.status, 200); assert.equal(big1.body.winners[0].estValue, 600);
  const bigWinner = big1.body.winners[0].participantId;
  let big2 = await admin.post('/api/admin/surveys/s_test3/draw', {}); assert.equal(big2.status, 200);
  for (let k = 0; k < 8; k++) { // repeat the draw: the $600 winner is never picked
    assert.notEqual(big2.body.winners[0].participantId, bigWinner);
    db.run('DELETE FROM winners WHERE survey_id = ?', 's_test3'); big2 = await admin.post('/api/admin/surveys/s_test3/draw', {}); }
  // and can't enter another $600 survey at all
  assert.equal((await admin.put('/api/admin/surveys/s_test4', { survey: s2 })).status, 200);
  const bw = db.get('SELECT email, phone FROM participants WHERE id = ?', bigWinner);
  const bc = new Client(); const st = await bc.post('/api/auth/start', { mode: 'login', email: bw.email, phone: bw.phone }); await bc.post('/api/auth/verify', { code: st.body.devCode });
  const open4 = await bc.get('/api/surveys/s_test4'); assert.equal(open4.status, 403); assert.equal(open4.body.code, 'limit');
  assert.equal((await bc.put('/api/surveys/s_test4/draft', { answers: { q0: 'x' } })).body.code, 'limit');
  const sub4 = await bc.post('/api/surveys/s_test4/submit', { answers: { q0: 'x' } }); assert.equal(sub4.body.code, 'limit');
  const meB = await bc.get('/api/me'); assert.ok(meB.body.limits.s_test4 && meB.body.limits.s_test4.until, 'app is told when they can enter again');
  assert.equal(meB.body.limits[surveyId], undefined);
  assert.ok(!JSON.stringify(meB.body).includes('600'), 'no dollar amounts sent to the participant');
  // the value is locked once people have entered
  assert.equal((await admin.put('/api/admin/surveys/s_test2', { survey: { ...s2, noteRate: 1 } })).body.survey.noteRate, 7.5);
});

test('campaign respects opt-in and language; unsubscribe link works', async () => {
  const before = db.get("SELECT COUNT(*) n FROM outbox WHERE kind = 'campaign'").n;
  const r = await admin.post('/api/admin/campaigns', { surveyId, sms: true, email: true, onlyNew: false });
  assert.equal(r.status, 200); assert.ok(r.body.recipients >= 5);
  const after = db.get("SELECT COUNT(*) n FROM outbox WHERE kind = 'campaign'").n; assert.equal(after - before, r.body.recipients * 2);
  const mail = db.get("SELECT body FROM outbox WHERE kind = 'campaign' AND channel = 'email' ORDER BY id DESC LIMIT 1");
  const link = JSON.parse(mail.body).text.match(/\/u\/([\w.-]+)/)[1];
  const u = await fetch(base + '/u/' + link); assert.equal(u.status, 200);
  assert.ok((await u.text()).includes('unsubscribed'));
});

test('CSV export and account deletion', async () => {
  const csv = await admin.get(`/api/admin/surveys/${surveyId}/export.csv?type=personal`); assert.equal(csv.status, 200);
  const pers = String(csv.body); assert.match(pers, /"Entry","First name","Last name","Email","Phone","State"/); assert.match(pers, /Test\d/); assert.match(pers, /@x\.com/);
  const anon = String((await admin.get(`/api/admin/surveys/${surveyId}/export.csv?type=anonymous`)).body);
  assert.match(anon, /^\ufeff?"Respondent","State","Language"/); assert.match(anon, /Arizona/);
  assert.ok(!/@|Test\d|Person|\(602\)|#[A-Z0-9]{6}/.test(anon), 'anonymous report has no names, emails, phones or entry numbers');
  const sum = String((await admin.get(`/api/admin/surveys/${surveyId}/export.csv?type=summary`)).body);
  assert.match(sum, /"Question","Answered","Answer","Percent","Count"/); assert.match(sum, /\d+(\.\d)?%/); assert.ok(!/@x\.com/.test(sum));
  assert.equal(db.get("SELECT COUNT(*) n FROM audit WHERE action = 'survey.export' AND detail LIKE '%anonymous%'").n, 1, 'downloads are logged by type');
  const c = new Client(); await signup(c, 20);
  assert.equal((await c.del('/api/me')).status, 200);
  assert.equal((await c.get('/api/me')).body.me, null, 'logged out after deletion');
  assert.equal((await c.put('/api/me/prefs', { optIn: true })).status, 401);
});

test('automatic reminders on day 3 and STOP texts turn off alerts', async () => {
  const { runReminderJob } = await import('../src/admin.js');
  const w = db.rowWinner(db.get("SELECT * FROM winners WHERE status = 'notified' LIMIT 1"));
  const four = Date.now() - 4 * 864e5;
  db.saveWinner({ ...w, notifiedAt: four, log: [{ at: four, kind: 'won' }] });
  const before = db.get("SELECT COUNT(*) n FROM outbox WHERE kind = 'reminder'").n;
  runReminderJob(); runReminderJob();
  const after = db.get("SELECT COUNT(*) n FROM outbox WHERE kind = 'reminder'").n;
  assert.equal(after - before, 2, 'one reminder (text + email), not repeated');
  const p = db.get('SELECT phone FROM participants LIMIT 1');
  const r = await fetch(base + '/api/webhooks/twilio', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: '+1' + p.phone, Body: 'STOP' }) });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(db.get('SELECT data FROM participants WHERE phone = ?', p.phone).data).optIn, false);
});

test('admin console can be limited to its own host', async () => {
  const { config } = await import('../src/config.js');
  config.adminHost = 'admin.example.com';
  try {
    assert.equal((await fetch(base + '/admin')).status, 404);
    assert.equal((await fetch(base + '/api/admin/me')).status, 404);
  } finally { config.adminHost = ''; }
});
