// Golden Opinions — shared rules and formatting.
// Pure functions with no DOM or Node APIs: imported by the server (src/) and by the browser apps.

export const STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];

export const TYPES = {
  single: { name: 'Multiple choice', desc: 'One pick (radio buttons)' },
  multi: { name: 'Checkboxes', desc: 'Pick several, optional limit' },
  dropdown: { name: 'Dropdown', desc: 'Compact list for long options' },
  likert: { name: 'Likert scale', desc: 'Agreement / satisfaction / frequency' },
  rating: { name: 'Rating scale', desc: '1–5 or 1–10 with end labels' },
  slider: { name: 'Slider', desc: 'Drag to a number' },
  matrix: { name: 'Matrix / grid', desc: 'Several rows, one shared scale' },
  text: { name: 'Short text', desc: 'Single line answer' },
};

export const LIKERT = {
  agreement: { 3: ['Disagree','Neutral','Agree'], 5: ['Strongly disagree','Disagree','Neutral','Agree','Strongly agree'], 7: ['Strongly disagree','Disagree','Somewhat disagree','Neutral','Somewhat agree','Agree','Strongly agree'] },
  satisfaction: { 3: ['Dissatisfied','Neutral','Satisfied'], 5: ['Very dissatisfied','Dissatisfied','Neutral','Satisfied','Very satisfied'], 7: ['Extremely dissatisfied','Very dissatisfied','Somewhat dissatisfied','Neutral','Somewhat satisfied','Very satisfied','Extremely satisfied'] },
  frequency: { 3: ['Never','Sometimes','Always'], 5: ['Never','Rarely','Sometimes','Often','Always'], 7: ['Never','Very rarely','Rarely','Sometimes','Often','Very often','Always'] },
};
export const LIKERT_ES = {
  agreement: { 3: ['En desacuerdo','Neutral','De acuerdo'], 5: ['Totalmente en desacuerdo','En desacuerdo','Neutral','De acuerdo','Totalmente de acuerdo'], 7: ['Totalmente en desacuerdo','En desacuerdo','Algo en desacuerdo','Neutral','Algo de acuerdo','De acuerdo','Totalmente de acuerdo'] },
  satisfaction: { 3: ['Insatisfecho','Neutral','Satisfecho'], 5: ['Muy insatisfecho','Insatisfecho','Neutral','Satisfecho','Muy satisfecho'], 7: ['Extremadamente insatisfecho','Muy insatisfecho','Algo insatisfecho','Neutral','Algo satisfecho','Muy satisfecho','Extremadamente satisfecho'] },
  frequency: { 3: ['Nunca','A veces','Siempre'], 5: ['Nunca','Rara vez','A veces','A menudo','Siempre'], 7: ['Nunca','Muy rara vez','Rara vez','A veces','A menudo','Muy a menudo','Siempre'] },
};

/* ---------- prizes: Gold Notes ----------
   Prizes are Gold Notes containing 24K gold. The smallest note holds 1/1000 troy oz; internally, prize sizes are
   counted in those 1/1000 oz units (the `goldbacks` field). Value = units × the official Gold Note exchange rate
   per 1/1000 oz, published daily by the issuer (10 AM MST). */
export const G_PER_OZ = 31.1035;
export const GB_OZ = 0.001;
export const GB_CHOICES = [{ n: 1, l: '1/1000' }, { n: 2, l: '1/500' }, { n: 5, l: '1/200' }, { n: 10, l: '1/100' }];
/* Winning limit: no person may win more than this (est. value on drawing day) in any 12 consecutive months.
   Keeps every winner under the IRS Form 1099-MISC prize threshold ($2,000 per calendar year from 2026). */
export const WIN_CAP = 999;
export const CLAIM_DAYS = 14;

