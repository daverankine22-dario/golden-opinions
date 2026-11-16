// SQLite database (built into Node 22+). One file in DATA_DIR; back it up regularly (see SETUP.md).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

let db;

const MIGRATIONS = [
  `CREATE TABLE participants (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     phone TEXT NOT NULL UNIQUE,
     data TEXT NOT NULL,              -- JSON: firstName, lastName, state, optIn, lang, address, agreedAt ...
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE otps (
     id TEXT PRIMARY KEY,
     purpose TEXT NOT NULL,           -- signup | login | recover | change | admin
     code_hash TEXT NOT NULL,
     payload TEXT NOT NULL,           -- JSON
     attempts INTEGER NOT NULL DEFAULT 0,
     expires_at INTEGER NOT NULL,
     consumed_at INTEGER,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     kind TEXT NOT NULL,              -- participant | admin | pending (holds an OTP id)
     subject TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE surveys (
     id TEXT PRIMARY KEY,
     status TEXT NOT NULL,            -- draft | live | closed
     data TEXT NOT NULL,              -- JSON survey definition
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE responses (
     id TEXT PRIMARY KEY,             -- surveyId__participantId
     survey_id TEXT NOT NULL,
     participant_id TEXT NOT NULL,
     email TEXT NOT NULL,
     phone TEXT NOT NULL,
     status TEXT NOT NULL,            -- draft | submitted
     answers TEXT NOT NULL,
     lang TEXT,
     entry_no TEXT,
     started_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     submitted_at INTEGER
   );
   CREATE INDEX responses_survey ON responses(survey_id, status);
   CREATE INDEX responses_participant ON responses(participant_id);
   -- Rule: one entry per survey per email address and per phone number (enforced by the database itself)
   CREATE UNIQUE INDEX one_entry_email ON responses(survey_id, email) WHERE status = 'submitted';
   CREATE UNIQUE INDEX one_entry_phone ON responses(survey_id, phone) WHERE status = 'submitted';
   CREATE TABLE winners (
     id TEXT PRIMARY KEY,
     survey_id TEXT,
     response_id TEXT,
     participant_id TEXT,
     status TEXT NOT NULL,
     draw_date TEXT NOT NULL,          -- YYYY-MM-DD
     est_value REAL NOT NULL DEFAULT 0,
     data TEXT NOT NULL,               -- JSON: names, prize, shipTo, log ...
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX winners_participant ON winners(participant_id, draw_date);
   CREATE UNIQUE INDEX winners_response ON winners(response_id) WHERE response_id IS NOT NULL;
   CREATE TABLE campaigns (id TEXT PRIMARY KEY, data TEXT NOT NULL, sent_at INTEGER NOT NULL);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE outbox (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     channel TEXT NOT NULL,            -- sms | email
     to_addr TEXT NOT NULL,
     subject TEXT,
     body TEXT NOT NULL,
     kind TEXT,                        -- code | confirm | win | reminder | shipped | campaign
     status TEXT NOT NULL,             -- queued | sent | failed | logged (test mode)
     attempts INTEGER NOT NULL DEFAULT 0,
     error TEXT,
     provider_id TEXT,
     created_at INTEGER NOT NULL,
     sent_at INTEGER
   );
   CREATE INDEX outbox_status ON outbox(status, created_at);
   CREATE TABLE admins (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, detail TEXT);
   CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);`,
  // 2: business inquiries from the "Run a survey with us" form
  `CREATE TABLE inquiries (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', data TEXT NOT NULL);
   CREATE INDEX inquiries_created ON inquiries(created_at);`,
];

export function openDb(file) {
  if (db) return db;
  let path = file || config.dbFile;
  if (!path) { mkdirSync(config.dataDir, { recursive: true }); path = join(config.dataDir, 'golden-opinions.db'); }
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v = row ? row.v : 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    tx(() => { db.exec(MIGRATIONS[v]); db.prepare('UPDATE schema_version SET v = ?').run(v + 1); });
    v++;
  }
  return db;
}
export function closeDb() { if (db) { db.close(); db = undefined; } }

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try { const r = fn(); depth--; db.exec('COMMIT'); return r; }
  catch (err) { depth--; db.exec('ROLLBACK'); throw err; }
}

// JSON-row helpers
export const parse = s => { try { return JSON.parse(s); } catch { return null; } };
export function rowParticipant(r) { if (!r) return null; return { ...parse(r.data), id: r.id, email: r.email, phone: r.phone, createdAt: r.created_at, updatedAt: r.updated_at }; }
export function rowSurvey(r) { if (!r) return null; return { ...parse(r.data), id: r.id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at }; }
export function rowResponse(r) { if (!r) return null; return { id: r.id, surveyId: r.survey_id, participantId: r.participant_id, email: r.email, phone: r.phone, status: r.status, answers: parse(r.answers) || {}, lang: r.lang, entryNo: r.entry_no, startedAt: r.started_at, updatedAt: r.updated_at, submittedAt: r.submitted_at }; }
export function rowWinner(r) { if (!r) return null; return { ...parse(r.data), id: r.id, surveyId: r.survey_id, responseId: r.response_id, participantId: r.participant_id, status: r.status, date: r.draw_date, estValue: r.est_value, createdAt: r.created_at, updatedAt: r.updated_at }; }

export function rowInquiry(r) { if (!r) return null; return { ...parse(r.data), id: r.id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at }; }

export function getSetting(key, fallback = null) { const r = get('SELECT value FROM settings WHERE key = ?', key); return r ? parse(r.value) : fallback; }
export function setSetting(key, value) { run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, JSON.stringify(value), Date.now()); }
export function audit(actor, action, detail) { run('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)', Date.now(), actor || null, action, detail ? JSON.stringify(detail) : null); }

export function saveParticipant(p) {
  const { id, email, phone, createdAt, updatedAt, ...data } = p;
  const now = Date.now();
  run(`INSERT INTO participants (id, email, phone, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, phone = excluded.phone, data = excluded.data, updated_at = excluded.updated_at`,
    id, email, phone, JSON.stringify(data), createdAt || now, now);
}
export function saveSurvey(s) {
  const { id, status, createdAt, updatedAt, ...data } = s;
  const now = Date.now();
  run(`INSERT INTO surveys (id, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
    id, status || 'draft', JSON.stringify(data), createdAt || now, now);
}
export function saveWinner(w) {
  const { id, surveyId, responseId, participantId, status, date, estValue, createdAt, updatedAt, ...data } = w;
  const now = Date.now();
  run(`INSERT INTO winners (id, survey_id, response_id, participant_id, status, draw_date, est_value, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, draw_date = excluded.draw_date, est_value = excluded.est_value, data = excluded.data, updated_at = excluded.updated_at`,
    id, surveyId || null, responseId || null, participantId || null, status, date, estValue || 0, JSON.stringify(data), createdAt || now, now);
}
