// Texts (Twilio) and email (Postmark), sent through a database outbox with retries.
// With no provider configured (test mode), messages are only written to the outbox log.
import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { all, run } from './db.js';
import { fmtUSD } from '../public/js/shared.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- queue ---------- */
export function queueSms(to, body, kind) {
  if (!to) return;
  run('INSERT INTO outbox (channel, to_addr, body, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', 'sms', to, body, kind || null, config.smsEnabled ? 'queued' : 'logged', Date.now());
  if (!config.smsEnabled) console.log(`[sms:test-mode] to ${to}: ${body}`);
  kick();
}
export function queueEmail(to, subject, text, html, kind) {
  if (!to) return;
  run('INSERT INTO outbox (channel, to_addr, subject, body, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'email', to, subject, JSON.stringify({ text, html }), kind || null, config.emailEnabled ? 'queued' : 'logged', Date.now());
  if (!config.emailEnabled) console.log(`[email:test-mode] to ${to}: ${subject}`);
  kick();
}

let running = false; let again = false;
function kick() { setImmediate(() => processOutbox().catch(err => console.error('[outbox]', err))); }
export async function processOutbox() {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      const rows = all("SELECT * FROM outbox WHERE status = 'queued' AND attempts < 5 ORDER BY id LIMIT 25");
      for (const m of rows) {
        try {
          const providerId = m.channel === 'sms' ? await sendSms(m.to_addr, m.body) : await sendEmail(m.to_addr, m.subject, JSON.parse(m.body), m.kind);
          run("UPDATE outbox SET status = 'sent', provider_id = ?, sent_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?", providerId || null, Date.now(), m.id);
        } catch (err) {
          const permanent = err.permanent || m.attempts + 1 >= 5;
          run('UPDATE outbox SET status = ?, attempts = attempts + 1, error = ? WHERE id = ?', permanent ? 'failed' : 'queued', String(err.message || err).slice(0, 500), m.id);
          console.error(`[outbox] ${m.channel} #${m.id} failed: ${err.message}`);
        }
      }
    } while (again);
  } finally { running = false; }
}

