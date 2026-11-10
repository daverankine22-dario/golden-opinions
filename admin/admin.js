// Golden Opinions — admin console (staff only). Served at /admin; talks to /api/admin/*.
import * as sh from '/js/shared.js';
import { STATES, TYPES, LIKERT, LIKERT_ES, GB_CHOICES, WIN_CAP, CLAIM_DAYS, G_PER_OZ, GB_OZ, W_STATUS, fmtUSD, fmtPhone, fmtNum, winnerLabel, gbOf, noteParts, goldText, goldConv, shortPrize, winnersCountOf, answered, likertLabels, newQuestion, addDays, estValue, withUnit, L as Lsh } from '/js/shared.js';
import { esc, qInput } from '/js/ui.js';

const LOGO = '/img/logo.webp';
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const vals = o => Object.values(o || {});
const respId = (sid, pid) => sid + '__' + pid;
const T = en => en; const trStr = s => s; const curLang = () => 'en';
const prizeLabel = x => sh.prizeLabel(x, 'en');
const answerText = (q, v) => sh.answerText(q, v, 'en');
const fmtDate = t => t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDT = t => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const dayFmt = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
let toastT; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3500); }

/* ---------- state ---------- */
const S = { view: 'loading', admin: null, data: { surveys: {}, participants: {}, responses: {}, winners: {}, campaigns: {}, settings: {} }, today: '', adminTab: 'overview', edit: null, reportId: null, expanded: null, q: '', pq: '', sq: '', wf: 'all', camp: null, busy: false, login: {} };
const byId = arr => Object.fromEntries((arr || []).map(x => [x.id, x]));
const localDay = () => S.today;
const wStatus = w => sh.wStatus(w, S.today);
const surveys = () => vals(S.data.surveys).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
const liveSurveys = () => surveys().filter(s => s.status === 'live' && (!s.endsAt || s.endsAt >= S.today));
const respsFor = sid => vals(S.data.responses).filter(r => r.surveyId === sid);
const submittedFor = sid => respsFor(sid).filter(r => r.status === 'submitted');
const winners = () => vals(S.data.winners).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.notifiedAt || 0) - (a.notifiedAt || 0));
const statusChipW = w => { const [c, l] = W_STATUS[wStatus(w)]; return `<span class="chip ${c}">${l}</span>`; };
const gbRate = () => { const g = (S.data.settings || {}).goldback; return g && g.rate > 0 ? g : null; };
const wVal = w => w.estValue > 0 ? +w.estValue : estValue(w, (gbRate() || {}).rate || 0);
function wonLast12(pid, asOfDay, exceptId) {
  const asOf = asOfDay || S.today; const from = addDays(asOf, -365);
  return winners().filter(w => w.participantId === pid && w.id !== exceptId && wStatus(w) !== 'forfeited' && (w.date || '') > from && (w.date || '') <= asOf).reduce((a, w) => a + wVal(w), 0);
}
function goldTotal() { return winners().filter(w => wStatus(w) !== 'forfeited').reduce((s, w) => s + gbOf(w), 0); }
const goldTotalText = () => { const n = goldTotal(); return `${fmtNum(n)} Goldback${n === 1 ? '' : 's'} (${fmtNum((n * GB_OZ).toFixed(3))} oz · ${fmtNum((n * GB_OZ * G_PER_OZ).toFixed(2))} g)`; };
const drawDateOf = s => s.drawDate || s.endsAt || '';