export const fmtNum = n => String(+Number(n).toFixed(4));
export const gbOf = x => x && x.goldbacks > 0 ? +x.goldbacks : 0;
export const noteParts = x => {
  const qty = Math.max(1, parseInt(x.noteQty) || 1);
  const denom = x.noteDenom > 0 ? +x.noteDenom : gbOf(x) / qty;
  return { qty, denom };
};
export const ozFrac = n => { const c = GB_CHOICES.find(c => c.n === n); if (c) return c.l; const d = 1000 / n; return Number.isInteger(d) ? '1/' + d : fmtNum(n * GB_OZ); };
export const gramsOf = n => n * GB_OZ * G_PER_OZ;
export const goldText = (n, unit) => unit === 'g' ? `${fmtNum(gramsOf(n).toFixed(3))} g` : `${ozFrac(n)} oz`;
export const goldConv = (n, unit) => n > 0 ? '= ' + goldText(n, unit === 'g' ? 'oz' : 'g') : '';
export function prizeLabel(x, lang = 'en') {
  const n = gbOf(x); if (!n) return x.prize || '';
  const { qty, denom } = noteParts(x); const g = goldText(n, x.goldUnit);
  const dl = goldText(denom, x.goldUnit);
  if (lang === 'es') return qty > 1 ? `${qty} Gold Notes de ${dl} (${g} de oro en total)` : `Gold Note de ${g}`;
  return qty > 1 ? `${qty} × ${dl} Gold Notes (${g} gold in total)` : `${g} Gold Note`;
}
// prize with an article, for sentences: "a 1/100 oz Gold Note" / "una Gold Note de 1/100 oz" / "2 × 1/100 oz Gold Notes"
export function prizePhrase(x, lang = 'en') {
  const label = prizeLabel(x, lang); if (!gbOf(x) || noteParts(x).qty > 1) return label;
  return (lang === 'es' ? 'una ' : 'a ') + label;
}
export function shortPrize(x) {
  const n = gbOf(x); if (!n) return x.prize || 'Gold';
  const { qty, denom } = noteParts(x);
  return qty > 1 ? `${qty}×${goldText(denom, x.goldUnit)} Gold Notes` : `${goldText(n, x.goldUnit)} Gold Note`;
}
export const estValue = (x, rate) => { const n = gbOf(x); return n && rate > 0 ? +(n * rate).toFixed(2) : 0; };
export const winnersCountOf = s => Math.max(1, parseInt(s.winnersCount) || 1);
export const fmtUSD = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- people ---------- */
export const normPhone = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d; };
export const fmtPhone = d => d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (d || '');
export const maskPhone = d => d ? `(•••) •••-${String(d).slice(-4)}` : '';
export const maskEmail = e => { if (!e) return ''; const [a, b] = String(e).split('@'); return a.slice(0, 1) + '•••@' + b; };
export const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ''));
export function winnerLabel(w) {
  if (w.firstName) {
    const fn = String(w.firstName).trim(); const li = String(w.lastInitial || '').trim().slice(0, 1).toUpperCase();
    return `${fn}${li ? ' ' + li : ''}${w.state ? ' - ' + w.state : ''}`;
  }
  return (w.name || 'Winner') + (w.location ? ' - ' + w.location : '');
}

/* ---------- dates (drawing days are YYYY-MM-DD in the business time zone) ---------- */
export function localDay(t = Date.now(), tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t));
  const g = k => parts.find(p => p.type === k).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);

/* ---------- winners ---------- */
// notified -> claimed -> shipped; unclaimed past deadline -> expired -> forfeited (alternate drawn)
export function wStatus(w, today) {
  if (!w.status) return 'claimed';
  if (w.status === 'notified' && w.claimDeadline && today > w.claimDeadline) return 'expired';
  return w.status;
}
export const W_STATUS = { notified: ['warn', 'Awaiting claim'], claimed: ['ok', 'Claimed · to ship'], shipped: ['ok', 'Shipped'], expired: ['off', 'Unclaimed · past deadline'], forfeited: ['off', 'Forfeited'] };

/* ---------- questions ---------- */
export function newQuestion(type, id) {
  const q = { id: id || 'q' + Math.random().toString(36).slice(2, 10), type, text: '', required: true };
  if (type === 'single' || type === 'dropdown') q.options = ['Option 1', 'Option 2', 'Option 3'];
  if (type === 'multi') { q.options = ['Option 1', 'Option 2', 'Option 3', 'Option 4']; q.max = 0; }
  if (type === 'likert') { q.scale = 'agreement'; q.points = 5; }
  if (type === 'rating') { q.min = 1; q.max = 10; q.lowLabel = 'Not likely at all'; q.highLabel = 'Very likely'; }
  if (type === 'slider') { q.min = 0; q.max = 100; q.step = 1; q.unit = ''; }
  if (type === 'matrix') { q.rows = ['Row 1', 'Row 2', 'Row 3']; q.scale = 'satisfaction'; q.points = 5; }
  if (type === 'text') { q.placeholder = ''; q.maxLength = 120; }
  return q;
}
export const likertLabels = q => (LIKERT[q.scale] || LIKERT.agreement)[q.points] || LIKERT.agreement[5];
export const likertShow = (q, v, lang) => { if (lang !== 'es') return v; const i = likertLabels(q).indexOf(v); const es = ((LIKERT_ES[q.scale] || LIKERT_ES.agreement)[q.points] || [])[i]; return es || v; };
// survey content in the participant's language (falls back to English when the Spanish field is blank)
export const L = (o, k, lang) => lang === 'es' && o && String(o[k + '_es'] || '').trim() ? o[k + '_es'] : (o ? o[k] : '');
export const Larr = (o, k, i, lang) => { const es = lang === 'es' && o && Array.isArray(o[k + '_es']) ? o[k + '_es'][i] : ''; return es && String(es).trim() ? es : (o[k] || [])[i]; };
export const optShow = (q, v, k = 'options', lang) => { const i = (q[k] || []).indexOf(v); return i < 0 ? v : Larr(q, k, i, lang); };
export const withUnit = (v, u) => u === '$' ? '$' + v : v + (u ? ' ' + u : '');