async function sendSms(to, body) {
  const { sid, token, messagingService, from } = config.twilio;
  const form = new URLSearchParams({ To: '+1' + to, Body: body });
  if (messagingService) form.set('MessagingServiceSid', messagingService); else form.set('From', from);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Twilio ${r.status}: ${j.message || 'error'}`); e.permanent = r.status >= 400 && r.status < 500 && r.status !== 429; throw e; }
  return j.sid;
}
async function sendEmail(to, subject, { text, html }, kind) {
  const stream = kind === 'campaign' && config.postmark.broadcastStream ? config.postmark.broadcastStream : config.postmark.stream;
  const r = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST', headers: { 'X-Postmark-Server-Token': config.postmark.token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ From: config.emailFrom, To: to, Subject: subject, TextBody: text, HtmlBody: html, MessageStream: stream }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ErrorCode) { const e = new Error(`Postmark ${r.status}: ${j.Message || 'error'}`); e.permanent = r.status === 422; throw e; }
  return j.MessageID;
}

/* ---------- unsubscribe links (signed, no login needed) ---------- */
export const unsubToken = pid => pid + '.' + createHmac('sha256', config.secret).update('unsub:' + pid).digest('base64url').slice(0, 22);
export function checkUnsubToken(t) { const [pid] = String(t || '').split('.'); return pid && unsubToken(pid) === t ? pid : null; }

/* ---------- templates (English / Spanish) ---------- */
const brand = 'Golden Opinions';
function emailHtml(lang, bodyHtml, { unsubscribeUrl } = {}) {
  const foot = lang === 'es'
    ? `Nunca te pediremos pagos, costos de envío, tarjetas de regalo ni datos bancarios.<br>${esc(config.companyName)} · ${esc(config.companyAddress)}`
    : `We will never ask for payment, shipping fees, gift cards or bank details.<br>${esc(config.companyName)} · ${esc(config.companyAddress)}`;
  const unsub = unsubscribeUrl ? `<br><a href="${esc(unsubscribeUrl)}" style="color:#6b7280">${lang === 'es' ? 'Cancelar suscripción' : 'Unsubscribe'}</a>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f3f4f8;font-family:Arial,Helvetica,sans-serif;color:#1b2440">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0a2f96;padding:18px 24px;color:#f2c44a;font-weight:900;font-size:20px;letter-spacing:1px">GOLDEN OPINIONS</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f8f9fc;font-size:12px;color:#6b7280">${foot}${unsub}</td></tr>
</table></td></tr></table></body></html>`;
}
const button = (url, label) => `<p style="margin:22px 0"><a href="${esc(url)}" style="background:#e3a51d;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">${esc(label)}</a></p>`;

export const T = {
  code(lang, code) {
    return {
      sms: lang === 'es' ? `${brand}: tu código es ${code}. Vence en 10 minutos. No lo compartas con nadie.` : `${brand}: your code is ${code}. It expires in 10 minutes. Don't share it with anyone.`,
      subject: lang === 'es' ? `Tu código de ${brand}: ${code}` : `Your ${brand} code: ${code}`,
      text: lang === 'es' ? `Tu código es ${code}. Vence en 10 minutos. Si no lo pediste, ignora este correo.` : `Your code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      html: c => emailHtml(lang, lang === 'es' ? `<p>Tu código es:</p><p style="font-size:30px;font-weight:900;letter-spacing:6px">${code}</p><p>Vence en 10 minutos. Si no lo pediste, ignora este correo.</p>` : `<p>Your code is:</p><p style="font-size:30px;font-weight:900;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you didn't ask for it, ignore this email.</p>`),
    };
  },
  confirm(lang, { firstName, title, entryNo, prize, est, drawDate }) {
    const es = lang === 'es';
    return {
      sms: es ? `${brand}: ¡Ya estás participando! Gracias por completar "${title}". Participación #${entryNo}. Notificamos directamente a los ganadores. Responde STOP para cancelar.`
              : `${brand}: You're entered! Thanks for completing "${title}". Entry #${entryNo}. Winners are notified directly. Reply STOP to opt out.`,
      subject: es ? 'Ya participas para ganar oro 🏆' : "You're entered to win gold 🏆",
      text: es ? `Hola ${firstName},\n\nGracias por compartir tu opinión en "${title}". Tu número de participación es #${entryNo}.${prize ? `\nPremio: ${prize}${est ? ` — valor est. ${fmtUSD(est)} el día del sorteo` : ''}${drawDate ? `, ${drawDate}` : ''}.` : ''}\n\nContactaremos a los ganadores directamente. No se requiere compra.`
               : `Hi ${firstName},\n\nThanks for sharing your opinion in "${title}". Your entry number is #${entryNo}.${prize ? `\nPrize: ${prize}${est ? ` — est. value ${fmtUSD(est)} on drawing day` : ''}${drawDate ? `, ${drawDate}` : ''}.` : ''}\n\nWe'll contact winners directly. No purchase necessary.`,
      html: () => emailHtml(lang, es
        ? `<p>Hola ${esc(firstName)},</p><p>Gracias por compartir tu opinión en <b>${esc(title)}</b>. Tu número de participación es <b>#${esc(entryNo)}</b>.</p>${prize ? `<p>Premio: <b>${esc(prize)}</b>${est ? ` — valor est. ${fmtUSD(est)} el día del sorteo` : ''}${drawDate ? `, ${esc(drawDate)}` : ''}.</p>` : ''}<p>Contactaremos a los ganadores directamente por teléfono o correo. No se requiere compra.</p>`
        : `<p>Hi ${esc(firstName)},</p><p>Thanks for sharing your opinion in <b>${esc(title)}</b>. Your entry number is <b>#${esc(entryNo)}</b>.</p>${prize ? `<p>Prize: <b>${esc(prize)}</b>${est ? ` — est. value ${fmtUSD(est)} on drawing day` : ''}${drawDate ? `, ${esc(drawDate)}` : ''}.</p>` : ''}<p>We'll contact winners directly by phone or email. No purchase necessary.</p>`),
    };
  },
  win(lang, { firstName, title, prize, est, deadline }) {
    const es = lang === 'es'; const url = config.publicUrl;
    return {
      sms: es ? `${brand}: ¡Felicidades ${firstName}! Ganaste el sorteo "${title}" (${prize}). Inicia sesión en ${url} para reclamarlo antes del ${deadline}. Nunca te pediremos pagos ni datos bancarios.`
              : `${brand}: Congratulations ${firstName}! You won the "${title}" draw (${prize}). Log in at ${url} to claim by ${deadline}. We'll never ask for payment or bank details.`,
      subject: es ? `🎉 ¡Ganaste ${prize}!` : `🎉 You won ${prize}!`,
      text: es ? `Hola ${firstName},\n\n¡Felicidades! Ganaste el sorteo "${title}". Tu premio: ${prize}${est ? ` (valor est. ${fmtUSD(est)})` : ''}.\n\nPara reclamarlo, inicia sesión en ${url} y toca "Reclamar mi premio" antes del ${deadline}.\n\nPor tu seguridad: nunca te pediremos pagos, costos de envío, tarjetas de regalo ni datos bancarios.`
               : `Hi ${firstName},\n\nCongratulations — you're the winner of the "${title}" draw! Your prize: ${prize}${est ? ` (est. value ${fmtUSD(est)})` : ''}.\n\nTo claim it, log in at ${url} and tap "Claim my prize" by ${deadline}.\n\nFor your security: we will never ask for payment, shipping fees, gift cards or bank details.`,
      html: () => emailHtml(lang, es
        ? `<p>Hola ${esc(firstName)},</p><p>¡Felicidades! Ganaste el sorteo <b>${esc(title)}</b>. Tu premio: <b>${esc(prize)}</b>${est ? ` (valor est. ${fmtUSD(est)})` : ''}.</p><p>Reclámalo antes del <b>${esc(deadline)}</b>.</p>${button(url, 'Reclamar mi premio')}`
        : `<p>Hi ${esc(firstName)},</p><p>Congratulations — you're the winner of the <b>${esc(title)}</b> draw! Your prize: <b>${esc(prize)}</b>${est ? ` (est. value ${fmtUSD(est)})` : ''}.</p><p>Claim it by <b>${esc(deadline)}</b>.</p>${button(url, 'Claim my prize')}`),
    };
  },
  reminder(lang, { firstName, prize, deadline }) {
    const es = lang === 'es'; const url = config.publicUrl;
    return {
      sms: es ? `${brand}: Recordatorio — tu premio ${prize} te espera. Reclámalo en ${url} antes del ${deadline}.` : `${brand}: Reminder — your ${prize} prize is waiting. Claim it at ${url} by ${deadline}.`,
      subject: es ? 'Recordatorio: reclama tu premio' : 'Reminder: claim your prize',
      text: es ? `Hola ${firstName}, tu premio ${prize} te está esperando. Reclámalo en ${url} antes del ${deadline}.` : `Hi ${firstName}, your ${prize} prize is waiting. Claim it at ${url} by ${deadline}.`,
      html: () => emailHtml(lang, es ? `<p>Hola ${esc(firstName)},</p><p>Tu premio <b>${esc(prize)}</b> te está esperando. Reclámalo antes del <b>${esc(deadline)}</b>.</p>${button(url, 'Reclamar mi premio')}`
        : `<p>Hi ${esc(firstName)},</p><p>Your <b>${esc(prize)}</b> prize is waiting. Claim it by <b>${esc(deadline)}</b>.</p>${button(url, 'Claim my prize')}`),
    };
  },
  shipped(lang, { firstName, prize, tracking }) {
    const es = lang === 'es';
    return {
      sms: es ? `${brand}: ¡Tu premio ${prize} va en camino!${tracking ? ' Rastreo: ' + tracking : ''}` : `${brand}: Your ${prize} prize is on its way!${tracking ? ' Tracking: ' + tracking : ''}`,
      subject: es ? '📦 Tu premio ya fue enviado' : '📦 Your prize has shipped',
      text: es ? `Hola ${firstName}, tu premio ${prize} va en camino.${tracking ? ' Rastreo: ' + tracking : ''}` : `Hi ${firstName}, your ${prize} is on its way.${tracking ? ' Tracking: ' + tracking : ''}`,
      html: () => emailHtml(lang, es ? `<p>Hola ${esc(firstName)},</p><p>Tu premio <b>${esc(prize)}</b> va en camino.${tracking ? ` Rastreo: <b>${esc(tracking)}</b>` : ''}</p>` : `<p>Hi ${esc(firstName)},</p><p>Your <b>${esc(prize)}</b> is on its way.${tracking ? ` Tracking: <b>${esc(tracking)}</b>` : ''}</p>`),
    };
  },
  campaign(lang, { title, message, participantId }) {
    const es = lang === 'es'; const url = config.publicUrl; const unsubscribeUrl = `${url}/u/${unsubToken(participantId)}`;
    return {
      sms: `${brand}: ${message} ${url} ${es ? 'Responde STOP para cancelar.' : 'Reply STOP to opt out.'}`,
      subject: title,
      text: `${message}\n\n${url}\n\n${es ? 'No se requiere compra.' : 'No purchase necessary.'}\n${es ? 'Cancelar suscripción' : 'Unsubscribe'}: ${unsubscribeUrl}\n${config.companyName} · ${config.companyAddress}`,
      html: () => emailHtml(lang, `<p>${esc(message)}</p>${button(url, es ? 'Responder la encuesta' : 'Take the survey')}<p style="font-size:12px;color:#6b7280">${es ? 'No se requiere compra.' : 'No purchase necessary.'}</p>`, { unsubscribeUrl }),
    };
  },
};

export function sendBoth({ phone, email }, tpl, kind, { sms = true, mail = true } = {}) {
  if (sms && phone) queueSms(phone, tpl.sms, kind);
  if (mail && email) queueEmail(email, tpl.subject, tpl.text, tpl.html(), kind);
}
