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
   Each survey awards up to three places (1st, 2nd, 3rd). For each place the admin sets the number of winners and
   the number of Gold Notes each winner receives. Each Gold Note holds a set amount of gold (noteOz, e.g. 0.001 oz).
   Participants only ever see gold amounts. A dollar value (notes × the admin's internal Gold Note rate) is kept
   only for the $999 winning limit, the $5,000 prize-pool cap and prize records. */
export const G_PER_OZ = 31.1035;
export const DEFAULT_NOTE_OZ = 0.001;
export const PLACES = [1, 2, 3];
/* Winning limit: no person may win more than this (est. value on drawing day) in any 12 consecutive months.
   Keeps every winner under the IRS Form 1099-MISC prize threshold ($2,000 per calendar year from 2026). */
export const WIN_CAP = 999;
export const POOL_CAP = 5000; // total prize value per survey (New York / Florida registration threshold)
export const CLAIM_DAYS = 14;

export const fmtNum = n => String(+Number(n).toFixed(6));
export const fmtOz = n => `${fmtNum(n)} oz`;
export const placeLabel = (p, lang = 'en') => lang === 'es'
  ? ({ 1: '1.er lugar', 2: '2.º lugar', 3: '3.er lugar' }[p] || `${p}.º lugar`)
  : ({ 1: '1st place', 2: '2nd place', 3: '3rd place' }[p] || `Place ${p}`);
export const noteOzOf = x => x && Number(x.noteOz) > 0 ? +x.noteOz : DEFAULT_NOTE_OZ;
export const notesText = n => `${n} Gold Note${+n === 1 ? '' : 's'}`;
export const goldOzOf = (notes, noteOz) => +(notes * noteOz).toFixed(6);
/* a survey's prize places, cleaned and in order (older single-prize surveys become one 1st-place tier) */
export function tiersOf(s) {
  if (s && Array.isArray(s.tiers)) return s.tiers
    .map(t => ({ place: +t.place, winners: Math.max(0, parseInt(t.winners) || 0), notes: Math.max(0, parseInt(t.notes) || 0) }))
    .filter(t => PLACES.includes(t.place) && t.winners > 0 && t.notes > 0).sort((a, b) => a.place - b.place);
  const n = s && s.goldbacks > 0 ? +s.goldbacks : 0;
  return n ? [{ place: 1, winners: Math.max(1, parseInt(s.winnersCount) || 1), notes: n }] : [];
}
export const winnersCountOf = s => tiersOf(s).reduce((a, t) => a + t.winners, 0);
export const totalNotesOf = s => tiersOf(s).reduce((a, t) => a + t.winners * t.notes, 0);
export const topGoldOz = s => { const ts = tiersOf(s); return ts.length ? goldOzOf(Math.max(...ts.map(t => t.notes)), noteOzOf(s)) : 0; };
export function tierPrize(t, noteOz, lang = 'en') {
  const oz = fmtOz(goldOzOf(t.notes, noteOz));
  return lang === 'es' ? `${notesText(t.notes)} (${oz} de oro)` : `${notesText(t.notes)} (${oz} of gold)`;
}
/* one-line summary of a survey's prizes: "26 winners · up to 0.01 oz of gold" */
export function surveyPrizeShort(s, lang = 'en') {
  const n = winnersCountOf(s); const top = fmtOz(topGoldOz(s));
  if (lang === 'es') return n === 1 ? `1 ganador · ${top} de oro` : `${n} ganadores · hasta ${top} de oro`;
  return n === 1 ? `1 winner · ${top} of gold` : `${n} winners · up to ${top} of gold`;
}
/* a winner's prize */
export const notesOf = w => w && w.notes > 0 ? +w.notes : (w && w.goldbacks > 0 ? +w.goldbacks : 0);
export const winnerGoldOz = w => goldOzOf(notesOf(w), noteOzOf(w));
export function prizeLabel(w, lang = 'en') { const n = notesOf(w); return n ? tierPrize({ notes: n }, noteOzOf(w), lang) : (w.prize || ''); }
export const shortPrize = (w, lang = 'en') => `${fmtOz(winnerGoldOz(w))} ${lang === 'es' ? 'de oro' : 'of gold'}`;
/* internal dollar value: notes × rate per Gold Note (admin only — never shown to participants) */
export const estValue = (x, rate) => { const n = typeof x === 'number' ? x : notesOf(x); return n > 0 && rate > 0 ? +(n * rate).toFixed(2) : 0; };
export const poolValue = (s, rate) => estValue(totalNotesOf(s), rate);
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
  if (!tiersOf(s).length) errs.push('Add at least one prize place with a number of winners and Gold Notes.');
  if (!(Number(s.noteOz) > 0 && Number(s.noteOz) <= 10)) errs.push('Enter how much gold is in each Gold Note (oz).');
  if (s.drawDate && s.endsAt && s.drawDate < s.endsAt) errs.push('The drawing date should be on or after the end date.');
  return errs;
}

/* the dollar value of one Gold Note, set on the survey when it is created (internal; never shown to participants) */
export const surveyRateOf = s => (s && Number(s.noteRate) > 0 ? +s.noteRate : 0);
/* the largest single prize in a survey, in dollars at the survey's rate: what a person must have room for under the yearly limit to enter */
export const topPrizeValue = (s, rate = surveyRateOf(s)) => { const t = tiersOf(s); return rate && t.length ? estValue(Math.max(...t.map(x => x.notes)), rate) : 0; };
