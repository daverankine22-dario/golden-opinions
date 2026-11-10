# Golden Opinions

Take surveys, win gold. A mobile web app for participants, an admin console for your team, and the server behind both.

- **Participant app** (`/`): create account / log in with a 6-digit code by text and email, account recovery, English/Español, pick a survey, all 8 answer types, save a draft, review, submit, confirmations, messages, settings, recent winners, claim a prize.
- **Admin console** (`/admin`, optionally only on `admin.yourdomain.com`): staff log-in (password + emailed code), survey builder with Spanish translations and phone preview, searchable reports with charts and CSV download, Goldback exchange rate, random server-side draws for many winners, winner notices, reminders, claims, shipping, campaigns, participants.
- **Rules enforced on the server**: one entry per survey per email and per phone (also enforced by the database), $999 maximum winnings per person in any 12 months, random draws using a cryptographic shuffle with an audit log, log-in codes that expire after 10 minutes and lock after 5 wrong tries, rate limits.

## Tech

- Node.js 22.5+ with **no npm dependencies** — the built-in HTTP server, `node:sqlite` database and `fetch` for Twilio/Postmark.
- One SQLite file on a persistent disk (`DATA_DIR`). Fine for tens of thousands of participants on a single server.
- Front end: plain JavaScript modules, no build step. `public/js/shared.js` holds the rules and formatting used by both the browser and the server.

```
src/            server: config, db (schema + migrations), http toolkit, participant API, admin API, messaging, server
public/         participant app (index.html, js/app.js, js/ui.js, js/i18n-es.js, js/shared.js, css, img)
admin/          admin console (index.html, admin.js)
scripts/        create-admin, seed-sample, backup
test/           API tests (node --test)
```

## Run it locally

```bash
cp .env.example .env            # then set NODE_ENV= (blank), PUBLIC_URL=http://localhost:3000, DEV_SHOW_CODES=1
npm run seed-sample             # optional: a sample survey with all 8 answer types (English + Spanish)
npm run create-admin -- you@company.com "Your Name"   # prints a password once
npm run dev                     # http://localhost:3000 and http://localhost:3000/admin
npm test                        # 11 end-to-end API tests
```

With no Twilio/Postmark keys the app runs in **test mode**: nothing is sent, messages are written to the server log and the `outbox` table, and (with `DEV_SHOW_CODES=1`, never in production) log-in codes appear on screen.

## Configuration

All settings are environment variables — see `.env.example`. Required in production: `PUBLIC_URL`, `APP_SECRET`, `DATA_DIR` on a persistent disk, Twilio and Postmark keys, `COMPANY_NAME`, `COMPANY_ADDRESS`, `SUPPORT_EMAIL`.

## Deploy

See **SETUP.md** for the full launch checklist (hosting, domain, texting registration, email, first admin, backups).

## API overview

Participant: `GET /api/public`, `POST /api/auth/start|verify|resend|logout`, `POST /api/auth/recover/start|verify`, `GET /api/me`, `PUT /api/me/profile|prefs`, `POST /api/me/contact/start|verify`, `DELETE /api/me`, `GET /api/surveys/:id`, `PUT /api/surveys/:id/draft`, `POST /api/surveys/:id/submit`, `POST /api/wins/:id/claim`, `GET /u/:token` (email unsubscribe).

Admin: `POST /api/admin/login|verify|logout`, `GET /api/admin/me|data|outbox|audit`, `PUT|DELETE /api/admin/surveys/:id`, `GET /api/admin/surveys/:id/export.csv`, `POST /api/admin/surveys/:id/draw`, `PUT /api/admin/settings/goldback`, `POST /api/admin/winners`, `PUT|DELETE /api/admin/winners/:id`, `POST /api/admin/winners/:id/remind|ship|forfeit`, `POST /api/admin/campaigns`.

Webhook: `POST /api/webhooks/twilio` (STOP/START replies; signature-checked).

All state-changing requests must send `X-Requested-With: fetch` (CSRF guard). Sessions are HttpOnly, SameSite=Lax cookies; only token hashes are stored.

## Notes for a developer taking this further

- **Scale**: `/api/admin/data` loads everything for the console — add paging when you pass ~50,000 responses.
- **Postgres**: SQL lives in `src/db.js`, `src/participant.js` and `src/admin.js`; moving to Postgres means swapping the driver and placeholders.
- **Goldback rate**: entered by staff today. If Goldback, Inc. provides a data feed, fetch it in the background job in `src/server.js`.
- **Legal text**: Terms, Privacy and Official Rules in `public/js/app.js` (`viewLegal`) are templates — replace with your attorney's final versions and a professional Spanish translation.
