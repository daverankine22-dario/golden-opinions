// Makes a consistent copy of the database while the app is running.
//   npm run backup            -> writes DATA_DIR/backups/golden-opinions-YYYY-MM-DD-HHMM.db
// Copy that file somewhere off the server (e.g. cloud storage). Keeps the 14 newest locally.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { config } from '../src/config.js';

const db = openDb();
const dir = join(config.dataDir, 'backups'); mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const file = join(dir, `golden-opinions-${stamp}.db`);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
console.log('Backup written:', file);
const old = readdirSync(dir).filter(f => f.endsWith('.db')).sort().reverse().slice(14);
for (const f of old) rmSync(join(dir, f));
