// Create or reset a staff account for the admin console.
//   npm run create-admin -- you@company.com "Your Name"
// The password is read from ADMIN_PASSWORD, or a strong one is generated and printed once.
import { randomBytes } from 'node:crypto';
import { openDb, get, run, audit } from '../src/db.js';
import { hashPassword, newId } from '../src/http.js';

const [email, name = ''] = process.argv.slice(2);
if (!email || !email.includes('@')) { console.error('Usage: npm run create-admin -- you@company.com "Your Name"'); process.exit(1); }
const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
if (password.length < 12) { console.error('Use a password of at least 12 characters.'); process.exit(1); }
openDb();
const e = email.trim().toLowerCase();
const existing = get('SELECT id FROM admins WHERE email = ?', e);
if (existing) { run('UPDATE admins SET password_hash = ?, name = ? WHERE id = ?', hashPassword(password), name || null, existing.id); run("DELETE FROM sessions WHERE kind = 'admin' AND subject = ?", existing.id); }
else run('INSERT INTO admins (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', newId('a_'), e, name || null, hashPassword(password), Date.now());
audit(null, existing ? 'admin.password_reset' : 'admin.create', { email: e });
console.log(`${existing ? 'Updated' : 'Created'} admin ${e}`);
if (!process.env.ADMIN_PASSWORD) console.log(`Password (shown once — store it in a password manager): ${password}`);