/* ---------- API ---------- */
async function api(method, path, body) {
  let r;
  try { r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
  catch (e) { throw new Error("Can't reach the server. Check your connection and try again."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(j.error || 'Something went wrong.'); Object.assign(err, j, { status: r.status }); if (r.status === 401 && S.view === 'admin') { S.view = 'login'; render(); } throw err; }
  return j;
}
async function loadData() {
  const d = await api('GET', '/api/admin/data');
  S.today = d.today;
  S.data = { surveys: byId(d.surveys), participants: byId(d.participants), responses: byId(d.responses), winners: byId(d.winners), campaigns: byId(d.campaigns), settings: d.settings || {}, outbox: d.outbox, smsEnabled: d.smsEnabled, emailEnabled: d.emailEnabled };
}
async function busy(fn) { if (S.busy) return; S.busy = true; document.body.classList.add('busy'); try { return await fn(); } catch (e) { toast(e.message); } finally { S.busy = false; document.body.classList.remove('busy'); } }
async function refresh() { await loadData(); render(); }

function showModal(html) { S.modalOpen = true; $('#modal').innerHTML = `<div class="modal-bg" data-act="bgclose"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; }
function closeModal() { S.modalOpen = false; $('#modal').innerHTML = ''; }

/* ---------- rendering ---------- */
function render() {
  const app = $('#app');
  if (S.view === 'loading') { app.innerHTML = `<div class="wrap"><div class="loading"><div class="spin"></div></div></div>`; return; }
  app.innerHTML = S.view === 'login' ? viewLogin() : viewAdmin();
  app.querySelectorAll('[data-autofocus]').forEach(e => e.focus());
  poolPrev();
}
function viewLogin() {
  const L = S.login;
  return `<div class="wrap"><img class="logo" src="${LOGO}" alt="Golden Opinions" style="margin-top:40px">
  <div class="card"><h2>Admin console</h2>
  ${L.step === 'code' ? `<p class="muted small">We emailed a 6-digit code to ${esc(L.email)}.</p>${L.devCode ? `<div class="note"><b>Test mode:</b> your code is <b>${L.devCode}</b></div>` : ''}
    <form id="adminCodeForm"><label class="f" for="acode">Code</label><input class="in" id="acode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" data-autofocus style="letter-spacing:8px;text-align:center;font-size:22px">${L.err ? `<div class="err">${esc(L.err)}</div>` : ''}<div style="height:14px"></div><button class="btn gold block" type="submit">Verify</button></form>
    <p class="center"><button class="btn ghost sm" data-act="loginBack">Start over</button></p>`
  : `<form id="adminLoginForm"><label class="f" for="aemail">Email</label><input class="in" id="aemail" type="email" autocomplete="username" value="${esc(L.email || '')}" data-autofocus>
    <label class="f" for="apw">Password</label><input class="in" id="apw" type="password" autocomplete="current-password">${L.err ? `<div class="err">${esc(L.err)}</div>` : ''}<div style="height:14px"></div><button class="btn gold block" type="submit">Continue</button></form>`}
  </div><p class="center faint tiny">Staff only. Every sign-in is logged.</p></div>`;
}

/* ---------- screens (from the approved prototype) ---------- */
function goldFields(x,attr){
  const {qty,denom}=gbOf(x)?noteParts(x):{qty:1,denom:1};const unit=x.goldUnit==='g'?'g':'oz';
  const a=k=>attr==='name'?`name="${k}"`:`data-ef="${k}"`;
  const opts=[...GB_CHOICES];if(!opts.some(c=>c.n===denom))opts.push({n:denom,l:fmtNum(denom*GB_OZ)});
  const px={noteDenom:denom,noteQty:qty,goldbacks:denom*qty,goldUnit:unit};
  const rate=x.gbRate||(gbRate()||{}).rate;const v=estValue(px,rate);
  return `<div class="grid2" style="grid-template-columns:1.6fr .8fr 1fr">
    <div><label class="f">Goldback note</label><select class="in" ${a('noteDenom')} data-gprev="1">${opts.map(c=>`<option value="${c.n}" ${c.n===denom?'selected':''}>${fmtNum(c.n)} Goldback (${c.l} oz)</option>`).join('')}</select></div>
    <div><label class="f">Notes each</label><input class="in" type="number" min="1" max="50" step="1" ${a('noteQty')} value="${qty}" data-gprev="1"></div>
    <div><label class="f">Show gold in</label><select class="in" ${a('goldUnit')} data-gprev="1"><option value="oz" ${unit==='oz'?'selected':''}>oz</option><option value="g" ${unit==='g'?'selected':''}>grams</option></select></div></div>
    <div class="faint tiny" style="margin-top:6px">Prize${attr==='name'?'':' per winner'}: <b class="gprev">${esc(prizeLabel(px))}</b> <span class="gconv">${esc(goldConv(px.goldbacks,unit))}</span> <span class="gval goldtext" style="font-weight:800">${v?'· est. value '+fmtUSD(v):''}</span></div>`;
}
function readGold(get){const denom=Number(get('noteDenom'))||Number(get('goldbacks'))||0;const qty=Math.max(1,Math.min(50,parseInt(get('noteQty'))||1));const n=denom*qty;return {noteDenom:denom,noteQty:qty,goldbacks:n,goldAmt:+(n*GB_OZ).toFixed(6),goldUnit:get('goldUnit')==='g'?'g':'oz'}}
function gPrev(el){
  const box=el.closest('form,.card');if(!box)return;
  const q=k=>box.querySelector(`[data-ef="${k}"],[name="${k}"]`);
  const x=readGold(k=>{const e=q(k);return e?e.value:''});
  if(S.edit&&el.dataset.ef)Object.assign(S.edit,x);
  const pv=box.querySelector('.gprev'),cv=box.querySelector('.gconv'),gv=box.querySelector('.gval');
  if(pv)pv.textContent=prizeLabel(x)||'—';
  if(cv)cv.textContent=goldConv(x.goldbacks,x.goldUnit);
  const ri=box.querySelector('[name="gbRate"]');const rate=ri?Number(ri.value):(gbRate()||{}).rate;const v=estValue(x,rate);
  if(gv)gv.textContent=v?'· est. value '+fmtUSD(v):'';
  poolPrev();
}
function poolPrev(){const el=$('#poolLine');if(!el||!S.edit)return;const n=winnersCountOf(S.edit);const r=(gbRate()||{}).rate;const v=estValue(S.edit,r);el.innerHTML=`Prize pool: <b>${n} winner${n===1?'':'s'}</b> × ${esc(shortPrize(S.edit))}${v?` = <b>${fmtUSD(n*v)}</b> est. total`:''}${v>WIN_CAP?` <span style="color:#ffb4ab">· each prize is over the $${WIN_CAP} limit</span>`:''}`}

/* ---------- admin ---------- */
function viewAdmin(){
  const tabs=[['overview','Overview'],['surveys','Surveys & reports'],['campaigns','Campaigns'],['winners','Winners'],['participants','Participants']];
  const t=S.adminTab;
  let body='';
  if(t==='overview')body=adOverview();
  else if(t==='surveys')body=adSurveys();
  else if(t==='build')body=adBuild();
  else if(t==='report')body=adReport();
  else if(t==='campaigns')body=adCampaigns();
  else if(t==='winners')body=adWinners();
  else if(t==='participants')body=adParticipants();
  const active=t==='build'||t==='report'?'surveys':t;
  return `<div class="wrap wide">
  <div class="admin-top"><img src="${LOGO}" alt="Golden Opinions"><div style="flex:1"><div style="font-weight:900;font-size:18px">Admin console</div><div class="faint small">${esc(S.admin.email)} · ${S.data.smsEnabled?'Texts on':'<span style="color:#fde68a">Texts in TEST MODE</span>'} · ${S.data.emailEnabled?'Email on':'<span style="color:#fde68a">Email in TEST MODE</span>'}${S.data.outbox&&S.data.outbox.failed?` · <span style="color:#ffb4ab">${S.data.outbox.failed} messages failed</span>`:''}</div></div><a class="btn sm" href="/" target="_blank" rel="noopener">Participant app ↗</a><button class="btn sm ghost" data-act="refresh">↻ Refresh</button><button class="btn sm ghost" data-act="logout">Log out</button></div>
  <div class="tabs">${tabs.map(([k,l])=>`<button class="tab ${active===k?'on':''}" data-act="atab" data-k="${k}">${l}</button>`).join('')}</div>
  ${body}
  </div>`;
}
function goldPriceCard(){
  const g=gbRate();
  return `<form id="priceForm" class="card" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start"><div><h3 style="margin:0">Goldback exchange rate</h3>
    <div class="faint small" style="margin-top:4px">Used for each prize's estimated value. Goldback publishes the official rate daily at 10 AM MST on <a href="https://www.goldback.com" target="_blank" rel="noopener">goldback.com</a> — update it here on each drawing day.</div></div>
    ${g?`<span class="chip ok">${fmtUSD(g.rate)} per Goldback · updated ${fmtDT(g.updatedAt)}</span>`:'<span class="chip warn">Not set — estimates are hidden</span>'}</div>
    <div class="toolbar" style="margin:12px 0 0"><span style="font-weight:800">$</span><input class="in" name="price" type="number" min="0" step="0.01" placeholder="Rate for 1 Goldback (USD)" value="${g?esc(g.rate):''}" style="max-width:220px"><span class="muted small">per 1 Goldback</span><button class="btn gold sm" type="submit">Save rate</button></div>
    ${g?`<div class="faint tiny" style="margin-top:8px">${GB_CHOICES.map(c=>`${c.n} Goldback = ${fmtUSD(c.n*g.rate)}`).join(' · ')}</div>`:''}
  </form>`;
}
function adOverview(){
  const sub=vals(S.data.responses).filter(r=>r.status==='submitted');
  const drafts=vals(S.data.responses).filter(r=>r.status!=='submitted');
  const recent=sub.sort((a,b)=>b.submittedAt-a.submittedAt).slice(0,8);
  const empty=!surveys().length;
  return `${empty?`<div class="goldcard" style="margin-bottom:16px"><div style="font-weight:900;font-size:17px">Welcome! You don't have any surveys yet.</div><div class="muted small" style="margin:4px 0 10px">Load a sample survey that uses all 8 answer types, or start from scratch.</div><button class="btn sm" style="border-color:#7a4b00;color:#3a2500" data-act="sample">Load sample survey</button> <button class="btn sm" style="border-color:#7a4b00;color:#3a2500" data-act="newSurvey">Create a survey</button></div>`:''}
  ${goldPriceCard()}
  <div class="tiles">
    <div class="card tile"><div class="k">Live surveys</div><div class="v">${liveSurveys().length}</div></div>
    <div class="card tile"><div class="k">Participants</div><div class="v">${vals(S.data.participants).length}</div><div class="faint tiny">${vals(S.data.participants).filter(p=>p.optIn).length} opted in to alerts</div></div>
    <div class="card tile"><div class="k">Completed entries</div><div class="v">${sub.length}</div><div class="faint tiny">${drafts.length} drafts in progress</div></div>
    <div class="card tile"><div class="k">Gold winners</div><div class="v">${winners().filter(w=>wStatus(w)!=='forfeited').length}</div><div class="faint tiny">${winners().filter(w=>wStatus(w)==='notified').length} awaiting claim · ${winners().filter(w=>wStatus(w)==='claimed').length} to ship · ${winners().filter(w=>wStatus(w)==='expired').length} past deadline</div><div class="faint tiny">${goldTotalText()} awarded${winners().some(w=>w.estValue)?' · est. '+fmtUSD(winners().reduce((a,w)=>a+(w.estValue||0),0)):''}</div></div>
  </div>
  <div class="card"><h3>Latest entries</h3>${recent.length?`<div class="tscroll"><table class="t"><tr><th>When</th><th>Survey</th><th>Entry</th><th>Email</th></tr>${recent.map(r=>`<tr class="click" data-act="openReport" data-id="${esc(r.surveyId)}"><td>${fmtDT(r.submittedAt)}</td><td>${esc((S.data.surveys[r.surveyId]||{}).title||'(deleted)')}</td><td>#${esc(r.entryNo)}</td><td>${esc(r.email)}</td></tr>`).join('')}</table></div>`:'<div class="muted small">No entries yet.</div>'}</div>`;
}
function adSurveys(){
  const q=S.sq.toLowerCase();
  const list=surveys().filter(s=>!q||(s.title+' '+(s.description||'')).toLowerCase().includes(q));
  return `<div class="toolbar"><input class="in" placeholder="Search surveys…" data-bind="sq" value="${esc(S.sq)}"><span style="flex:1"></span><button class="btn sm" data-act="sample">+ Sample survey</button><button class="btn gold sm" data-act="newSurvey">+ New survey</button></div>
  <div class="card tscroll"><table class="t"><tr><th>Survey</th><th>Status</th><th>Questions</th><th>Entries</th><th>Drafts</th><th>Ends</th><th></th></tr>
  ${list.map(s=>{const r=respsFor(s.id);const sub=r.filter(x=>x.status==='submitted').length;
    return `<tr><td><b>${esc(s.title)}</b><div class="faint tiny">Created ${fmtDate(s.createdAt)} · ${surveyEsReady(s)?'<span style="color:#bbf7d0">ES ✓</span>':'ES incomplete'}</div></td><td>${statusChip(s)}</td><td>${(s.questions||[]).length}</td><td><b>${sub}</b></td><td>${r.length-sub}</td><td>${s.endsAt?fmtDate(s.endsAt+'T12:00'):'—'}</td>
    <td style="white-space:nowrap"><button class="btn gold sm" data-act="openReport" data-id="${esc(s.id)}">Report</button> <button class="btn sm" data-act="editSurvey" data-id="${esc(s.id)}">Edit</button> <button class="btn sm ghost" data-act="dupSurvey" data-id="${esc(s.id)}">Duplicate</button></td></tr>`}).join('')||`<tr><td colspan="7" class="muted">No surveys${q?' match your search':' yet'}.</td></tr>`}
  </table></div>`;
}
function statusChip(s){
  const ended=s.endsAt&&new Date(s.endsAt+'T23:59:59')<new Date();
  if(s.status==='live'&&!ended)return '<span class="chip ok">● Live</span>';
  if(s.status==='live'&&ended)return '<span class="chip off">Ended</span>';
  if(s.status==='closed')return '<span class="chip off">Closed</span>';
  return '<span class="chip warn">Draft</span>';
}
/* builder */
function adBuild(){
  const s=S.edit;if(!s)return '';
  const isNew=!S.data.surveys[s.id];
  const entries=submittedFor(s.id).length;
  return `<div class="toolbar"><button class="btn sm" data-act="atab" data-k="surveys">← All surveys</button><span style="flex:1"></span><button class="btn sm" data-act="preview">Preview on phone</button>${!isNew?'<button class="btn sm danger" data-act="delSurvey">Delete</button>':''}<button class="btn gold sm" data-act="saveSurvey">Save survey</button></div>
  ${entries?`<div class="note" style="margin-bottom:12px">This survey already has ${entries} entr${entries===1?'y':'ies'}. Changing or removing questions may make older answers harder to compare.</div>`:''}
  <div class="split">
  <div>
    <div class="card">
      <h3>${isNew?'New survey':'Edit survey'}</h3>
      <label class="f">Title</label><input class="in" data-ef="title" value="${esc(s.title)}" placeholder="e.g. Coffee Habits 2026">
      <label class="f">Short description (shown to participants)</label><textarea class="in" data-ef="description" rows="2">${esc(s.description||'')}</textarea>
      <details style="margin-top:12px"><summary class="small" style="cursor:pointer;font-weight:800">🇪🇸 Español — title &amp; description ${surveyEsReady(s)?'<span class="chip ok">✓ Survey fully translated</span>':'<span class="chip warn">Spanish incomplete</span>'}</summary>
      <label class="f">Título (Español)</label><input class="in" data-ef="title_es" value="${esc(s.title_es||'')}" placeholder="${esc(s.title||'')}">
      <label class="f">Descripción (Español)</label><textarea class="in" data-ef="description_es" rows="2" placeholder="${esc(s.description||'')}">${esc(s.description_es||'')}</textarea></details>
      <h3 style="margin-top:16px">Winners &amp; prize</h3>
      <div class="grid2" style="grid-template-columns:1fr 2fr"><div><label class="f">Number of winners</label><input class="in" type="number" min="1" max="500" step="1" data-ef="winnersCount" value="${winnersCountOf(s)}"></div><div class="faint small" style="align-self:end;padding-bottom:10px">Each winner gets the prize below. Smaller prizes for more winners keeps people under the $${WIN_CAP} / 12-month limit.</div></div>
      ${goldFields(s,'ef')}
      <div class="small" id="poolLine" style="margin-top:8px"></div>
      ${gbRate()?'':`<div class="note" style="margin-top:8px">Set the Goldback exchange rate on the Overview tab to show an estimated value to participants.</div>`}
      ${gbRate()&&estValue(s,gbRate().rate)>WIN_CAP?`<div class="err">At today's rate this prize is worth ${fmtUSD(estValue(s,gbRate().rate))}, over the $${WIN_CAP} a person can win in 12 months. It can't be drawn.</div>`:''}
      <div class="grid2"><div><label class="f">End date (last day to enter)</label><input class="in" type="date" data-ef="endsAt" value="${esc(s.endsAt||'')}"></div>
      <div><label class="f">Drawing date</label><input class="in" type="date" data-ef="drawDate" value="${esc(s.drawDate||'')}"></div></div>
      <label class="f">Status</label>
      <select class="in" data-ef="status"><option value="draft" ${s.status==='draft'?'selected':''}>Draft — hidden from participants</option><option value="live" ${s.status==='live'?'selected':''}>Live — open for entries</option><option value="closed" ${s.status==='closed'?'selected':''}>Closed — no new entries</option></select>
    </div>
    ${(s.questions||[]).map((q,i)=>qEditor(q,i,s.questions.length)).join('')}
    <div class="card" style="margin-top:12px"><h3>Add a question</h3><div class="typegrid">${Object.entries(TYPES).map(([k,t])=>`<button class="btn sm" data-act="addQ" data-k="${k}" title="${esc(t.desc)}">+ ${t.name}</button>`).join('')}</div></div>
  </div>
  <div><div class="card" style="position:sticky;top:12px"><h3>Answer types</h3>${Object.entries(TYPES).map(([k,t])=>`<div style="padding:7px 0;border-top:1px solid var(--line)"><b class="small">${t.name}</b><div class="faint tiny">${t.desc}</div></div>`).join('')}<div class="faint tiny" style="margin-top:10px">Tip: use <b>Preview on phone</b> to try the survey exactly as participants see it. Previews are not saved.</div></div></div>
  </div>`;
}
function qEditor(q,i,n){
  const f=(k,v,ph='',type='text')=>`<input class="in" type="${type}" data-qf="${k}" data-i="${i}" value="${esc(v??'')}" placeholder="${esc(ph)}">`;
  const lines=(k,arr)=>`<textarea class="in" rows="${Math.min(8,Math.max(3,(arr||[]).length))}" data-qf="${k}" data-i="${i}" data-lines="1">${esc((arr||[]).join('\n'))}</textarea>`;
  let extra='';
  if(q.type==='single'||q.type==='dropdown'||q.type==='multi'){
    extra=`<label class="f">Options — one per line</label>${lines('options',q.options)}`;
    if(q.type==='multi')extra+=`<label class="f">Maximum selections (0 = no limit)</label>${f('max',q.max,'0','number')}`;
  }
  if(q.type==='likert'||q.type==='matrix'){
    if(q.type==='matrix')extra+=`<label class="f">Rows — one per line</label>${lines('rows',q.rows)}`;
    extra+=`<div class="grid2"><div><label class="f">Scale</label><select class="in" data-qf="scale" data-i="${i}" data-rerender="1">${['agreement','satisfaction','frequency'].map(x=>`<option ${q.scale===x?'selected':''} value="${x}">${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div><div><label class="f">Points</label><select class="in" data-qf="points" data-i="${i}" data-rerender="1">${[3,5,7].map(x=>`<option ${+q.points===x?'selected':''} value="${x}">${x}-point</option>`).join('')}</select></div></div><div class="faint tiny" style="margin-top:6px">${esc(likertLabels(q).join(' · '))}</div>`;
  }
  if(q.type==='rating')extra=`<div class="grid2"><div><label class="f">From</label><select class="in" data-qf="min" data-i="${i}"><option ${+q.min===0?'selected':''}>0</option><option ${+q.min===1?'selected':''}>1</option></select></div><div><label class="f">To</label><select class="in" data-qf="max" data-i="${i}"><option ${+q.max===5?'selected':''}>5</option><option ${+q.max===10?'selected':''}>10</option></select></div><div><label class="f">Low-end label</label>${f('lowLabel',q.lowLabel,'Not likely at all')}</div><div><label class="f">High-end label</label>${f('highLabel',q.highLabel,'Very likely')}</div></div>`;
  if(q.type==='slider')extra=`<div class="grid2"><div><label class="f">Min</label>${f('min',q.min,'0','number')}</div><div><label class="f">Max</label>${f('max',q.max,'100','number')}</div><div><label class="f">Step</label>${f('step',q.step,'1','number')}</div><div><label class="f">Unit (optional)</label>${f('unit',q.unit,'e.g. $, %, hrs')}</div></div>`;
  if(q.type==='text')extra=`<div class="grid2"><div><label class="f">Placeholder</label>${f('placeholder',q.placeholder,'Type your answer')}</div><div><label class="f">Max characters</label>${f('maxLength',q.maxLength,'120','number')}</div></div>`;
  return `<div class="qcard">
    <div class="qhead"><span class="chip warn">Q${i+1} · ${TYPES[q.type].name}</span><span>
      <button class="btn sm ghost" data-act="mvQ" data-i="${i}" data-d="-1" ${i===0?'disabled':''} aria-label="Move up">↑</button>
      <button class="btn sm ghost" data-act="mvQ" data-i="${i}" data-d="1" ${i===n-1?'disabled':''} aria-label="Move down">↓</button>
      <button class="btn sm ghost" data-act="dupQ" data-i="${i}">Copy</button>
      <button class="btn sm ghost" data-act="rmQ" data-i="${i}" style="color:#ffb4ab">Remove</button></span></div>
    <label class="f">Question</label>${f('text',q.text,'Type the question')}
    <div class="grid2"><div><label class="f">Answer type</label><select class="in" data-qf="type" data-i="${i}" data-rerender="1">${Object.entries(TYPES).map(([k,t])=>`<option value="${k}" ${q.type===k?'selected':''}>${t.name}</option>`).join('')}</select></div>
    <div><label class="check" style="margin-top:38px"><input type="checkbox" data-qf="required" data-i="${i}" ${q.required?'checked':''}><span>Required</span></label></div></div>
    ${extra}
    ${esBlock(q,i)}
  </div>`;
}
function esBlock(q,i){
  const f=(k,v,ph)=>`<input class="in" data-qf="${k}" data-i="${i}" value="${esc(v??'')}" placeholder="${esc(ph||'')}">`;
  const lines=(k,arr,en)=>`<textarea class="in" rows="${Math.min(8,Math.max(3,(en||[]).length))}" data-qf="${k}" data-i="${i}" data-lines="1" placeholder="${esc((en||[]).join('\n'))}">${esc((arr||[]).join('\n'))}</textarea>`;
  const missing=qMissingEs(q);
  let x=`<label class="f">Pregunta (Español)</label>${f('text_es',q.text_es,q.text)}`;
  if(['single','multi','dropdown'].includes(q.type)&&!(q.type==='dropdown'&&JSON.stringify(q.options)===JSON.stringify(STATES)))x+=`<label class="f">Opciones (Español) — one per line, same order as English</label>${lines('options_es',q.options_es,q.options)}`;
  if(q.type==='matrix')x+=`<label class="f">Filas (Español) — same order as English</label>${lines('rows_es',q.rows_es,q.rows)}`;
  if(q.type==='rating')x+=`<div class="grid2"><div><label class="f">Low-end label (Español)</label>${f('lowLabel_es',q.lowLabel_es,q.lowLabel)}</div><div><label class="f">High-end label (Español)</label>${f('highLabel_es',q.highLabel_es,q.highLabel)}</div></div>`;
  if(q.type==='text')x+=`<label class="f">Placeholder (Español)</label>${f('placeholder_es',q.placeholder_es,q.placeholder)}`;
  if(q.type==='likert'||q.type==='matrix')x+=`<div class="faint tiny" style="margin-top:6px">Scale in Spanish (automatic): ${esc(((LIKERT_ES[q.scale]||LIKERT_ES.agreement)[q.points]||[]).join(' · '))}</div>`;
  return `<details style="margin-top:12px" ${missing?'':''}><summary class="small" style="cursor:pointer;font-weight:800">🇪🇸 Español ${missing?`<span class="chip warn">${missing} missing</span>`:'<span class="chip ok">✓ Translated</span>'}</summary>${x}<div class="faint tiny" style="margin-top:6px">Anything left blank shows in English. Answers are always saved in English so reports stay in one language.</div></details>`;
}
function qMissingEs(q){
  let m=0;const blank=v=>!String(v||'').trim();
  if(blank(q.text_es))m++;
  const arr=(k)=>{const en=q[k]||[],es=q[k+'_es']||[];return en.filter((_,j)=>blank(es[j])).length};
  if(['single','multi','dropdown'].includes(q.type)&&!(q.type==='dropdown'&&JSON.stringify(q.options)===JSON.stringify(STATES)))m+=arr('options');
  if(q.type==='matrix')m+=arr('rows');
  if(q.type==='rating'){if(q.lowLabel&&blank(q.lowLabel_es))m++;if(q.highLabel&&blank(q.highLabel_es))m++}
  return m;
}
const surveyEsReady=s=>String(s.title_es||'').trim()&&(s.questions||[]).every(q=>!qMissingEs(q));
/* report */
function summarize(q,rs){
  const vs=rs.map(r=>(r.answers||{})[q.id]).filter(v=>answered(q,v)||(q.type==='matrix'&&v));
  const n=vs.length;
  const bars=(pairs,total)=>{const mx=Math.max(1,...pairs.map(p=>p[1]));return `<div class="bars">${pairs.map(([l,c])=>`<div class="bar" title="${esc(l)}: ${c} (${total?Math.round(c/total*100):0}%)"><span class="lbl">${esc(l)}</span><span class="track"><span class="fill" style="display:block;width:${c/mx*100}%"></span></span><span class="n">${c} · ${total?Math.round(c/total*100):0}%</span></div>`).join('')}</div>`};
  let body='';
  if(['single','dropdown','likert'].includes(q.type)){
    const opts=q.type==='likert'?likertLabels(q):q.options||[];
    let pairs=opts.map(o=>[o,vs.filter(v=>v===o).length]);
    if(pairs.length>12){const top=[...pairs].sort((a,b)=>b[1]-a[1]).slice(0,10);const rest=pairs.length-10;const restN=n-top.reduce((a,p)=>a+p[1],0);pairs=[...top,[`${rest} other options`,restN]]}
    body=bars(pairs,n);
    if(q.type==='likert'&&n){const avg=vs.reduce((s,v)=>s+opts.indexOf(v)+1,0)/n;body=`<div class="kv"><div><b>${avg.toFixed(2)}</b><span>average (1–${opts.length})</span></div></div>`+body}
  }else if(q.type==='multi'){
    body=bars((q.options||[]).map(o=>[o,vs.filter(v=>v.includes(o)).length]),n)+`<div class="faint tiny" style="margin-top:6px">% of respondents who picked each option (multiple allowed)</div>`;
  }else if(q.type==='rating'){
    const nums=vs.map(Number);const avg=n?nums.reduce((a,b)=>a+b,0)/n:0;const r=[];for(let i=+q.min;i<=+q.max;i++)r.push([String(i),nums.filter(x=>x===i).length]);
    let nps='';if(+q.min===0&&+q.max===10&&n){const pro=nums.filter(x=>x>=9).length,det=nums.filter(x=>x<=6).length;nps=`<div><b>${Math.round((pro-det)/n*100)}</b><span>NPS</span></div>`}
    body=`<div class="kv"><div><b>${n?avg.toFixed(1):'—'}</b><span>average</span></div>${nps}</div>`+bars(r,n);
  }else if(q.type==='slider'){
    const nums=vs.map(Number).sort((a,b)=>a-b);const avg=n?nums.reduce((a,b)=>a+b,0)/n:0;const med=n?nums[Math.floor(n/2)]:0;
    const U=x=>n?esc(withUnit(x,q.unit)):'—';
    body=`<div class="kv"><div><b>${U(avg.toFixed(1))}</b><span>average</span></div><div><b>${U(med)}</b><span>median</span></div><div><b>${n?U(nums[0])+' – '+U(nums[n-1]):'—'}</b><span>range</span></div></div>`;
  }else if(q.type==='matrix'){
    const labs=likertLabels(q);
    body=`<div class="tscroll"><table class="t"><tr><th></th>${labs.map(l=>`<th style="text-transform:none;letter-spacing:0">${esc(l)}</th>`).join('')}<th>Avg</th></tr>${(q.rows||[]).map(r=>{const rv=vs.map(v=>v[r]).filter(Boolean);const avg=rv.length?rv.reduce((s,x)=>s+labs.indexOf(x)+1,0)/rv.length:0;
      return `<tr><td><b>${esc(r)}</b></td>${labs.map(l=>{const c=rv.filter(x=>x===l).length;const pct=rv.length?c/rv.length:0;return `<td title="${c} of ${rv.length}" style="background:rgba(242,196,74,${(pct*.75).toFixed(2)});text-align:center">${c}</td>`}).join('')}<td><b>${rv.length?avg.toFixed(2):'—'}</b></td></tr>`}).join('')}</table></div>`;
  }else if(q.type==='text'){
    body=`<div class="answers-list">${vs.slice(-50).reverse().map(v=>`<div>${esc(v)}</div>`).join('')||'<div class="faint">No answers yet</div>'}</div>`;
  }
  return `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><h3 style="margin:0">${esc(q.text)}</h3><span class="chip">${TYPES[q.type].name}</span></div><div class="faint tiny" style="margin-top:4px">${n} answered</div>${body}</div>`;
}
function adReport(){
  const s=S.data.surveys[S.reportId];if(!s)return '<div class="card">Survey not found.</div>';
  const all=respsFor(s.id);const sub=all.filter(r=>r.status==='submitted');
  const q=S.q.toLowerCase();
  const filtered=sub.filter(r=>{if(!q)return true;const hay=[r.email,r.phone,fmtPhone(r.phone),'#'+r.entryNo,...(s.questions||[]).map(x=>answerText(x,(r.answers||{})[x.id]))].join(' ').toLowerCase();return hay.includes(q)}).sort((a,b)=>b.submittedAt-a.submittedAt);
  const sw=winners().filter(w=>w.surveyId===s.id&&wStatus(w)!=='forfeited');
  const rate=all.length?Math.round(sub.length/all.length*100):0;
  return `<div class="toolbar"><button class="btn sm" data-act="atab" data-k="surveys">← All surveys</button><span style="flex:1"></span><button class="btn sm" data-act="editSurvey" data-id="${esc(s.id)}">Edit survey</button><a class="btn sm" href="/api/admin/surveys/${encodeURIComponent(s.id)}/export.csv">Download CSV</a>${(()=>{const need=winnersCountOf(s)-sw.length;return need>0?`<button class="btn gold sm" data-act="draw" ${sub.length?'':'disabled'}>🎲 Draw ${need===1?'a winner':need+' winners'}</button>`:'<button class="btn sm" disabled>✓ All winners drawn</button>'})()}</div>
  <h2>${esc(s.title)} ${statusChip(s)}</h2>
  <div class="tiles" style="margin-top:12px">
    <div class="card tile"><div class="k">Completed entries</div><div class="v">${sub.length}</div></div>
    <div class="card tile"><div class="k">Started, not submitted</div><div class="v">${all.length-sub.length}</div></div>
    <div class="card tile"><div class="k">Completion rate</div><div class="v">${all.length?rate+'%':'—'}</div></div>
    <div class="card tile"><div class="k">Winners drawn</div><div class="v">${sw.length} <span class="faint" style="font-size:16px">of ${winnersCountOf(s)}</span></div><div class="faint tiny">${sw.slice(0,4).map(w=>esc(winnerLabel(w))).join(', ')}${sw.length>4?` and ${sw.length-4} more`:''}</div></div>
  </div>
  <div class="split">
    <div>${(s.questions||[]).map(x=>summarize(x,sub)).join('')}</div>
    <div><div class="card" style="position:sticky;top:12px"><h3>Responses</h3>
      <input class="in" style="font-size:14px;padding:10px 12px" placeholder="Search email, phone, entry # or any answer…" data-bind="q" value="${esc(S.q)}">
      <div class="faint tiny" style="margin:8px 0">${filtered.length} of ${sub.length} shown</div>
      <div style="max-height:70vh;overflow:auto"><table class="t"><tr><th>Entry</th><th>Contact</th><th>Submitted</th></tr>
      ${filtered.map(r=>`<tr class="click" data-act="expand" data-id="${esc(r.id)}"><td><b>#${esc(r.entryNo)}</b></td><td>${esc(r.email)}<div class="faint tiny">${esc(fmtPhone(r.phone))}</div></td><td class="small">${fmtDT(r.submittedAt)}</td></tr>
      ${S.expanded===r.id?`<tr><td colspan="3"><div style="background:rgba(255,255,255,.05);border-radius:10px;padding:10px">${(s.questions||[]).map(x=>`<div style="margin-bottom:8px"><div class="faint tiny">${esc(x.text)}</div><div class="small" style="font-weight:700">${esc(answerText(x,(r.answers||{})[x.id])||'—')}</div></div>`).join('')}</div></td></tr>`:''}`).join('')||'<tr><td colspan="3" class="muted small">No matching responses.</td></tr>'}
      </table></div></div></div>
  </div>`;
}
/* campaigns */
function adCampaigns(){
  const d=S.camp||(S.camp={title:'New survey — win gold!',message:'',surveyId:(liveSurveys()[0]||{}).id||'',email:true,sms:true,onlyNew:true});
  const s=S.data.surveys[d.surveyId];
  const aud=audience(d);
  const msg=d.message||(s?`A new Golden Opinions survey is live: "${s.title}". Answer a few questions for a chance to win ${prizeLabel(s)||'gold'}!`:'');
  const hist=vals(S.data.campaigns).sort((a,b)=>b.sentAt-a.sentAt);
  return `<div class="split"><div class="card">
    <h3>Announce a new campaign</h3><p class="muted small" style="margin-top:0">Sends to participants who opted in to alerts. Recipients also see it in their in-app Messages.</p>
    <label class="f">Survey to promote</label><select class="in" data-cf="surveyId" data-rerender="1"><option value="">Choose…</option>${liveSurveys().map(x=>`<option value="${esc(x.id)}" ${x.id===d.surveyId?'selected':''}>${esc(x.title)}</option>`).join('')}</select>
    <label class="f">Headline</label><input class="in" data-cf="title" value="${esc(d.title)}">
    <label class="f">Headline (Español)</label><input class="in" data-cf="title_es" value="${esc(d.title_es||'')}" placeholder="¡Nueva encuesta — gana oro!">
    <label class="f">Message <span class="faint" id="cc">${msg.length} chars${msg.length>160?' · over 1 SMS segment':''}</span></label><textarea class="in" data-cf="message" rows="3" placeholder="${esc(msg)}">${esc(d.message)}</textarea>
    <label class="f">Message (Español) <span class="faint">— sent to people who chose Spanish; leave blank for an automatic Spanish announcement</span></label><textarea class="in" data-cf="message_es" rows="3">${esc(d.message_es||'')}</textarea>
    <label class="check"><input type="checkbox" data-cf="sms" ${d.sms?'checked':''}><span>Send as text message (SMS)</span></label>
    <label class="check"><input type="checkbox" data-cf="email" ${d.email?'checked':''}><span>Send as email</span></label>
    <label class="check"><input type="checkbox" data-cf="onlyNew" data-rerender="1" ${d.onlyNew?'checked':''}><span>Skip people who already entered this survey</span></label>
    <div class="goldcard" style="margin-top:14px;padding:12px"><b>${aud.length}</b> opted-in recipient${aud.length===1?'':'s'}</div>
    <div style="height:12px"></div>
    <button class="btn gold block" data-act="sendCamp" ${d.surveyId&&(d.sms||d.email)?'':'disabled'}>Send campaign</button>
    <p class="faint tiny">Sends right away to everyone counted above. Texts include "Reply STOP to opt out" and emails include an unsubscribe link.</p>
  </div>
  <div><div class="card"><h3>Text preview</h3><div class="phone-msg">Golden Opinions: ${esc(msg)} Reply STOP to opt out.</div><h3 style="margin-top:16px">Email preview</h3><div class="email-prev"><div class="eh"><b>Subject:</b> ${esc(d.title)}</div><div class="eb">${esc(msg)}<br><br><span style="display:inline-block;background:#e3a51d;color:#fff;padding:8px 14px;border-radius:99px;font-weight:700">Take the survey</span><br><br><span style="font-size:11px;color:#889">No purchase necessary. Unsubscribe anytime.</span></div></div></div>
  <div class="card"><h3>Sent campaigns</h3>${hist.length?`<table class="t"><tr><th>Sent</th><th>Campaign</th><th>Recipients</th></tr>${hist.map(c=>`<tr><td class="small">${fmtDT(c.sentAt)}</td><td><b>${esc(c.title)}</b><div class="faint tiny">${esc((S.data.surveys[c.surveyId]||{}).title||'')} · ${[c.sms&&'SMS',c.email&&'Email'].filter(Boolean).join(' + ')}</div></td><td>${c.recipients}</td></tr>`).join('')}</table>`:'<div class="muted small">None yet.</div>'}</div></div></div>`;
}
function audience(d){
  return vals(S.data.participants).filter(p=>p.optIn&&!(d.onlyNew&&d.surveyId&&S.data.responses[respId(d.surveyId,p.id)]&&S.data.responses[respId(d.surveyId,p.id)].status==='submitted'));
}
/* winners */
function adWinners(){
  const f=S.wf||'all';
  const all=winners();
  const cnt=k=>all.filter(w=>k==='all'||wStatus(w)===k).length;
  const list=all.filter(w=>f==='all'||wStatus(w)===f);
  const tabs=[['all','All'],['notified','Awaiting claim'],['expired','Past deadline'],['claimed','To ship'],['shipped','Shipped']];
  const action=w=>{const st=wStatus(w);
    if(st==='notified')return `<button class="btn sm" data-act="remindWinner" data-id="${esc(w.id)}">Send reminder</button>`;
    if(st==='expired')return `<button class="btn gold sm" data-act="altWinner" data-id="${esc(w.id)}">Draw alternate</button>`;
    if(st==='claimed')return `<button class="btn gold sm" data-act="shipWinner" data-id="${esc(w.id)}">Mark shipped</button>`;
    return '';};
  const detail=w=>{const st=wStatus(w);const rem=(w.log||[]).filter(l=>l.kind==='reminder').length;
    if(st==='notified'){const d=Math.max(0,Math.round((new Date(w.claimDeadline+'T12:00')-new Date(localDay()+'T12:00'))/864e5));return `Notified ${fmtDT(w.notifiedAt)} by text &amp; email<br>Claim by ${dayFmt(w.claimDeadline)} (${d} day${d===1?'':'s'} left)<br>Reminders sent: ${rem} · auto on day 3 &amp; 7`}
    if(st==='expired')return `Deadline ${dayFmt(w.claimDeadline)} passed · ${rem} reminder${rem===1?'':'s'} sent`;
    if(st==='claimed'||st==='shipped')return `${w.claimedAt?'Claimed '+fmtDT(w.claimedAt):''}${w.shipTo?`<br>Ship to: ${esc(w.shipTo.name)}, ${esc(w.shipTo.street)}, ${esc(w.shipTo.city)}, ${esc(w.shipTo.state)} ${esc(w.shipTo.zip)}`:''}${st==='shipped'?`<br>Shipped ${fmtDate(w.shippedAt)}${w.tracking?' · '+esc(w.tracking):''}`:''}${w.consentPublish===false?'<br>Not shown publicly (no consent)':''}`;
    if(st==='forfeited')return 'Alternate winner drawn';return '';};
  return `<div class="toolbar">${tabs.map(([k,l])=>`<button class="btn sm ${f===k?'gold':''}" data-act="wfilter" data-k="${k}">${l} (${cnt(k)})</button>`).join('')}<span style="flex:1"></span><button class="btn sm" data-act="addWinner">+ Add winner manually</button></div>
  <div class="card tscroll"><table class="t"><tr><th>Drawn</th><th>Winner</th><th>Prize</th><th>Status</th><th></th></tr>
  ${list.map(w=>`<tr><td class="small">${dayFmt(w.date)}</td>
    <td><b>${esc(winnerLabel(w))}</b><div class="small">${esc(w.fullName||'')}</div>${w.contact?`<div class="faint tiny">${esc(w.contact)}</div>`:''}<div class="faint tiny">${esc((S.data.surveys[w.surveyId]||{}).title||'')}</div>${w.participantId?`<div class="faint tiny">12-month total: ${fmtUSD(wonLast12(w.participantId))} of $${WIN_CAP}</div>`:''}</td>
    <td>${esc(shortPrize(w))}${w.estValue?`<div class="faint tiny">est. ${fmtUSD(w.estValue)}${w.gbRate?` at ${fmtUSD(w.gbRate)}/GB`:''}</div>`:''}</td>
    <td>${statusChipW(w)}<div class="faint tiny" style="margin-top:6px;line-height:1.5">${detail(w)}</div></td>
    <td style="white-space:nowrap;text-align:right">${action(w)} <button class="btn sm ghost" data-act="editWinner" data-id="${esc(w.id)}">Edit</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">No winners here yet. Draw one from a survey report.</td></tr>'}
  </table></div>
  <p class="faint tiny">Winners are notified by text and email when drawn. Reminders go out automatically on day 3 and day 7; use Send reminder for an extra nudge.</p>`;
}
function winnerForm(w){
  return `<h2>${S.data.winners[w.id]?'Edit winner':'Add winner'}</h2>${w.contact?`<div class="note">Winner contact (private): ${esc(w.contact)}</div>`:''}
  <form id="winnerForm" data-id="${esc(w.id)}">
  ${w.fullName?`<div class="faint small" style="margin-top:8px">Full name (private): <b>${esc(w.fullName)}</b></div>`:''}
  ${w.participantId?`<div class="faint small">Won in last 12 months (excluding this prize): <b>${fmtUSD(wonLast12(w.participantId,w.date,w.id))}</b> of $${WIN_CAP} limit</div>`:''}
  <div class="grid2" style="grid-template-columns:2fr 1fr"><div><label class="f">First name</label><input class="in" name="firstName" value="${esc(w.firstName||'')}" placeholder="Betty" required data-wprev="1"></div><div><label class="f">Last initial</label><input class="in" name="lastInitial" maxlength="1" value="${esc(w.lastInitial||'')}" placeholder="W" data-wprev="1"></div></div>
  <label class="f">State</label><select class="in" name="state" required data-wprev="1"><option value="">Choose…</option>${STATES.map(x=>`<option ${w.state===x?'selected':''}>${x}</option>`).join('')}</select>
  <div class="goldcard" style="margin-top:12px;padding:10px 14px"><div class="muted tiny" style="font-weight:700">Shown publicly as</div><div id="wprev" style="font-weight:900;font-size:18px">${esc(winnerLabel({firstName:w.firstName||'—',lastInitial:w.lastInitial,state:w.state}))}</div></div>
  ${goldFields(w,'name')}
  <div class="grid2"><div><label class="f">Drawing date</label><input class="in" name="date" type="date" value="${esc(w.date||new Date().toISOString().slice(0,10))}"></div>
  <div><label class="f">Goldback rate that day ($ per Goldback)</label><input class="in" name="gbRate" type="number" min="0" step="0.01" value="${esc(w.gbRate||(gbRate()||{}).rate||'')}" placeholder="from goldback.com" data-gprev="1"></div></div>
  ${w.participantId&&(!S.data.winners[w.id]||wStatus(w)==='notified')?`<label class="f">Claim deadline</label><input class="in" name="claimDeadline" type="date" value="${esc(w.claimDeadline||addDays(localDay(),CLAIM_DAYS))}">`:''}
  <div style="display:flex;gap:10px;margin-top:18px">${S.data.winners[w.id]?'<button type="button" class="btn danger" data-act="delWinner">Delete</button>':''}<span style="flex:1"></span><button type="button" class="btn" data-act="closemodal">Cancel</button><button class="btn gold" type="submit">Save</button></div></form>`;
}
/* participants */
function adParticipants(){
  const q=S.pq.toLowerCase();
  const ps=vals(S.data.participants).filter(p=>!q||(p.email+' '+p.phone+' '+fmtPhone(p.phone)+' '+(p.firstName||'')+' '+(p.lastName||'')+' '+(p.state||'')).toLowerCase().includes(q)).sort((a,b)=>b.createdAt-a.createdAt);
  const done=pid=>vals(S.data.responses).filter(r=>r.participantId===pid&&r.status==='submitted').length;
  return `<div class="toolbar"><input class="in" placeholder="Search name, email, phone or state…" data-bind="pq" value="${esc(S.pq)}"><span class="muted small">${ps.length} participants</span></div>
  <div class="card tscroll"><table class="t"><tr><th>Name</th><th>State</th><th>Email</th><th>Phone</th><th>Alerts</th><th>Surveys completed</th><th>Won (12 mo)</th><th>Joined</th></tr>
  ${ps.map(p=>`<tr><td>${esc([p.firstName,p.lastName].filter(Boolean).join(' ')||'—')}</td><td>${esc(p.state||'—')}</td><td>${esc(p.email)}</td><td>${esc(fmtPhone(p.phone))}</td><td>${p.optIn?'<span class="chip ok">Opted in</span>':'<span class="chip off">Off</span>'}</td><td>${done(p.id)}</td><td>${(()=>{const v=wonLast12(p.id);return v?`${fmtUSD(v)}${v>WIN_CAP*0.8?' <span class="chip warn">near limit</span>':''}`:'—'})()}</td><td class="small">${fmtDate(p.createdAt)}</td></tr>`).join('')||'<tr><td colspan="8" class="muted">No participants yet.</td></tr>'}
  </table></div>`;
}


function sampleSurvey(){
  const Q=(t,o)=>Object.assign(newQuestion(t),o);
  const end=new Date(Date.now()+30*864e5).toISOString().slice(0,10);
  return {id:'s'+uid(),title:'Everyday Shopping Habits',title_es:'Hábitos de compra diarios',description:'Tell us how you shop for groceries and household items. Takes about 3 minutes.',description_es:'Cuéntanos cómo compras alimentos y artículos para el hogar. Toma unos 3 minutos.',winnersCount:10,noteDenom:10,noteQty:1,goldbacks:10,goldAmt:0.01,goldUnit:'oz',prize:'10 Goldback note (1/100 oz gold)',endsAt:end,status:'live',createdAt:Date.now(),questions:[
    Q('single',{text:'Where do you do most of your grocery shopping?',text_es:'¿Dónde haces la mayoría de tus compras de alimentos?',options:['Supermarket','Warehouse club','Discount store','Online delivery','Farmers market'],options_es:['Supermercado','Club de almacén','Tienda de descuento','Entrega en línea','Mercado de agricultores']}),
    Q('multi',{text:'Which of these did you buy online in the last month?',text_es:'¿Cuáles de estos compraste en línea el último mes?',options:['Groceries','Household supplies','Clothing','Electronics','Personal care','Pet supplies'],options_es:['Alimentos','Artículos para el hogar','Ropa','Electrónicos','Cuidado personal','Artículos para mascotas'],max:3}),
    Q('dropdown',{text:'Which state do you live in?',text_es:'¿En qué estado vives?',options:[...STATES]}),
    Q('likert',{text:'"I compare prices before buying everyday items."',text_es:'"Comparo precios antes de comprar artículos de uso diario."',scale:'agreement',points:5}),
    Q('rating',{text:'How likely are you to recommend your main store to a friend?',text_es:'¿Qué tan probable es que recomiendes tu tienda principal a un amigo?',min:0,max:10,lowLabel:'Not likely at all',lowLabel_es:'Nada probable',highLabel:'Very likely',highLabel_es:'Muy probable'}),
    Q('slider',{text:'About how much do you spend on groceries per week?',text_es:'¿Cuánto gastas aproximadamente en alimentos por semana?',min:0,max:500,step:10,unit:'$'}),
    Q('matrix',{text:'How satisfied are you with your main store on…',text_es:'¿Qué tan satisfecho estás con tu tienda principal en…',rows:['Prices','Product quality','Checkout speed','Staff friendliness'],rows_es:['Precios','Calidad de los productos','Rapidez en la caja','Amabilidad del personal'],scale:'satisfaction',points:5}),
    Q('text',{text:'What one thing would make shopping easier for you?',text_es:'¿Qué cosa haría más fácil tus compras?',required:false,placeholder:'Your idea',placeholder_es:'Tu idea',maxLength:140})
  ]};
}

/* ---------- actions ---------- */
const ACT = {
  async refresh() { await busy(refresh); toast('Up to date'); },
  async logout() { await busy(async () => { await api('POST', '/api/admin/logout'); S.view = 'login'; S.login = {}; render(); }); },
  loginBack() { S.login = { email: S.login.email }; render(); },
  atab(t) { S.adminTab = t.dataset.k; S.expanded = null; render(); window.scrollTo(0, 0); },
  newSurvey() { S.edit = { id: 's_' + uid(), title: '', description: '', winnersCount: 1, noteDenom: 1, noteQty: 1, goldbacks: 1, goldUnit: 'oz', endsAt: '', status: 'draft', questions: [newQuestion('single')] }; S.adminTab = 'build'; render(); },
  editSurvey(t) { S.edit = JSON.parse(JSON.stringify(S.data.surveys[t.dataset.id])); S.adminTab = 'build'; render(); window.scrollTo(0, 0); },
  dupSurvey(t) { const s = JSON.parse(JSON.stringify(S.data.surveys[t.dataset.id])); s.id = 's_' + uid(); s.title += ' (copy)'; s.status = 'draft'; delete s.createdAt; s.questions.forEach(q => q.id = 'q' + uid()); S.edit = s; S.adminTab = 'build'; render(); toast('Copy created — save to keep it'); },
  async sample() { const s = sampleSurvey(); await busy(async () => { await api('PUT', '/api/admin/surveys/' + s.id, { survey: s }); await loadData(); S.adminTab = 'surveys'; render(); toast('Sample survey added and set live'); }); },
  addQ(t) { S.edit.questions.push(newQuestion(t.dataset.k)); render(); setTimeout(() => { const c = document.querySelectorAll('.qcard'); c[c.length - 1] && c[c.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 30); },
  mvQ(t) { const i = +t.dataset.i, d = +t.dataset.d; const a = S.edit.questions; [a[i], a[i + d]] = [a[i + d], a[i]]; render(); },
  dupQ(t) { const i = +t.dataset.i; const q = JSON.parse(JSON.stringify(S.edit.questions[i])); q.id = 'q' + uid(); S.edit.questions.splice(i + 1, 0, q); render(); },
  rmQ(t) { S.edit.questions.splice(+t.dataset.i, 1); render(); },
  preview(t) { S.prevLang = t && t.dataset.k ? t.dataset.k : (S.prevLang || 'en'); const s = S.edit; const lang = S.prevLang;
    showModal(`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 style="margin:0">Preview</h2><div class="langtog"><button class="${lang === 'en' ? 'on' : ''}" data-act="preview" data-k="en">EN</button><button class="${lang === 'es' ? 'on' : ''}" data-act="preview" data-k="es">ES</button></div></div>
      <p class="faint small">How participants see each question (not interactive here).</p>
      <h3>${esc(sh.L(s, 'title', lang) || 'Untitled survey')}</h3><p class="muted small">${esc(sh.L(s, 'description', lang) || '')}</p>
      <div style="pointer-events:none">${(s.questions || []).map((q, i) => `<div class="card" style="margin-top:10px"><div class="faint tiny">Question ${i + 1} of ${s.questions.length}</div><p class="qtext" style="font-size:17px">${esc(sh.L(q, 'text', lang) || 'Untitled question')}${q.required ? ' <span class="req">*</span>' : ''}</p>${qInput(q, undefined, lang)}</div>`).join('')}</div>
      <div style="height:12px"></div><button class="btn gold block" data-act="closemodal">Close preview</button>`); },
  async saveSurvey() {
    const s = S.edit;
    await busy(async () => {
      try { await api('PUT', '/api/admin/surveys/' + s.id, { survey: s }); }
      catch (e) { if (e.problems) { showModal(`<h2>Almost there</h2><ul class="muted">${e.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul><button class="btn gold block" data-act="closemodal">OK</button>`); return; } throw e; }
      await loadData(); toast(s.status === 'live' ? 'Saved — survey is live' : 'Survey saved'); S.adminTab = 'surveys'; S.edit = null; render();
    });
  },
  delSurvey() { showModal(`<h2>Delete this survey?</h2><p class="muted">"${esc(S.edit.title)}" will be removed. Collected responses stay in the database. Surveys with winners can't be deleted — close them instead.</p><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" data-act="closemodal">Cancel</button><button class="btn danger" data-act="delSurveyYes">Delete</button></div>`); },
  async delSurveyYes() { await busy(async () => { await api('DELETE', '/api/admin/surveys/' + S.edit.id); closeModal(); S.edit = null; S.adminTab = 'surveys'; await refresh(); toast('Survey deleted'); }); },
  openReport(t) { S.reportId = t.dataset.id; S.adminTab = 'report'; S.q = ''; S.expanded = null; render(); window.scrollTo(0, 0); },
  expand(t) { S.expanded = S.expanded === t.dataset.id ? null : t.dataset.id; render(); },
  draw(t) {
    const s = S.data.surveys[S.reportId]; if (!s) return;
    const need = winnersCountOf(s) - winners().filter(w => w.surveyId === s.id && wStatus(w) !== 'forfeited').length;
    const count = t && t.dataset.count ? +t.dataset.count : need;
    const rate = (gbRate() || {}).rate || '';
    showModal(`<div class="center"><div class="coin" style="margin:0 auto 10px;width:64px;height:64px">🎲</div><h2>Draw ${count === 1 ? 'a winner' : count + ' winners'}</h2>
      <p class="muted small">Winners are picked at random on the server from eligible entries in "${esc(s.title)}". Anyone the prize would put over the $${WIN_CAP} / 12-month limit is skipped. Each winner is notified by text and email right away.</p></div>
      <form id="drawForm" data-count="${count}"><div class="faint small">Each wins <b>${esc(prizeLabel(s))}</b></div>
        <div class="grid2"><div><label class="f">Drawing date</label><input class="in" name="date" type="date" value="${S.today}"></div><div><label class="f">Claim deadline</label><input class="in" name="claimDeadline" type="date" value="${addDays(S.today, CLAIM_DAYS)}"></div></div>
        <label class="f">Goldback rate on drawing day ($ per Goldback)</label><input class="in" name="gbRate" type="number" min="0" step="0.01" value="${esc(rate)}" placeholder="from goldback.com">
        <div style="display:flex;gap:10px;margin-top:16px"><span style="flex:1"></span><button type="button" class="btn" data-act="closemodal">Cancel</button><button class="btn gold" type="submit">Draw &amp; notify</button></div></form>`);
  },
  wfilter(t) { S.wf = t.dataset.k; render(); },
  async remindWinner(t) { await busy(async () => { await api('POST', `/api/admin/winners/${t.dataset.id}/remind`); await refresh(); toast('Reminder sent by text & email'); }); },
  shipWinner(t) { const w = S.data.winners[t.dataset.id]; showModal(`<h2>Mark as shipped</h2><p class="muted small">${esc(shortPrize(w))} to ${esc(w.shipTo?.name || w.fullName || '')}${w.shipTo ? `, ${esc(w.shipTo.street)}, ${esc(w.shipTo.city)}, ${esc(w.shipTo.state)} ${esc(w.shipTo.zip)}` : ''}</p><form id="shipForm" data-id="${esc(w.id)}"><label class="f">Tracking number (optional)</label><input class="in" name="tracking" placeholder="e.g. 9400 1000 0000 0000 0000 00"><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px"><button type="button" class="btn" data-act="closemodal">Cancel</button><button class="btn gold" type="submit">Mark shipped &amp; notify</button></div></form>`); },
  altWinner(t) { const w = S.data.winners[t.dataset.id]; showModal(`<h2>Draw an alternate winner?</h2><p class="muted">${esc(w.fullName || winnerLabel(w))} didn't claim by ${dayFmt(w.claimDeadline)}. Their prize will be marked forfeited and you'll draw a new winner at random from the remaining entries in "${esc((S.data.surveys[w.surveyId] || {}).title || '')}".</p><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" data-act="closemodal">Cancel</button><button class="btn gold" data-act="altWinnerYes" data-id="${esc(w.id)}">Forfeit &amp; continue</button></div>`); },
  async altWinnerYes(t) { await busy(async () => { const r = await api('POST', `/api/admin/winners/${t.dataset.id}/forfeit`); await loadData(); S.reportId = r.surveyId; closeModal(); render(); ACT.draw({ dataset: { count: '1' } }); }); },
  addWinner() { S.pendingWinner = { id: null, date: S.today, noteDenom: 1, noteQty: 1, goldbacks: 1, goldUnit: 'oz', gbRate: (gbRate() || {}).rate }; showModal(winnerForm(S.pendingWinner)); },
  editWinner(t) { S.pendingWinner = { ...S.data.winners[t.dataset.id] }; showModal(winnerForm(S.pendingWinner)); },
  async delWinner() { await busy(async () => { await api('DELETE', '/api/admin/winners/' + S.pendingWinner.id); closeModal(); await refresh(); toast('Winner removed'); }); },
  async sendCamp() {
    const d = S.camp; const aud = audience(d);
    if (!confirmOnce('camp', `Send to ${aud.length} participant${aud.length === 1 ? '' : 's'} now?`)) return;
    await busy(async () => { const r = await api('POST', '/api/admin/campaigns', { surveyId: d.surveyId, title: d.title, title_es: d.title_es, message: d.message, message_es: d.message_es, sms: !!d.sms, email: !!d.email, onlyNew: !!d.onlyNew }); S.camp = null; await refresh(); toast(`Campaign sent to ${r.recipients} participant${r.recipients === 1 ? '' : 's'}`); });
  },
  closemodal() { closeModal(); },
  bgclose(t, e) { if (e.target === t) closeModal(); },
};
// two-click confirmation without browser dialogs
const pendingConfirm = {};
function confirmOnce(key, msg) { if (pendingConfirm[key] && Date.now() - pendingConfirm[key] < 6000) { delete pendingConfirm[key]; return true; } pendingConfirm[key] = Date.now(); toast(msg + ' Click again to confirm.'); return false; }

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act;
  if (t.tagName === 'A' || t.tagName === 'BUTTON') e.preventDefault();
  if (t.disabled) return;
  if (ACT[a]) ACT[a](t, e);
});
function wPrev() { const f = $('#winnerForm'); if (!f) return; const fd = new FormData(f); $('#wprev').textContent = winnerLabel({ firstName: String(fd.get('firstName') || '—'), lastInitial: String(fd.get('lastInitial') || ''), state: String(fd.get('state') || '') }); }
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.wprev) { wPrev(); return; }
  if (t.dataset.gprev && !t.dataset.ef) { gPrev(t); return; }
  if (t.dataset.bind) { const k = t.dataset.bind; S[k] = t.value; const pos = t.selectionStart; render(); const n = document.querySelector(`[data-bind="${k}"]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) { } } return; }
  if (t.dataset.ef && t.type !== 'checkbox') { S.edit[t.dataset.ef] = t.value; if (t.dataset.gprev) gPrev(t); if (t.dataset.ef === 'winnersCount') poolPrev(); return; }
  if (t.dataset.qf && t.type !== 'checkbox' && t.tagName !== 'SELECT') { setQF(t); return; }
  if (t.dataset.cf && t.type !== 'checkbox') { S.camp[t.dataset.cf] = t.value; const m = $('#cc'); if (m && t.dataset.cf === 'message') m.textContent = t.value.length + ' chars' + (t.value.length > 160 ? ' · over 1 SMS segment' : ''); return; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.wprev) { wPrev(); return; }
  if (t.dataset.gprev && !t.dataset.ef) { gPrev(t); return; }
  if (t.dataset.ef) { S.edit[t.dataset.ef] = t.value; if (t.dataset.gprev) gPrev(t); return; }
  if (t.dataset.qf) { setQF(t); if (t.dataset.rerender) render(); return; }
  if (t.dataset.cf) { S.camp[t.dataset.cf] = t.type === 'checkbox' ? t.checked : t.value; if (t.type === 'checkbox' || t.tagName === 'SELECT') render(); }
});
function setQF(t) {
  const q = S.edit.questions[+t.dataset.i]; const k = t.dataset.qf; let v = t.type === 'checkbox' ? t.checked : t.value;
  if (t.dataset.lines) v = v.split('\n').map(x => x.trim()).filter(Boolean);
  if (['max', 'min', 'step', 'points', 'maxLength'].includes(k) && !t.dataset.lines) v = v === '' ? '' : Number(v);
  if (k === 'type' && v !== q.type) { const nq = newQuestion(v); nq.id = q.id; nq.text = q.text; nq.text_es = q.text_es; nq.required = q.required; if (q.options && nq.options) nq.options = q.options; S.edit.questions[+t.dataset.i] = nq; return; }
  q[k] = v;
}
document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  if (f.id === 'adminLoginForm') {
    S.login = { email: $('#aemail').value.trim() };
    await busy(async () => { try { const r = await api('POST', '/api/admin/login', { email: S.login.email, password: $('#apw').value }); Object.assign(S.login, { step: 'code', devCode: r.devCode, err: '' }); } catch (err) { S.login.err = err.message; } render(); });
    return;
  }
  if (f.id === 'adminCodeForm') {
    await busy(async () => {
      try { await api('POST', '/api/admin/verify', { code: $('#acode').value }); const m = await api('GET', '/api/admin/me'); S.admin = m.admin; await loadData(); S.view = 'admin'; S.login = {}; render(); }
      catch (err) { S.login.err = err.message; render(); }
    });
    return;
  }
  if (f.id === 'priceForm') {
    const v = Number(new FormData(f).get('price'));
    await busy(async () => { await api('PUT', '/api/admin/settings/goldback', { rate: v }); await refresh(); toast('Goldback rate saved — estimates updated'); });
    return;
  }
  if (f.id === 'drawForm') {
    const fd = new FormData(f); const s = S.data.surveys[S.reportId];
    await busy(async () => {
      try {
        const r = await api('POST', `/api/admin/surveys/${encodeURIComponent(s.id)}/draw`, { date: fd.get('date'), claimDeadline: fd.get('claimDeadline'), gbRate: Number(fd.get('gbRate')), count: Number(f.dataset.count) || undefined });
        await loadData();
        showModal(`<h2>${r.winners.length} winner${r.winners.length === 1 ? '' : 's'} drawn &amp; notified ✓</h2>
          <p class="muted small">Picked at random from ${r.poolSize} eligible entr${r.poolSize === 1 ? 'y' : 'ies'}.${r.capped ? ` ${r.capped} skipped by the $${WIN_CAP} / 12-month limit.` : ''}${r.winners.length < r.requested ? ` Only ${r.winners.length} of ${r.requested} spots could be filled — draw again later to fill the rest.` : ''} Each winner got a text and an email and sees a "You won!" banner in the app.</p>
          <div class="tscroll" style="max-height:40vh;overflow:auto"><table class="t"><tr><th>#</th><th>Shown as</th><th>Private</th></tr>${r.winners.map((w, i) => `<tr><td>${i + 1}</td><td><b>${esc(winnerLabel(w))}</b></td><td class="small">${esc(w.fullName)}<div class="faint tiny">${esc(w.contact)}</div></td></tr>`).join('')}</table></div>
          <div style="height:14px"></div><button class="btn gold block" data-act="closemodal">Done</button>`);
        S.adminTab = 'winners'; S.wf = 'notified'; render();
      } catch (err) { showModal(`<h2>Couldn't draw</h2><p class="muted">${esc(err.message)}</p><button class="btn gold block" data-act="closemodal">OK</button>`); }
    });
    return;
  }
  if (f.id === 'winnerForm') {
    const fd = new FormData(f); const g = k => String(fd.get(k) || '').trim();
    const body = { firstName: g('firstName'), lastInitial: g('lastInitial'), state: g('state'), date: g('date'), gbRate: Number(fd.get('gbRate')) || 0, claimDeadline: g('claimDeadline') || undefined, ...readGold(k => fd.get(k)) };
    await busy(async () => {
      const id = S.pendingWinner.id;
      await api(id ? 'PUT' : 'POST', id ? '/api/admin/winners/' + id : '/api/admin/winners', body);
      closeModal(); await refresh(); toast('Winner saved');
    });
    return;
  }
  if (f.id === 'shipForm') {
    await busy(async () => { await api('POST', `/api/admin/winners/${f.dataset.id}/ship`, { tracking: String(new FormData(f).get('tracking') || '') }); closeModal(); await refresh(); toast('Marked shipped — winner notified'); });
  }
});
window.addEventListener('keydown', e => { if (e.key === 'Escape' && S.modalOpen) closeModal(); });

/* ---------- start ---------- */
(async function init() {
  render();
  try { const m = await api('GET', '/api/admin/me'); if (m.admin) { S.admin = m.admin; await loadData(); S.view = 'admin'; } else S.view = 'login'; }
  catch (e) { S.view = 'login'; }
  render();
})();
