// All settings come from environment variables (see .env.example).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env loader (no dependency). Real environment variables win.
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const e = process.env;
const bool = v => /^(1|true|yes)$/i.test(String(v || ''));

export const config = {
  port: +(e.PORT || 3000),
  dataDir: resolve(e.DATA_DIR || './data'),
  dbFile: e.DB_FILE || '',                       // optional explicit path; ':memory:' for tests
  publicUrl: (e.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  adminHost: (e.ADMIN_HOST || '').toLowerCase(), // e.g. admin.goldenopinions.com — if set, /admin only works on that host
  timeZone: e.BUSINESS_TZ || 'America/Phoenix',
  production: e.NODE_ENV === 'production',
  trustProxy: bool(e.TRUST_PROXY),
  companyName: e.COMPANY_NAME || 'Golden Opinions',
  companyAddress: e.COMPANY_ADDRESS || '[Company mailing address]',
  secret: e.APP_SECRET || '',
  supportEmail: e.SUPPORT_EMAIL || 'support@example.com',
  inquiryEmail: e.INQUIRY_EMAIL || 'connect@mygoldenopinions.com', // "Run a survey with us" requests are emailed here
  sessionDays: +(e.SESSION_DAYS || 60),
  adminSessionHours: +(e.ADMIN_SESSION_HOURS || 12),
  twilio: { sid: e.TWILIO_ACCOUNT_SID || '', token: e.TWILIO_AUTH_TOKEN || '', messagingService: e.TWILIO_MESSAGING_SERVICE_SID || '', from: e.TWILIO_FROM || '' },
  postmark: { token: e.POSTMARK_SERVER_TOKEN || '', stream: e.POSTMARK_STREAM || 'outbound', broadcastStream: e.POSTMARK_BROADCAST_STREAM || '' },
  emailFrom: e.EMAIL_FROM || 'Golden Opinions <no-reply@example.com>',
  // Test mode: when no SMS/email provider is configured, codes are shown on screen and messages go to the outbox log only.
  devShowCodes: bool(e.DEV_SHOW_CODES) || process.argv.includes('--dev'),
};
config.smsEnabled = !!(config.twilio.sid && config.twilio.token && (config.twilio.messagingService || config.twilio.from));
config.emailEnabled = !!config.postmark.token;
if (!config.secret) {
  if (config.production) throw new Error('APP_SECRET must be set in production (any long random string).');
  config.secret = 'dev-only-secret-change-me';
}
if (config.production && config.devShowCodes) {
  console.warn('[config] DEV_SHOW_CODES is ignored in production.');
  config.devShowCodes = false;
}
