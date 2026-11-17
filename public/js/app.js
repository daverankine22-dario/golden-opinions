// Golden Opinions — participant web app (talks to the server API; no admin code here).
import * as sh from './shared.js';
import { STATES, WIN_CAP, CLAIM_DAYS, fmtPhone, maskPhone, maskEmail, normPhone, emailOk, winnerLabel, winnersCountOf, answered, likertLabels, withUnit, tiersOf, noteOzOf, fmtOz } from './shared.js';
import { esc, qInput as qInputShared } from './ui.js';
import { I18N, I18N_RX } from './i18n-es.js';

const LOGO = '/img/logo.webp', MASCOT = '/img/mascot.webp';
const $ = s => document.querySelector(s);
const LS = { get(k, d) { try { const v = localStorage.getItem('go_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('go_' + k, JSON.stringify(v)); } catch (e) { } } };

/* ---------- state ---------- */
const S = { view: 'loading', lang: 'en', pub: { surveys: [], winners: [], winnerCount: 0, rate: null, testMode: false }, my: null, login: null, rec: null, chg: null, cur: null, lastEntry: null, legal: 'terms', claimId: null, busy: false };
const me = () => S.my && S.my.me;
const myWins = () => (S.my && S.my.wins) || [];
const myResp = sid => S.my && S.my.responses.find(r => r.surveyId === sid);
const pubSurvey = id => S.pub.surveys.find(s => s.id === id);
const vals = o => Object.values(o || {});

/* ---------- language ---------- */
const curLang = () => S.lang === 'es' ? 'es' : 'en';
const T = (en, es) => curLang() === 'es' ? es : en;
const LOC = () => curLang() === 'es' ? 'es-US' : 'en-US';
const fmtDate = t => t ? new Date(t).toLocaleDateString(LOC(), { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDT = t => t ? new Date(t).toLocaleString(LOC(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const dayFmt = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString(LOC(), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
const L = (o, k) => sh.L(o, k, curLang());
const prizeLabel = x => sh.prizeLabel(x, curLang());
const shortPrize = x => sh.shortPrize(x, curLang());
const placeLabel = p => sh.placeLabel(p || 1, curLang());
const tierPrize = (t, oz) => sh.tierPrize(t, oz, curLang());
const surveyPrizeShort = s => sh.surveyPrizeShort(s, curLang());
/* prize breakdown by place for a survey card: "1st place · 1 winner · 10 Gold Notes (0.01 oz of gold)" */
function prizeList(s) {
  const oz = noteOzOf(s);
  return tiersOf(s).map(t => `<div class="tier"><b>${placeLabel(t.place)}</b> · ${t.winners} ${T(t.winners === 1 ? 'winner' : 'winners', t.winners === 1 ? 'ganador' : 'ganadores')} · <span class="goldtext" style="font-weight:800">${esc(tierPrize(t, oz))}</span></div>`).join('');
}
const answerText = (q, v) => sh.answerText(q, v, curLang());
const drawDateOf = s => s.drawDate || s.endsAt || '';
const qInput = (q, v) => qInputShared(q, v, curLang());
function langToggle() { return `<div class="langtog notr" role="group" aria-label="Language / Idioma"><button class="${curLang() === 'en' ? 'on' : ''}" data-act="setLang" data-k="en" aria-label="English">EN</button><button class="${curLang() === 'es' ? 'on' : ''}" data-act="setLang" data-k="es" aria-label="Español">ES</button></div>`; }

function trStr(str) {
  if (curLang() !== 'es' || str == null) return str; const k = String(str).replace(/\s+/g, ' ').trim(); if (!k) return str;
  let out = I18N[k];
  if (out == null) { for (const [rx, rep] of I18N_RX) { const m = k.match(rx); if (m) { out = typeof rep === 'function' ? rep(...m) : k.replace(rx, rep); break; } } }
  if (out == null) return str;
  const lead = String(str).match(/^\s*/)[0], trail = String(str).match(/\s*$/)[0]; return lead + out + trail;
}
function translateDOM(root) {
  if (curLang() !== 'es' || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode(n) {
    if (n.nodeType === 1) { if (n.classList.contains('notr')) return NodeFilter.FILTER_REJECT; for (const a of ['placeholder', 'aria-label', 'title']) if (n.hasAttribute(a)) n.setAttribute(a, trStr(n.getAttribute(a))); return NodeFilter.FILTER_SKIP; }
    return NodeFilter.FILTER_ACCEPT; } });
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach(t => { const v = trStr(t.nodeValue); if (v !== t.nodeValue) t.nodeValue = v; });
}
let toastT; function toast(m) { const t = $('#toast'); t.textContent = trStr(m); t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3000); }

/* ---------- API ---------- */
async function api(method, path, body) {
  let r;
  try { r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
  catch (e) { const err = new Error("Can't reach the server. Check your connection and try again."); err.code = 'network'; throw err; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(j.error || 'Something went wrong. Please try again.'); Object.assign(err, j, { status: r.status }); if (r.status === 401 && S.my) { S.my = null; go('splash'); } throw err; }
  return j;
}
async function loadPublic() { S.pub = await api('GET', '/api/public'); }
async function loadMe() { try { const r = await api('GET', '/api/me'); S.my = r.me ? r : null; if (S.my && S.my.me.lang && !LS.get('lang', null)) S.lang = S.my.me.lang; } catch (e) { S.my = null; } }
async function busy(fn) { if (S.busy) return; S.busy = true; document.body.classList.add('busy'); try { return await fn(); } catch (e) { toast(e.message); } finally { S.busy = false; document.body.classList.remove('busy'); } }

/* ---------- modal ---------- */
function showModal(html) { S.modalOpen = true; $('#modal').innerHTML = `<div class="modal-bg" data-act="bgclose"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; translateDOM($('#modal')); }
function closeModal() { S.modalOpen = false; $('#modal').innerHTML = ''; }

/* ---------- messages (built from my data) ---------- */
function myMessages() {
  const p = me(); if (!p) return [];
  const out = []; const es = curLang() === 'es';
  (S.my.campaigns || []).forEach(c => out.push({ id: 'c' + c.id, kind: 'campaign', t: c.sentAt, title: es && c.title_es ? c.title_es : c.title, body: es && c.message_es ? c.message_es : c.message, surveyId: c.surveyId }));
  (S.my.responses || []).filter(r => r.status === 'submitted').forEach(r => { const st = S.my.surveyTitles[r.surveyId]; out.push({ id: 'r' + r.surveyId, kind: 'confirm', t: r.submittedAt, title: "You're entered! ✓", body: `Thanks for completing "${st ? L(st, 'title') : 'a survey'}". Entry #${r.entryNo}. Good luck in the gold draw!` }); });
  myWins().forEach(w => { const s = { title: w.surveyTitle, title_es: w.surveyTitle_es };
    (w.log || []).forEach((l, i) => {
      if (l.kind === 'won') out.push({ id: 'w' + w.id + i, kind: 'win', winId: w.id, t: l.at, title: '🎉 You won!', body: T(`Congratulations! You won ${placeLabel(w.place)} in the "${L(s, 'title') || 'Golden Opinions'}" draw: ${prizeLabel(w)}. Claim it in the app by ${dayFmt(w.claimDeadline)}. We'll never ask for payment or bank details.`, `¡Felicidades! Ganaste el ${placeLabel(w.place)} del sorteo "${L(s, 'title') || 'Golden Opinions'}": ${prizeLabel(w)}. Reclámalo en la app antes del ${dayFmt(w.claimDeadline)}. Nunca te pediremos pagos ni datos bancarios.`) });
      if (l.kind === 'reminder') out.push({ id: 'w' + w.id + i, kind: 'win', winId: w.id, t: l.at, title: 'Reminder: claim your prize', body: T(`Your prize (${prizeLabel(w)}) is waiting. Claim it in the app by ${dayFmt(w.claimDeadline)}.`, `Tu premio (${prizeLabel(w)}) te está esperando. Reclámalo en la app antes del ${dayFmt(w.claimDeadline)}.`) });
      if (l.kind === 'shipped') out.push({ id: 'w' + w.id + i, kind: 'ship', t: l.at, title: '📦 Your prize has shipped', body: T(`Your prize (${prizeLabel(w)}) is on its way.`, `Tu premio (${prizeLabel(w)}) va en camino.`) + (w.tracking ? T(' Tracking: ', ' Rastreo: ') + w.tracking : '') });
    }); });
  return out.sort((a, b) => b.t - a.t);
}
const unread = () => { const seen = LS.get('seen', []); return myMessages().filter(m => !seen.includes(m.id)).length; };

/* ---------- rendering ---------- */
function render() {
  const app = $('#app');
  if (S.view === 'loading') { app.innerHTML = `<div class="wrap"><div class="loading"><div class="spin"></div></div></div>`; return; }
  const V = { splash: viewSplash, login: viewLogin, verify: viewVerify, home: viewHome, take: viewTake, review: viewReview, done: viewDone, inbox: viewInbox, legal: viewLegal, biz: viewBiz, recover: viewRecover, settings: viewSettings, winners: viewWinners, claim: viewClaim };
  app.innerHTML = (V[S.view] || viewSplash)();
  translateDOM(app); document.documentElement.lang = curLang();
  app.querySelectorAll('[data-autofocus]').forEach(e => e.focus());
}
function go(v) { S.view = v; render(); window.scrollTo(0, 0); }

/* ---------- screens (from the approved prototype) ---------- */
function winnerRow(x){return `<div><span style="white-space:nowrap"><b>${esc(winnerLabel(x))}</b></span><span style="text-align:right"><span class="goldtext notr" style="font-weight:800">${esc(shortPrize(x))}</span><div class="faint tiny notr">${esc(placeLabel(x.place))}</div></span></div>`}
function winnersCard(){
  const w=S.pub.winners||[];const cnt=S.pub.winnerCount||w.length;
  const head=`<div class="winners"><div class="coin">${cnt}</div><div style="flex:1"><div style="font-weight:900;font-size:18px">${cnt===1?'1 winner has':cnt+' winners have'} won gold</div><div class="muted small">${w.length?'Recent Winners':'Be one of the first winners!'}</div></div>${w.length?'<span class="goldtext" style="font-weight:900;font-size:22px" aria-hidden="true">›</span>':''}</div>`;
  if(!w.length)return `<div class="card">${head}</div>`;
  return `<button class="card survey" data-act="winnersList" aria-label="See recent winners">${head}<div class="ticker">${w.slice(0,3).map(winnerRow).join('')}</div></button>`;
}
function viewWinners(){
  const w=(S.pub.winners||[]).slice(0,25);
  return `<div class="wrap">
  <div class="topbar"><button class="iconbtn" data-act="winnersBack" aria-label="Back">←</button><h2 style="margin:0">Recent Winners</h2>${langToggle()}</div>
  <p class="muted small" style="margin-top:0">The last ${w.length===1?'winner':w.length+' winners'} of our gold draws.</p>
  <div class="card">${w.map(x=>`<div class="review-item"><div><div style="font-weight:800;white-space:nowrap">${esc(winnerLabel(x))}</div><div class="faint tiny">${x.date?dayFmt(x.date):''}</div></div><div style="text-align:right"><div class="goldtext notr" style="font-weight:800;font-size:14px">${esc(shortPrize(x))}</div><div class="faint tiny notr">${esc(placeLabel(x.place))}</div></div></div>`).join('')||'<div class="muted center">No winners yet.</div>'}</div>
  <div style="height:16px"></div>
  <button class="btn big" data-act="winnersBack">← Back</button>
  </div>`;
}
function winBanners(){
  return myWins().map(w=>{const st=w.status;const s={title:w.surveyTitle,title_es:w.surveyTitle_es};
    if(st==='notified')return `<div class="goldcard" style="margin-bottom:14px"><div style="font-weight:900;font-size:20px">${T('🎉 You won!','🎉 ¡Ganaste!')}</div><div class="muted small notr" style="margin-top:4px">${T(`You won <b>${esc(placeLabel(w.place))}</b> in the <b>${esc(s?L(s,'title'):'')}</b> draw: <b>${esc(prizeLabel(w))}</b>. Claim it by <b>${dayFmt(w.claimDeadline)}</b>.`,`Ganaste el <b>${esc(placeLabel(w.place))}</b> del sorteo <b>${esc(s?L(s,'title'):'')}</b>: <b>${esc(prizeLabel(w))}</b>. Reclámalo antes del <b>${dayFmt(w.claimDeadline)}</b>.`)}</div><div style="margin-top:12px"><button class="btn" style="border-color:#7a4b00;color:#3a2500;background:rgba(255,255,255,.35)" data-act="claimOpen" data-id="${esc(w.id)}">${T('Claim my prize →','Reclamar mi premio →')}</button></div></div>`;
    const recent=t=>t&&Date.now()-t<30*864e5;
    if(st==='claimed'&&recent(w.claimedAt))return `<div class="card" style="margin-bottom:14px;border-color:rgba(74,222,128,.5)"><b>✓ Prize claimed</b><div class="muted small" style="margin-top:4px">Your ${esc(shortPrize(w))} will ship soon. We'll text you when it's on its way.</div></div>`;
    if(st==='shipped'&&recent(w.shippedAt))return `<div class="card" style="margin-bottom:14px;border-color:rgba(74,222,128,.5)"><b>📦 Your prize has shipped</b><div class="muted small" style="margin-top:4px">${esc(shortPrize(w))}${w.tracking?` · Tracking: <b>${esc(w.tracking)}</b>`:''}</div></div>`;
    return '';
  }).join('');
}
/* claim screen */
function viewClaim(){
  const w=myWins().find(x=>x.id===S.claimId);const p=me();
  const top=`<div class="topbar"><button class="iconbtn" data-act="home" aria-label="Back">←</button><h2 style="margin:0">Claim your prize</h2>${langToggle()}</div>`;
  if(!w||!p||false)return `<div class="wrap">${top}<div class="card">This prize couldn't be found.</div></div>`;
  const st=w.status;const s={title:w.surveyTitle,title_es:w.surveyTitle_es};
  if(st==='expired'||st==='forfeited')return `<div class="wrap">${top}<div class="card"><b>The claim window has closed</b><p class="muted small">This prize needed to be claimed by ${dayFmt(w.claimDeadline)}. Under the Official Rules an alternate winner may be selected. Questions? Contact [support email].</p></div></div>`;
  if(st==='claimed'||st==='shipped')return `<div class="wrap">${top}<div class="big-check"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
    <h1 class="h-xl" style="font-size:30px">Prize claimed!</h1><p class="muted center">Your <b class="notr">${esc(prizeLabel(w))}</b> will be shipped to:</p>
    <div class="card small">${esc(w.shipTo?.name||'')}<br>${esc(w.shipTo?.street||'')}<br>${esc(w.shipTo?.city||'')}, ${esc(w.shipTo?.state||'')} ${esc(w.shipTo?.zip||'')}</div>
    <p class="muted small center">${st==='shipped'?`Shipped ${fmtDate(w.shippedAt)}${w.tracking?' · Tracking: <b>'+esc(w.tracking)+'</b>':''}`:"We'll text and email you when it ships."}</p>
    <button class="btn gold big" data-act="home">Back to surveys</button></div>`;
  const A=p.address||{};
  return `<div class="wrap">${top}
  <div class="goldcard"><div class="muted tiny notr" style="font-weight:800">${esc(T('YOU WON ','GANASTE EL ')+placeLabel(w.place).toUpperCase())}</div><div class="notr" style="font-weight:900;font-size:22px">${esc(prizeLabel(w))}</div><div class="muted small" style="margin-top:4px">${esc(s?L(s,'title'):'')} draw · ${dayFmt(w.date)}</div></div>
  <div class="note" style="margin-top:12px">⏰ Claim by <b>${dayFmt(w.claimDeadline)}</b>. 🔒 We will <b>never</b> ask for payment, shipping fees, gift cards or bank details.</div>
  <form id="claimForm" class="card" style="margin-top:12px">
    <h3>Where should we ship it?</h3>
    <label class="f">Full name</label><input class="in" name="name" value="${esc([p.firstName,p.lastName].filter(Boolean).join(' '))}" autocomplete="name">
    <label class="f">Street address</label><input class="in" name="street" value="${esc(A.street||'')}" autocomplete="street-address">
    <div class="grid2" style="grid-template-columns:1.4fr 1fr"><div><label class="f">City</label><input class="in" name="city" value="${esc(A.city||'')}" autocomplete="address-level2"></div><div><label class="f">ZIP</label><input class="in" name="zip" inputmode="numeric" maxlength="10" value="${esc(A.zip||'')}" autocomplete="postal-code"></div></div>
    <label class="f">State</label><select class="in" name="state">${STATES.map(x=>`<option ${(p.state)===x?'selected':''}>${x}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" name="affidavit"><span>I confirm I'm 18 or older, a legal U.S. resident, eligible under the <a href="#" data-act="legal" data-k="rules">Official Rules</a>, and I accept this prize.</span></label>
    <label class="check"><input type="checkbox" name="consent" checked><span>Show me in Recent Winners as <b>${esc(winnerLabel(w))}</b>. (Optional)</span></label>
    <div id="claimErr"></div>
    <div style="height:14px"></div><button class="btn gold big" type="submit">Claim my prize</button>
  </form></div>`;
}
function adminLink(){return ''}
function footer(){
  return `<div class="bizcta"><div class="small" style="font-weight:800">${T('Need customer opinions for your business?','¿Necesitas la opinión de clientes para tu negocio?')}</div><button class="btn sm gold" data-act="biz">${T('Run a survey with us','Haz una encuesta con nosotros')}</button></div>
  <div class="statusbar">${S.pub.testMode?'Test mode · texts and emails are not really sent':''}<br><a href="#" data-act="legal" data-k="terms">Terms</a> · <a href="#" data-act="legal" data-k="privacy">Privacy</a> · <a href="#" data-act="legal" data-k="rules">Official Rules</a><br>${adminLink()}</div>`;
}

/* splash */
function viewSplash(){
  return `<div class="wrap" style="padding-bottom:150px">
  <div class="splash-lang">${langToggle()}</div>
  <div class="powered">Powered by<br><b>Zyng Technologies</b></div>
  <img class="logo" src="${LOGO}" alt="Golden Opinions">
  <h1 class="h-xl">Answer Questions</h1>
  <div style="height:10px"></div>
  <h2 class="h-big">Chance to<br>win gold</h2>
  <div style="height:22px"></div>
  ${winnersCard()}
  <div style="height:18px"></div>
  ${me()?`<button class="btn gold big" data-act="home">Continue to surveys</button><div class="center small muted" style="margin-top:10px">Signed in as ${esc(me().firstName||me().email)} · <a href="#" data-act="logout">Not you?</a></div>`
  :`<button class="btn gold big" data-act="authMode" data-k="signup">Create account</button><div style="height:10px"></div><button class="btn big" data-act="authMode" data-k="login">I already have an account</button>`}
  <div class="npn">No Purchase Necessary</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn sm" data-act="legal" data-k="terms">Terms &amp; Conditions</button><button class="btn sm" data-act="legal" data-k="privacy">Privacy Policy</button><button class="btn sm" data-act="legal" data-k="rules">Official Rules</button></div>
  ${footer()}
  <img class="mascot" src="${MASCOT}" alt="">
  </div>`;
}

/* create account / log in */
function viewLogin(){
  const L=S.login||{};const signup=S.authMode==='signup';
  const tabs=`<div class="seg" style="margin:4px 0 18px"><button class="${signup?'on':''}" style="font-size:14px;padding:12px" data-act="authMode" data-k="signup">Create account</button><button class="${!signup?'on':''}" style="font-size:14px;padding:12px" data-act="authMode" data-k="login">Log in</button></div>`;
  return `<div class="wrap">
  <div class="topbar"><button class="iconbtn" data-act="splash" aria-label="Back">←</button><img src="${LOGO}" alt="Golden Opinions">${langToggle()}</div>
  ${tabs}
  <h2>${signup?'Create your account':'Welcome back'}</h2>
  <p class="muted small" style="margin-top:0">${signup?'It takes 30 seconds. We use your email and mobile number only to log you in and make sure each person enters each survey once.':'Log in with the email and mobile number you signed up with. We\'ll send you a 6-digit code.'}</p>
  <form id="loginForm" autocomplete="on">
    ${signup?`<div class="grid2" style="grid-template-columns:1fr 1fr">
      <div><label class="f" for="fn">First name</label><input class="in" id="fn" autocomplete="given-name" value="${esc(L.firstName||'')}" required></div>
      <div><label class="f" for="lnm">Last name</label><input class="in" id="lnm" autocomplete="family-name" value="${esc(L.lastName||'')}" required></div></div>`:''}
    <label class="f" for="em">Email address</label>
    <input class="in" id="em" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(L.email||'')}" required>
    <label class="f" for="ph">Mobile number</label>
    <input class="in" id="ph" type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 555-0123" value="${esc(L.phoneRaw||'')}" required>
    ${signup?`<label class="f" for="st">State</label>
    <select class="in" id="st" required><option value="">Choose your state…</option>${STATES.map(s=>`<option ${L.state===s?'selected':''}>${s}</option>`).join('')}</select>
    <div class="note" style="margin-top:12px">🔒 Your full name stays private. If you win, we only show your first name, last initial and state, like <b>Betty W - California</b>.</div>
    <label class="check"><input type="checkbox" id="agree" ${L.agree?'checked':''}><span>I'm 18 or older and agree to the <a href="#" data-act="legal" data-k="terms">Terms</a>, <a href="#" data-act="legal" data-k="rules">Official Rules</a> and <a href="#" data-act="legal" data-k="privacy">Privacy Policy</a>.</span></label>
    <p class="faint tiny notr" style="margin:8px 2px 0">${T('Golden Opinions is free because businesses pay us for survey results. They only get combined or de-identified answers, never your name, email or phone number.','Golden Opinions es gratis porque las empresas nos pagan por los resultados de las encuestas. Solo reciben respuestas combinadas o anónimas, nunca tu nombre, correo ni teléfono.')}</p>
    <label class="check"><input type="checkbox" id="optin" ${L.optIn?'checked':''}><span>Text and email me when new surveys go live. Msg &amp; data rates may apply. Reply STOP to opt out. Optional.</span></label>`:''}
    ${L.err?`<div class="err">${L.err}</div>`:''}
    <div style="height:18px"></div>
    <button class="btn gold big" type="submit">${signup?'Create account':'Send my code'}</button>
  </form>
  ${!signup?'<p class="center" style="margin:14px 0 0"><a href="#" data-act="recStart" style="font-weight:700">Forgot your email or phone number?</a></p>':''}
  <p class="center small muted" style="margin-top:16px">${signup?'Already have an account? <a href="#" data-act="authMode" data-k="login">Log in</a>':'New here? <a href="#" data-act="authMode" data-k="signup">Create an account</a>'}</p>
  <p class="center faint tiny">🔒 We never sell or share your personal information.</p>
  </div>`;
}
/* account recovery */
function viewRecover(){
  const R=S.rec||{step:'start',via:'email'};const p=R.account||{};
  const top=`<div class="topbar"><button class="iconbtn" data-act="recBack" aria-label="Back">←</button><img src="${LOGO}" alt="Golden Opinions">${langToggle()}</div>`;
  const err=R.err?`<div class="err">${R.err}</div>`:'';
  if(R.step==='start')return `<div class="wrap">${top}
    <h2>Recover your account</h2>
    <p class="muted small" style="margin-top:0">Tell us the one you still remember. We'll send a code there to confirm it's you, then show your account details.</p>
    <div class="seg" style="margin:14px 0 4px"><button class="${R.via==='email'?'on':''}" style="font-size:13px;padding:12px" data-act="recVia" data-k="email">I remember my email</button><button class="${R.via==='phone'?'on':''}" style="font-size:13px;padding:12px" data-act="recVia" data-k="phone">I remember my phone</button></div>
    <form id="recForm">
      ${R.via==='email'?`<label class="f" for="rv">Email address</label><input class="in" id="rv" type="email" inputmode="email" placeholder="you@example.com" value="${esc(R.value||'')}" data-autofocus>`
      :`<label class="f" for="rv">Mobile number</label><input class="in" id="rv" type="tel" inputmode="tel" placeholder="(555) 555-0123" value="${esc(R.value||'')}" data-autofocus>`}
      ${err}<div style="height:18px"></div>
      <button class="btn gold big" type="submit">Send code</button>
    </form>
    <p class="center faint small" style="margin-top:18px">Don't remember either one? Contact support at [support email] and we'll verify your identity another way.</p></div>`;
  if(R.step==='code')return `<div class="wrap">${top}
    <h2>Check your ${R.via==='email'?'email':'texts'}</h2>
    <p class="muted small" style="margin-top:0">We sent a 6-digit code to ${esc(R.masked||'')}.</p>
    ${R.devCode?`<div class="note"><b>Test mode:</b> nothing is really sent yet. Your code is <b style="font-size:16px;letter-spacing:2px">${R.devCode}</b></div>`:''}
    <form id="recCodeForm"><label class="f" for="rc">Code</label>
      <input class="in" id="rc" inputmode="numeric" maxlength="6" placeholder="••••••" style="letter-spacing:8px;font-size:24px;text-align:center" data-autofocus>
      ${err}<div style="height:18px"></div><button class="btn gold big" type="submit">Verify</button></form>
    <p class="center"><button class="btn ghost sm" data-act="recResend">Resend code</button></p></div>`;
  // found
  const other=R.via==='email'?'phone':'email';
  return `<div class="wrap">${top}
    <div class="big-check" style="width:70px;height:70px"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
    <h2 class="center">We found your account</h2>
    <div class="card" style="margin-top:14px">
      <div class="faint tiny" style="font-weight:700">NAME</div><div style="font-weight:800;margin-bottom:10px">${esc([p.firstName,p.lastName].filter(Boolean).join(' ')||'—')}</div>
      <div class="faint tiny" style="font-weight:700">EMAIL</div><div style="font-weight:800;margin-bottom:10px">${esc(p.email)}</div>
      <div class="faint tiny" style="font-weight:700">MOBILE NUMBER</div><div style="font-weight:800">${esc(fmtPhone(p.phone))}</div>
    </div>
    ${R.saved?`<div class="note" style="margin-top:12px">✓ Your ${other==='phone'?'mobile number':'email'} has been updated.</div>`:''}
    <div style="height:16px"></div>
    <button class="btn gold big" data-act="recLogin">Log in now</button>
    ${R.editing?`<form id="recUpdForm" class="card" style="margin-top:14px">
      <h3>New ${other==='phone'?'mobile number':'email address'}</h3>
      <input class="in" id="ru" ${other==='phone'?'type="tel" inputmode="tel" placeholder="(555) 555-0123"':'type="email" inputmode="email" placeholder="you@example.com"'} data-autofocus>
      ${err}<div style="display:flex;gap:10px;margin-top:14px"><button type="button" class="btn" data-act="recEdit" data-k="0">Cancel</button><button class="btn gold" type="submit" style="flex:1">Save</button></div></form>`
    :`<p class="center"><button class="btn ghost sm" data-act="recUpdate">Changed your ${other==='phone'?'phone number':'email'}? Update it</button></p>`}
  </div>`;
}
/* settings */
function viewSettings(){
  const p=me();if(!p){S.view='splash';return viewSplash()}
  const C=S.chg||{};
  const row=(k,label,val)=>{
    if(C.field!==k)return `<div class="review-item"><div><div class="faint tiny" style="font-weight:700">${label}</div><div style="font-weight:800">${esc(val)}</div></div><button class="btn sm" data-act="chgStart" data-k="${k}">Change</button></div>`;
    const err=C.err?`<div class="err">${esc(C.err)}</div>`:'';
    if(C.step==='code')return `<div class="review-item" style="display:block"><div class="faint tiny" style="font-weight:700">${label}</div>
      <p class="small muted">We sent a 6-digit code to <b>${esc(k==='email'?C.value:fmtPhone(C.value))}</b>. Enter it to confirm the change.</p>
      ${C.devCode?`<div class="note"><b>Test mode:</b> your code is <b style="letter-spacing:2px">${C.devCode}</b></div>`:''}
      <form id="chgCodeForm"><input class="in" id="cc2" inputmode="numeric" maxlength="6" placeholder="••••••" style="letter-spacing:8px;text-align:center;margin-top:10px" data-autofocus>${err}
      <div style="display:flex;gap:10px;margin-top:12px"><button type="button" class="btn sm" data-act="chgCancel">Cancel</button><button class="btn gold sm" type="submit" style="flex:1">Confirm</button></div></form></div>`;
    return `<div class="review-item" style="display:block"><div class="faint tiny" style="font-weight:700">${T('NEW '+label,label==='EMAIL'?'CORREO NUEVO':'NÚMERO DE CELULAR NUEVO')}</div>
      <form id="chgForm"><input class="in" id="cv" ${k==='phone'?'type="tel" inputmode="tel" placeholder="(555) 555-0123"':'type="email" inputmode="email" placeholder="you@example.com"'} value="${esc(C.raw||'')}" style="margin-top:8px" data-autofocus>${err}
      <div class="faint tiny" style="margin-top:6px">We'll send a code to the new ${k==='phone'?'number':'address'} to make sure it's yours.</div>
      <div style="display:flex;gap:10px;margin-top:12px"><button type="button" class="btn sm" data-act="chgCancel">Cancel</button><button class="btn gold sm" type="submit" style="flex:1">Send code</button></div></form></div>`;
  };
  const A=p.address||{};
  return `<div class="wrap">
  <div class="topbar"><button class="iconbtn" data-act="home" aria-label="Back">←</button><h2 style="margin:0">Settings</h2>${langToggle()}</div>

  <div class="card"><h3>Login details</h3><p class="faint tiny" style="margin:0 0 4px">Used to log in and to keep entries to one per person.</p>
    ${row('email','EMAIL',p.email)}
    ${row('phone','MOBILE NUMBER',fmtPhone(p.phone))}
  </div>

  <form id="profForm" class="card">
    <h3>Contact information</h3>
    <div class="grid2" style="grid-template-columns:1fr 1fr">
      <div><label class="f">First name</label><input class="in" name="firstName" value="${esc(p.firstName||'')}" autocomplete="given-name"></div>
      <div><label class="f">Last name</label><input class="in" name="lastName" value="${esc(p.lastName||'')}" autocomplete="family-name"></div></div>
    <label class="f">State</label><select class="in" name="state"><option value="">Choose your state…</option>${STATES.map(x=>`<option ${p.state===x?'selected':''}>${x}</option>`).join('')}</select>
    <label class="f">Mailing address <span class="faint">(optional — used only to ship a prize)</span></label>
    <input class="in" name="street" placeholder="Street address" value="${esc(A.street||'')}" autocomplete="street-address">
    <div class="grid2" style="grid-template-columns:2fr 1fr;margin-top:10px">
      <input class="in" name="city" placeholder="City" value="${esc(A.city||'')}" autocomplete="address-level2">
      <input class="in" name="zip" placeholder="ZIP" inputmode="numeric" maxlength="10" value="${esc(A.zip||'')}" autocomplete="postal-code"></div>
    <div class="faint tiny" style="margin-top:10px">If you win, we only show <b>${esc(winnerLabel({firstName:p.firstName||'—',lastInitial:(p.lastName||'').slice(0,1),state:p.state}))}</b>. Everything else stays private.</div>
    <div style="height:14px"></div><button class="btn gold block" type="submit">Save contact information</button>
  </form>

  <div class="card"><h3>Notifications</h3>
    <label class="check" style="margin-top:4px"><input type="checkbox" data-act="optin" ${p.optIn?'checked':''}><span>Text &amp; email me when new surveys go live</span></label>
    <div class="faint tiny" style="margin-top:8px">Entry confirmations are always sent. You can also reply STOP to any text.</div>
  </div>

  <div class="card"><h3>Account</h3>
    <button class="btn block" data-act="logout">Sign out</button>
    <div style="height:10px"></div>
    <button class="btn block danger" data-act="delAcct">Delete my account</button>
    <p class="faint tiny center" style="margin-top:12px"><a href="#" data-act="legal" data-k="terms">Terms</a> · <a href="#" data-act="legal" data-k="privacy">Privacy</a> · <a href="#" data-act="legal" data-k="rules">Official Rules</a></p>
  </div>
  </div>`;
}
function captureLogin(){
  if(!$('#em'))return;
  const g=id=>{const e=$(id);return e?(e.type==='checkbox'?e.checked:e.value):undefined};
  S.login={...(S.login||{}),email:g('#em'),phoneRaw:g('#ph'),firstName:g('#fn')??(S.login||{}).firstName,lastName:g('#lnm')??(S.login||{}).lastName,state:g('#st')??(S.login||{}).state,agree:g('#agree')??(S.login||{}).agree,optIn:g('#optin')??(S.login||{}).optIn,err:''};
}
function viewVerify(){
  const L=S.login;
  return `<div class="wrap">
  <div class="topbar"><button class="iconbtn" data-act="login" aria-label="Back">←</button><img src="${LOGO}" alt="Golden Opinions">${langToggle()}</div>
  <h2>Enter your 6-digit code</h2>
  <p class="muted small" style="margin-top:0">We sent it by text to ${esc(L.maskedPhone||'')} and by email to ${esc(L.maskedEmail||'')}.</p>
  ${L.devCode?`<div class="note"><b>Test mode:</b> nothing is really sent yet. Your code is <b style="font-size:16px;letter-spacing:2px">${L.devCode}</b></div>`:''}
  <form id="verifyForm">
    <label class="f" for="code">Code</label>
    <input class="in" id="code" inputmode="numeric" maxlength="6" placeholder="••••••" style="letter-spacing:8px;font-size:24px;text-align:center" data-autofocus>
    ${L.verr?`<div class="err">${esc(L.verr)}</div>`:''}
    <div style="height:18px"></div>
    <button class="btn gold big" type="submit">Verify &amp; continue</button>
  </form>
  <p class="center"><button class="btn ghost sm" data-act="resend">Resend code</button></p>
  </div>`;
}

/* home */
function viewHome(){
  const p=me();if(!p){S.view='splash';return viewSplash()}
  const list=S.pub.surveys||[];
  const n=unread();
  const latestC0=(S.my.campaigns||[])[0];const latestC=latestC0&&{...latestC0,title:curLang()==='es'&&latestC0.title_es?latestC0.title_es:latestC0.title,message:curLang()==='es'&&latestC0.message_es?latestC0.message_es:latestC0.message};
  const seen=LS.get('seen',[]);
  const banner=latestC&&!seen.includes('c'+latestC.id)&&pubSurvey(latestC.surveyId)?`<div class="goldcard" style="margin-bottom:14px"><div style="font-weight:900;font-size:16px">📣 ${esc(latestC.title)}</div><div class="muted small" style="margin-top:4px">${esc(latestC.message)}</div><div style="margin-top:10px"><button class="btn sm" style="border-color:#7a4b00;color:#3a2500" data-act="open" data-id="${esc(latestC.surveyId)}" data-seen="c${esc(latestC.id)}">Take it now →</button></div></div>`:'';
  const cards=list.map(s=>{
    const r=myResp(s.id);
    const lim=!(r&&r.status==='submitted')&&limitOf(s.id);
    const st=r&&r.status==='submitted'?'<span class="chip ok">✓ Entered</span>':lim?'<span class="chip off">🔒 Limit reached</span>':r?'<span class="chip warn">Draft saved</span>':'<span class="chip">New</span>';
    const mins=Math.max(1,Math.round(s.questionCount*0.4));
    return `<button class="card survey" data-act="open" data-id="${esc(s.id)}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><h3 style="margin:0" class="notr">${esc(L(s,'title'))}</h3>${st}</div>
      <div class="muted small notr" style="margin-top:6px">${esc(L(s,'description')||'')}</div>
      <div class="meta"><span class="chip">${s.questionCount} questions</span><span class="chip">~${mins} min</span>${tiersOf(s).length?`<span class="chip warn notr">🏆 ${esc(surveyPrizeShort(s))}</span>`:''}${s.endsAt?`<span class="chip off">Ends ${dayFmt(s.endsAt)}</span>`:''}${drawDateOf(s)?`<span class="chip off">Drawing ${dayFmt(drawDateOf(s))}</span>`:''}</div>
      ${tiersOf(s).length?`<div class="tiers notr">${prizeList(s)}</div>`:''}
      ${lim?`<div class="faint small notr" style="margin-top:10px">🔒 ${esc(limitText(lim))}</div>`:''}
    </button>`}).join('');
  return `<div class="wrap">
  <div class="topbar"><img src="${LOGO}" alt="Golden Opinions"><div style="display:flex;gap:8px;align-items:center">${langToggle()}<button class="iconbtn" data-act="inbox" aria-label="Messages">✉️${n?`<span class="badge">${n}</span>`:''}</button><button class="iconbtn" data-act="settings" aria-label="Settings" title="Settings">⚙️</button></div></div>
  ${winBanners()}
  ${banner}
  ${winnersCard()}
  <h2 style="margin-top:22px">Pick a questionnaire</h2>
  <p class="muted small" style="margin-top:0">Finish a survey to be entered into that survey's gold draw. One entry per person per survey.</p>
  ${cards||`<div class="card center muted">No surveys are open right now. We'll let you know when the next one goes live${p.optIn?'':' — turn on alerts below'}.</div>`}
  ${list.length?`<p class="faint tiny" style="margin:10px 4px 0">Prizes are Gold Notes containing 24-karat gold. Amounts shown are the gold each winner receives.</p>`:''}
  <div class="card" style="margin-top:18px"><label class="check" style="margin:0"><input type="checkbox" data-act="optin" ${p.optIn?'checked':''}><span>Alert me by text &amp; email when new surveys go live</span></label><div class="faint tiny" style="margin-top:8px"><a href="#" data-act="settings">Account settings</a> · Signed in as ${esc([p.firstName,p.lastName].filter(Boolean).join(' '))} · ${esc(p.email)} · ${esc(fmtPhone(p.phone))}</div></div>
  ${footer()}
  </div>`;
}

/* inbox */
function viewInbox(){
  const ms=myMessages();
  const html=ms.map(m=>`<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(m.title)}</b><span class="faint tiny">${fmtDT(m.t)}</span></div><div class="muted small" style="margin-top:6px">${esc(m.body)}</div>${m.kind==='campaign'&&m.surveyId&&pubSurvey(m.surveyId)?`<div style="margin-top:10px"><button class="btn sm" data-act="open" data-id="${esc(m.surveyId)}">Open survey →</button></div>`:''}${m.kind==='win'&&(myWins().find(x=>x.id===m.winId)||{}).status==='notified'?`<div style="margin-top:10px"><button class="btn gold sm" data-act="claimOpen" data-id="${esc(m.winId)}">Claim prize →</button></div>`:''}</div>`).join('');
  LS.set('seen',ms.map(m=>m.id));
  return `<div class="wrap"><div class="topbar"><button class="iconbtn" data-act="home" aria-label="Back">←</button><h2 style="margin:0">Messages</h2>${langToggle()}</div>${html||'<div class="card center muted">No messages yet.</div>'}</div>`;
}

/* take survey */
function viewTake(){
  const c=S.cur;const s=c.survey;const qs=s.questions||[];
  if(!qs.length){return `<div class="wrap"><div class="card">This survey has no questions yet.</div><button class="btn" data-act="exitTake">Back</button></div>`}
  const q=qs[c.i];const v=c.answers[q.id];
  return `<div class="wrap">
  <div class="topbar"><button class="iconbtn" data-act="exitTake" aria-label="Close">✕</button><div class="small muted" style="font-weight:700;text-align:center;flex:1"><span class="notr">${esc(L(s,'title'))}</span>${c.preview?' · <span class="goldtext">PREVIEW</span>':''}</div>${langToggle()}</div>
  <div class="small muted" style="font-weight:700">Question ${c.i+1} of ${qs.length}</div>
  <div class="progress"><i style="width:${((c.i)/qs.length*100).toFixed(1)}%"></i></div>
  <p class="qtext"><span class="notr">${esc(L(q,'text')||'Untitled question')}</span> ${q.required?'<span class="req" title="Required">*</span>':''}</p>
  ${qInput(q,v)}
  <div id="qerr"></div>
  <div class="navbar">${c.i>0?'<button class="btn" data-act="prev">Back</button>':''}<button class="btn gold" data-act="next">${c.returnToReview?'Back to review':c.i===qs.length-1?'Review answers':'Next'}</button></div>
  ${c.preview?'':'<p class="center"><button class="btn ghost sm" data-act="saveExit">Save draft &amp; finish later</button></p>'}
  </div>`;
}
function viewReview(){
  const c=S.cur;const s=c.survey;const qs=s.questions||[];
  const missing=qs.filter(q=>q.required&&!answered(q,c.answers[q.id]));
  return `<div class="wrap">
  <div class="topbar"><button class="iconbtn" data-act="backToQs" aria-label="Back">←</button><h2 style="margin:0">Review &amp; submit</h2>${langToggle()}</div>
  <p class="muted small" style="margin-top:0">Check your answers. Tap Edit to change any of them.</p>
  <div class="card">${qs.map((q,i)=>{const t=answerText(q,c.answers[q.id]);return `<div class="review-item"><div><div style="font-weight:700;font-size:14px" class="notr">${i+1}. ${esc(L(q,'text'))}</div><div class="ans">${t?`<span class="notr">${esc(t)}</span>`:`<span style="color:${q.required?'#ffb4ab':'var(--ink3)'}">${q.required?'Required — not answered':'Skipped'}</span>`}</div></div><button class="btn sm" data-act="editQ" data-i="${i}">Edit</button></div>`}).join('')}</div>
  ${missing.length?`<div class="err">Please answer ${missing.length} required question${missing.length>1?'s':''} before submitting.</div>`:''}
  <div style="height:16px"></div>
  ${c.preview?'<button class="btn gold big" data-act="exitTake">End preview</button>':`<button class="btn gold big" data-act="submit" ${missing.length?'disabled':''}>Submit &amp; enter the draw</button>
  <p class="center"><button class="btn ghost sm" data-act="saveExit">Save draft &amp; finish later</button></p>`}
  </div>`;
}
function viewDone(){
  const c=S.cur;const p=me();const r=S.lastEntry;
  const title=c?L(c.survey,'title'):'';const no=r?r.entryNo:'';
  return `<div class="wrap center">
  <div class="big-check"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
  <h1 class="h-xl" style="font-size:34px">${T("You're entered!",'¡Ya estás participando!')}</h1>
  <p class="muted">${T('Thanks for completing','Gracias por completar')} <b class="notr">${esc(title)}</b>. ${T("You've been entered into the gold draw.",'Ya estás participando en el sorteo de oro.')}</p>
  <div class="goldcard" style="margin:16px 0"><div class="muted small" style="font-weight:700">${T('Your entry number','Tu número de participación')}</div><div style="font-weight:900;font-size:30px;letter-spacing:1px">#${esc(no)}</div></div>
  <div style="text-align:left" class="notr">
    <div class="small muted" style="font-weight:700;margin:14px 0 8px">${T('Confirmation text sent to','Mensaje de confirmación enviado a')} ${esc(maskPhone(p.phone))}</div>
    <div class="phone-msg">${T(`Golden Opinions: You're entered! Thanks for completing "${esc(title)}". Entry #${esc(no)}. Winners are notified directly. Reply STOP to opt out.`,`Golden Opinions: ¡Ya estás participando! Gracias por completar "${esc(title)}". Participación #${esc(no)}. Notificamos directamente a los ganadores. Responde STOP para cancelar.`)}</div>
    <div class="small muted" style="font-weight:700;margin:16px 0 8px">${T('Confirmation email sent to','Correo de confirmación enviado a')} ${esc(p.email)}</div>
    <div class="email-prev"><div class="eh"><b>${T('From','De')}:</b> Golden Opinions · <b>${T('Subject','Asunto')}:</b> ${T("You're entered to win gold 🏆",'Ya participas para ganar oro 🏆')}</div><div class="eb">${T('Hi','Hola')} ${esc(p.firstName||T('there',''))},<br><br>${T('Thanks for sharing your opinion in','Gracias por compartir tu opinión en')} <b>${esc(title)}</b>. ${T('Your entry number is','Tu número de participación es')} <b>#${esc(no)}</b>.<br><br>${c&&tiersOf(c.survey).length?`${T('Prizes','Premios')}: ${esc(surveyPrizeShort(c.survey))}${drawDateOf(c.survey)?T('. Drawing: ','. Sorteo: ')+dayFmt(drawDateOf(c.survey)):''}.<br><br>`:''}${T("We'll contact winners directly by phone or email. No purchase necessary.",'Contactaremos a los ganadores directamente por teléfono o correo. No se requiere compra.')}<br><br>— ${T('The Golden Opinions team','El equipo de Golden Opinions')}</div></div>
    ${S.pub.testMode?`<p class="faint tiny">${T('Test mode: these previews show what will be sent once texting and email are connected.','Modo de prueba: estas vistas previas muestran lo que se enviará cuando se conecten los mensajes y el correo.')}</p>`:''}
  </div>
  <div style="height:10px"></div>
  <button class="btn gold big" data-act="home">Back to surveys</button>
  </div>`;
}

/* "Run a survey with us": businesses ask us to run a survey for them. Emailed to the team and listed in the admin console. */
function viewBiz(){
  const B=S.biz||(S.biz={}); const m=me()||{};
  if(B.sent) return `<div class="wrap"><div class="topbar"><button class="iconbtn" data-act="bizBack" aria-label="Back">←</button><h2 style="margin:0">${T('Thank you!','¡Gracias!')}</h2>${langToggle()}</div>
    <div class="card center" style="padding:28px 20px"><div style="font-size:44px">📬</div><h2 style="margin:8px 0">${T("We've got your request","Recibimos tu solicitud")}</h2><p class="muted">${T(`Someone from our team will contact you at <b>${esc(B.email)}</b>, usually within one business day.`,`Alguien de nuestro equipo te escribirá a <b>${esc(B.email)}</b>, normalmente en un día hábil.`)}</p><button class="btn gold block" data-act="bizBack" style="margin-top:14px">${T('Done','Listo')}</button></div></div>`;
  const v=k=>esc(B[k]??(k==='name'?[m.firstName,m.lastName].filter(Boolean).join(' '):k==='email'?m.email||'':k==='phone'&&m.phone?fmtPhone(m.phone):''));
  return `<div class="wrap"><div class="topbar"><button class="iconbtn" data-act="bizBack" aria-label="Back">←</button><h2 style="margin:0">${T('Run a survey with us','Haz una encuesta con nosotros')}</h2>${langToggle()}</div>
  <div class="card"><p class="muted" style="margin-top:0">${T('Golden Opinions gets you honest answers from real people, fast. Tell us what you want to learn and we\'ll get back to you with ideas and pricing.','Golden Opinions te da respuestas honestas de personas reales, rápido. Cuéntanos qué quieres saber y te responderemos con ideas y precios.')}</p>
  <form id="bizForm" novalidate>
    <label class="f" for="bzName">${T('Your name','Tu nombre')} *</label><input class="in" id="bzName" name="name" autocomplete="name" value="${v('name')}" maxlength="100">
    <label class="f" for="bzCo">${T('Company or organization','Empresa u organización')}</label><input class="in" id="bzCo" name="company" autocomplete="organization" value="${v('company')}" maxlength="120">
    <label class="f" for="bzEmail">${T('Email','Correo electrónico')} *</label><input class="in" id="bzEmail" name="email" type="email" autocomplete="email" value="${v('email')}" maxlength="200">
    <label class="f" for="bzPhone">${T('Phone (optional)','Teléfono (opcional)')}</label><input class="in" id="bzPhone" name="phone" type="tel" autocomplete="tel" value="${v('phone')}">
    <label class="f" for="bzMsg">${T('What would you like to learn?','¿Qué te gustaría saber?')} *</label><textarea class="in" id="bzMsg" name="message" rows="5" maxlength="3000" placeholder="${T('Who you want to hear from, what you want to ask, and when you need results','A quién quieres escuchar, qué quieres preguntar y cuándo necesitas los resultados')}">${esc(B.message||'')}</textarea>
    <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    ${B.err?`<div class="err">${esc(B.err)}</div>`:''}
    <button class="btn gold block big" type="submit" style="margin-top:14px">${T('Send request','Enviar solicitud')}</button>
    <p class="faint tiny" style="margin:10px 0 0">${T('Or email us at','O escríbenos a')} <a href="mailto:${esc(S.pub.inquiryEmail||'connect@mygoldenopinions.com')}">${esc(S.pub.inquiryEmail||'connect@mygoldenopinions.com')}</a>. ${T('We use these details only to reply to you.','Usamos estos datos solo para responderte.')}</p>
  </form></div></div>`;
}
/* legal: the Terms, Privacy Policy and Official Rules are the company's documents in /public/legal, also served as web pages at /terms, /privacy and /rules */
const LEGAL_DOCS={terms:['Terms & Conditions','Términos y condiciones'],privacy:['Privacy Policy','Política de privacidad'],rules:['Official Rules','Reglas oficiales']};
async function loadLegal(k){
  S.legalDocs=S.legalDocs||{}; if(S.legalDocs[k]!==undefined) return; S.legalDocs[k]=null;
  try{const r=await fetch('/legal/'+k+'.html',{cache:'no-cache'});S.legalDocs[k]=r.ok?await r.text():''}catch{S.legalDocs[k]=''}
  if(S.view==='legal') render();
}
function viewLegal(){
  const k=LEGAL_DOCS[S.legal]?S.legal:'terms'; const [en,es]=LEGAL_DOCS[k];
  const html=(S.legalDocs||{})[k]; if(html===undefined) loadLegal(k);
  const body=html==null?`<p class="muted">${T('Loading…','Cargando…')}</p>`:html||`<p>${T('This document could not be loaded. Please try again, or open it at','No se pudo cargar este documento. Inténtalo de nuevo o ábrelo en')} <a href="/${k}" target="_blank" rel="noopener">${location.host}/${k}</a>.</p>`;
  return `<div class="wrap"><div class="topbar"><button class="iconbtn" data-act="legalBack" aria-label="Back">←</button><h2 style="margin:0">${T(en,es)}</h2>${langToggle()}</div>${T('',`<div class="note" style="margin-bottom:12px">Este documento está disponible solo en inglés por ahora. La versión en inglés es la que rige.</div>`)}<div class="card legal notr">${body}</div>
  <p class="faint tiny center" style="margin:12px 0 24px">${['terms','privacy','rules'].filter(x=>x!==k).map(x=>`<a href="#" data-act="legal" data-k="${x}">${T(...LEGAL_DOCS[x])}</a>`).join(' · ')} · <a href="/${k}" target="_blank" rel="noopener">${T('Open as a web page','Abrir como página web')}</a></p></div>`;
}

/* ---------- admin ---------- */

/* ---------- taking a survey ---------- */
/* yearly prize limit: the server says which surveys this person can't enter yet (no dollar amounts are sent) */
const limitOf = sid => ((S.my && S.my.limits) || {})[sid];
function limitText(lim) {
  const cap = (S.my && S.my.winCap) || WIN_CAP;
  return lim && lim.until
    ? T(`You've reached the yearly prize limit ($${cap} in any 12 months), so you can't enter this survey until ${dayFmt(lim.until)}.`, `Alcanzaste el límite anual de premios ($${cap} en 12 meses), así que no puedes participar en esta encuesta hasta el ${dayFmt(lim.until)}.`)
    : T(`You've reached the yearly prize limit ($${cap} in any 12 months), so you can't enter this survey right now.`, `Alcanzaste el límite anual de premios ($${cap} en 12 meses), así que no puedes participar en esta encuesta por ahora.`);
}
function showLimit(lim) { showModal(`<h2>${T('Yearly prize limit reached', 'Límite anual de premios alcanzado')}</h2><p class="muted notr">${esc(limitText(lim))}</p><p class="faint small notr">${T('This rule is in the Official Rules and keeps prizes fair for everyone. Congratulations on your wins!', 'Esta regla está en el Reglamento oficial y mantiene los premios justos para todos. ¡Felicidades por tus premios!')}</p><button class="btn gold block" data-act="closemodal">OK</button>`); }
async function startSurvey(sid) {
  const p = me(); if (!p) { S.authMode = 'login'; go('login'); return; }
  const r = myResp(sid); const s0 = pubSurvey(sid) || {};
  if (r && r.status === 'submitted') { showModal(`<h2>You're already entered</h2><p class="muted">You completed "<span class="notr">${esc(L(s0, 'title'))}</span>" on ${fmtDate(r.submittedAt)}. Each person can enter each survey once. Entry #${esc(r.entryNo)}.</p><button class="btn gold block" data-act="closemodal">OK</button>`); return; }
  if (limitOf(sid)) { showLimit(limitOf(sid)); return; }
  await busy(async () => {
    let survey;
    try { ({ survey } = await api('GET', '/api/surveys/' + encodeURIComponent(sid))); }
    catch (e) { if (e.code === 'limit') { await loadMe(); showLimit({ until: e.until }); return; } throw e; }
    S.cur = { sid, survey, answers: r && r.answers ? JSON.parse(JSON.stringify(r.answers)) : {}, i: 0 };
    if (r) { const qs = survey.questions || []; const k = qs.findIndex(q => !answered(q, S.cur.answers[q.id])); S.cur.i = k < 0 ? qs.length - 1 : k; }
    go('take');
  });
}
const markSeen = id => { const s = LS.get('seen', []); if (!s.includes(id)) { s.push(id); LS.set('seen', s); } };

/* ---------- actions ---------- */
const ACT = {
  start() { if (me()) go('home'); else { S.authMode = 'signup'; go('login'); } },
  splash() { go('splash'); }, home() { go('home'); }, login() { go('login'); }, inbox() { go('inbox'); },
  authMode(t) { captureLogin(); S.authMode = t.dataset.k; if (S.login) S.login.err = ''; go('login'); },
  legal(t) { if (S.view === 'login') captureLogin(); S.legalFrom = S.view === 'legal' ? S.legalFrom : S.view; S.legal = t.dataset.k; go('legal'); },
  legalBack() { go(S.legalFrom || 'splash'); },
  biz() { if (S.view === 'login') captureLogin(); S.bizFrom = S.view === 'biz' ? S.bizFrom : S.view; S.biz = {}; go('biz'); },
  bizBack() { S.biz = {}; go(S.bizFrom || 'splash'); },
  async logout() { await busy(async () => { await api('POST', '/api/auth/logout'); S.my = null; S.login = null; go('splash'); }); },
  async resend() { await busy(async () => { const r = await api('POST', '/api/auth/resend'); if (S.login) { S.login.devCode = r.devCode; S.login.verr = ''; } if (S.rec) S.rec.devCode = r.devCode; if (S.chg) S.chg.devCode = r.devCode; render(); toast('New code sent'); }); },
  async optin(t) { const v = t.checked; await busy(async () => { const r = await api('PUT', '/api/me/prefs', { optIn: v }); S.my.me = r.me; toast(v ? 'Alerts turned on' : 'Alerts turned off'); }); },
  async setLang(t) {
    if (S.view === 'login') captureLogin();
    S.lang = t.dataset.k; LS.set('lang', S.lang); render();
    if (me() && me().lang !== S.lang) { try { const r = await api('PUT', '/api/me/prefs', { lang: S.lang }); S.my.me = r.me; } catch (e) { } }
  },
  open(t) { if (t.dataset.seen) markSeen(t.dataset.seen); startSurvey(t.dataset.id); },
  ans(t) {
    const c = S.cur; const q = c.survey.questions[c.i]; const m = t.dataset.mode; const v = t.dataset.v;
    if (m === 's') c.answers[q.id] = v;
    else if (m === 'n') c.answers[q.id] = Number(v);
    else if (m === 'm') { const a = Array.isArray(c.answers[q.id]) ? [...c.answers[q.id]] : []; const k = a.indexOf(v); if (k >= 0) a.splice(k, 1); else if (!(q.max > 0 && a.length >= q.max)) a.push(v); c.answers[q.id] = a; }
    else if (m === 'x') c.answers[q.id] = { ...(c.answers[q.id] || {}), [t.dataset.row]: v };
    render();
  },
  next() {
    const c = S.cur; const qs = c.survey.questions; const q = qs[c.i];
    if (q.required && !answered(q, c.answers[q.id])) { $('#qerr').innerHTML = `<div class="err">${trStr(q.type === 'matrix' ? 'Please answer every row.' : 'Please answer this question to continue.')}</div>`; return; }
    if (c.returnToReview || c.i === qs.length - 1) { c.returnToReview = false; go('review'); return; }
    c.i++; render(); window.scrollTo(0, 0);
  },
  prev() { S.cur.i = Math.max(0, S.cur.i - 1); render(); },
  editQ(t) { S.cur.i = +t.dataset.i; S.cur.returnToReview = true; go('take'); },
  backToQs() { S.cur.i = S.cur.survey.questions.length - 1; go('take'); },
  exitTake() { go('home'); },
  async saveExit() {
    const c = S.cur;
    await busy(async () => { try { await api('PUT', `/api/surveys/${encodeURIComponent(c.sid)}/draft`, { answers: c.answers, lang: curLang() }); } catch (e) { if (e.code === 'limit') { await loadMe(); go('home'); showLimit({ until: e.until }); return; } throw e; } await loadMe(); toast('Draft saved — finish it any time before the survey ends'); go('home'); });
  },
  async submit() {
    const c = S.cur;
    await busy(async () => {
      try {
        const r = await api('POST', `/api/surveys/${encodeURIComponent(c.sid)}/submit`, { answers: c.answers, lang: curLang() });
        S.lastEntry = { entryNo: r.entryNo }; await loadMe(); go('done');
      } catch (e) {
        if (e.code === 'limit') { await loadMe(); showLimit({ until: e.until }); return; }
        if (e.code === 'already') { showModal(`<h2>Already entered</h2><p class="muted">${esc(trStr(e.message))}</p><button class="btn gold block" data-act="closemodal">OK</button>`); return; }
        throw e;
      }
    });
  },
  closemodal() { closeModal(); },
  bgclose(t, e) { if (e.target === t) closeModal(); },
  settings() { S.chg = null; go('settings'); },
  winnersList() { S.winnersFrom = S.view; go('winners'); },
  winnersBack() { go(S.winnersFrom || 'splash'); },
  chgStart(t) { S.chg = { field: t.dataset.k, step: 'enter' }; render(); },
  chgCancel() { S.chg = null; render(); },
  delAcct() { showModal(`<h2>Delete your account?</h2><p class="muted">Your login details, contact information and saved drafts will be deleted. Surveys you already submitted stay in the draw (without your contact details we may not be able to reach you if you win). This can't be undone.</p><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" data-act="closemodal">Cancel</button><button class="btn danger" data-act="delAcctYes">Delete account</button></div>`); },
  async delAcctYes() { await busy(async () => { await api('DELETE', '/api/me'); S.my = null; closeModal(); go('splash'); toast('Your account has been deleted'); }); },
  recStart() { S.rec = { step: 'start', via: 'email' }; go('recover'); },
  recVia(t) { S.rec = { step: 'start', via: t.dataset.k }; render(); },
  recBack() { const R = S.rec; if (R && R.step === 'code') { R.step = 'start'; R.err = ''; render(); } else { S.authMode = 'login'; go('login'); } },
  recResend() { ACT.resend(); },
  recUpdate() { const other = S.rec.via === 'email' ? 'phone' : 'email'; S.rec = null; S.chg = { field: other, step: 'enter' }; go('settings'); },
  async recLogin() { S.rec = null; S.login = null; go('home'); toast(`Welcome back${me() && me().firstName ? ', ' + me().firstName : ''}!`); },
  claimOpen(t) { S.claimId = t.dataset.id; go('claim'); },
};

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act;
  if (t.tagName === 'A' || t.tagName === 'BUTTON') e.preventDefault();
  if (a === 'optin' && t.tagName === 'INPUT') { ACT.optin(t); return; }
  if (t.disabled) return;
  if (ACT[a]) ACT[a](t, e);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.kind === 'text') { S.cur.answers[t.dataset.q] = t.value; return; }
  if (t.dataset.kind === 'range') { const q = S.cur.survey.questions[S.cur.i]; S.cur.answers[q.id] = Number(t.value); $('#sv').textContent = withUnit(t.value, q.unit); }
});
document.addEventListener('change', e => { const t = e.target; if (t.dataset.kind === 'select') S.cur.answers[t.dataset.q] = t.value || undefined; });

document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  if (f.id === 'bizForm') {
    const fd = new FormData(f); const B = S.biz = Object.fromEntries(fd); delete B.website;
    await busy(async () => {
      try { await api('POST', '/api/inquiries', { ...Object.fromEntries(fd), lang: curLang() }); S.biz = { sent: true, email: B.email }; render(); window.scrollTo(0, 0); }
      catch (e) { B.err = e.message; render(); const el = e.field && document.querySelector(`#bizForm [name=${e.field}]`); if (el) el.focus(); }
    });
    return;
  }
  if (f.id === 'loginForm') {
    captureLogin(); const Lg = S.login; const signup = S.authMode === 'signup';
    await busy(async () => {
      try {
        const r = await api('POST', '/api/auth/start', { mode: signup ? 'signup' : 'login', email: Lg.email, phone: Lg.phoneRaw, firstName: Lg.firstName, lastName: Lg.lastName, state: Lg.state, agree: !!Lg.agree, optIn: !!Lg.optIn, lang: curLang() });
        Object.assign(Lg, { maskedPhone: r.maskedPhone, maskedEmail: r.maskedEmail, devCode: r.devCode, verr: '', err: '' }); go('verify');
      } catch (err) {
        const toLogin = ' <a href="#" data-act="authMode" data-k="login">Log in instead</a>';
        let html = esc(err.message);
        if (err.code === 'email_exists' || err.code === 'phone_exists') html += toLogin;
        if (err.code === 'not_found') html += ' <a href="#" data-act="recStart">Recover your account</a> or <a href="#" data-act="authMode" data-k="signup">create one</a>.';
        if (err.code === 'mismatch') html += ' <a href="#" data-act="recStart">Forgot one of them?</a>';
        Lg.err = html; render();
      }
    });
    return;
  }
  if (f.id === 'verifyForm') {
    const Lg = S.login; const code = $('#code').value;
    await busy(async () => {
      try {
        await api('POST', '/api/auth/verify', { code }); const isNew = S.authMode === 'signup';
        await loadMe(); S.login = null; go('home');
        toast(isNew ? `Welcome to Golden Opinions, ${me().firstName}!` : `Welcome back, ${me().firstName}!`);
      } catch (err) { Lg.verr = err.message; if (err.code === 'expired' || err.code === 'too_many') { Lg.err = err.message; go('login'); } else render(); }
    });
    return;
  }
  if (f.id === 'recForm') {
    const R = S.rec; R.value = $('#rv').value.trim(); R.err = '';
    await busy(async () => {
      try { const r = await api('POST', '/api/auth/recover/start', { via: R.via, value: R.value, lang: curLang() }); Object.assign(R, { step: 'code', masked: r.masked, devCode: r.devCode }); render(); }
      catch (err) { R.err = esc(err.message) + (err.code === 'not_found' ? ' <a href="#" data-act="authMode" data-k="signup">create an account</a>' : ''); render(); }
    });
    return;
  }
  if (f.id === 'recCodeForm') {
    const R = S.rec;
    await busy(async () => {
      try { const r = await api('POST', '/api/auth/recover/verify', { code: $('#rc').value }); await loadMe(); Object.assign(R, { step: 'found', account: r.me, err: '' }); render(); }
      catch (err) { R.err = esc(err.message); render(); }
    });
    return;
  }
  if (f.id === 'profForm') {
    const fd = new FormData(f); const g = k => String(fd.get(k) || '').trim();
    await busy(async () => { const r = await api('PUT', '/api/me/profile', { firstName: g('firstName'), lastName: g('lastName'), state: g('state'), address: { street: g('street'), city: g('city'), zip: g('zip') } }); S.my.me = r.me; toast('Contact information saved'); render(); });
    return;
  }
  if (f.id === 'chgForm') {
    const C = S.chg; C.raw = $('#cv').value.trim(); C.err = '';
    await busy(async () => {
      try { const r = await api('POST', '/api/me/contact/start', { field: C.field, value: C.raw }); Object.assign(C, { step: 'code', value: r.value, devCode: r.devCode }); render(); }
      catch (err) { C.err = err.message; render(); }
    });
    return;
  }
  if (f.id === 'chgCodeForm') {
    const C = S.chg;
    await busy(async () => {
      try { const r = await api('POST', '/api/me/contact/verify', { code: $('#cc2').value }); S.my.me = r.me; const f2 = C.field; S.chg = null; render(); toast(f2 === 'phone' ? 'Mobile number updated' : 'Email updated'); }
      catch (err) { C.err = err.message; render(); }
    });
    return;
  }
  if (f.id === 'claimForm') {
    const fd = new FormData(f); const g = k => String(fd.get(k) || '').trim();
    const err = m => { $('#claimErr').innerHTML = `<div class="err">${esc(trStr(m))}</div>`; };
    if (!g('name') || !g('street') || !g('city') || !g('zip')) return err('Please fill in your full shipping address.');
    if (!/^\d{5}(-\d{4})?$/.test(g('zip'))) return err('ZIP code should be 5 digits.');
    if (!fd.get('affidavit')) return err('Please confirm your eligibility to claim the prize.');
    await busy(async () => {
      try { await api('POST', `/api/wins/${encodeURIComponent(S.claimId)}/claim`, { shipTo: { name: g('name'), street: g('street'), city: g('city'), state: g('state'), zip: g('zip') }, affidavit: true, consent: !!fd.get('consent') }); await loadMe(); render(); window.scrollTo(0, 0); toast('Prize claimed!'); }
      catch (e2) { err(e2.message); }
    });
  }
});
window.addEventListener('keydown', e => { if (e.key === 'Escape' && S.modalOpen) closeModal(); });
// keep data fresh when people come back to the tab
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !['splash', 'home', 'inbox', 'winners'].includes(S.view)) return;
  try { await Promise.all([loadPublic(), me() ? loadMe() : null]); render(); } catch (e) { }
});

/* ---------- start ---------- */
(async function init() {
  S.lang = LS.get('lang', null) || ((navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en');
  render();
  try { await Promise.all([loadPublic(), loadMe()]); } catch (e) { toast(e.message); }
  if (me() && me().lang && !LS.get('lang', null)) S.lang = me().lang;
  go(me() ? 'home' : 'splash');
})();