export function answered(q, v) {
  if (v === undefined || v === null || v === '') return false;
  if (q.type === 'multi') return Array.isArray(v) && v.length > 0;
  if (q.type === 'matrix') return (q.rows || []).every(r => v && v[r]);
  if (q.type === 'text') return String(v).trim().length > 0;
  return true;
}
export function answerText(q, v, lang = 'en') {
  if (!answered(q, v) && !(q.type === 'matrix' && v && Object.keys(v).length)) return '';
  if (lang === 'es') {
    if (q.type === 'multi') return v.map(x => optShow(q, x, 'options', lang)).join(', ');
    if (q.type === 'matrix') return (q.rows || []).map(r => `${optShow(q, r, 'rows', lang)}: ${v[r] ? likertShow(q, v[r], lang) : '—'}`).join(' · ');
    if (q.type === 'single' || q.type === 'dropdown') return optShow(q, v, 'options', lang);
    if (q.type === 'likert') return likertShow(q, v, lang);
  }
  if (q.type === 'multi') return v.join(', ');
  if (q.type === 'matrix') return (q.rows || []).map(r => `${r}: ${v[r] || '—'}`).join(' · ');
  if (q.type === 'slider') return withUnit(v, q.unit);
  if (q.type === 'rating') return `${v} / ${q.max}`;
  return String(v);
}

/* Server-side answer check: keeps only valid values for each question.
   Returns { answers, missing } where missing lists required questions without a valid answer. */
export function cleanAnswers(survey, input) {
  const out = {}; const missing = []; const a = input && typeof input === 'object' ? input : {};
  for (const q of survey.questions || []) {
    const v = a[q.id]; let ok;
    switch (q.type) {
      case 'single': case 'dropdown': ok = typeof v === 'string' && (q.options || []).includes(v) ? v : undefined; break;
      case 'likert': ok = typeof v === 'string' && likertLabels(q).includes(v) ? v : undefined; break;
      case 'multi': if (Array.isArray(v)) { const u = [...new Set(v.filter(x => (q.options || []).includes(x)))]; ok = u.length && (!(q.max > 0) || u.length <= q.max) ? u : undefined; } break;
      case 'rating': { const n = Number(v); ok = v !== '' && v != null && Number.isInteger(n) && n >= +q.min && n <= +q.max ? n : undefined; break; }
      case 'slider': { const n = Number(v); ok = v !== '' && v != null && Number.isFinite(n) && n >= +q.min && n <= +q.max ? n : undefined; break; }
      case 'matrix': if (v && typeof v === 'object') { const labs = likertLabels(q); const m = {}; for (const r of q.rows || []) if (labs.includes(v[r])) m[r] = v[r]; ok = Object.keys(m).length ? m : undefined; } break;
      case 'text': ok = typeof v === 'string' && v.trim() ? v.trim().slice(0, +q.maxLength || 500) : undefined; break;
    }
    if (ok !== undefined) out[q.id] = ok;
    if (q.required && !answered(q, ok)) missing.push(q.id);
  }
  return { answers: out, missing };
}

/* Survey definition check used by the admin API. Returns a list of problems (empty = ok). */
export function surveyProblems(s) {
  const errs = [];
  if (!String(s.title || '').trim()) errs.push('Add a survey title.');
  if (!(s.questions || []).length) errs.push('Add at least one question.');
  (s.questions || []).forEach((q, i) => {
    if (!TYPES[q.type]) errs.push(`Question ${i + 1} has an unknown type.`);
    if (!String(q.text || '').trim()) errs.push(`Question ${i + 1} needs text.`);
    if (['single', 'multi', 'dropdown'].includes(q.type) && (q.options || []).length < 2) errs.push(`Question ${i + 1} needs at least 2 options.`);
    if (q.type === 'matrix' && !(q.rows || []).length) errs.push(`Question ${i + 1} needs at least 1 row.`);
    if (q.type === 'slider' && !(+q.max > +q.min)) errs.push(`Question ${i + 1}: max must be greater than min.`);
  });
  if (!(gbOf(s) > 0)) errs.push("Choose the Gold Note for this survey's prize.");
  if (s.drawDate && s.endsAt && s.drawDate < s.endsAt) errs.push('The drawing date should be on or after the end date.');
  return errs;
}
