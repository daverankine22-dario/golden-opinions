# Golden Opinions — launch guide

Follow these steps in order. Steps 1 and 2 involve outside approvals, so **start them first**: they run in the background while everything else is set up.

| Service | What for | Rough cost |
|---|---|---|
| Twilio | Log-in codes, confirmations, winner texts | Monthly number fee + a few cents per text, plus one-time 10DLC registration fees |
| Postmark | Log-in codes, confirmations, winner emails, campaigns | Free tier to start, then about $15/month |
| Render (or any Docker host) | Runs the app and stores the database | About $7/month server + about $0.25/GB/month disk |
| Your domain registrar | DNS records | You already have this |

---

## 1. Texting: Twilio + A2P 10DLC registration (start today)

US carriers require businesses to register before texting customers from a regular 10-digit number. Approval can take from a few days to a few weeks.

1. Create a Twilio account and upgrade it (add billing).
2. **Buy a local phone number** (Phone Numbers → Buy a number) with SMS capability.
3. **Register your brand** (Messaging → Regulatory Compliance → A2P 10DLC). You'll need your legal business name, EIN and address, exactly as the IRS has them.
4. **Create a Messaging Service** (Messaging → Services) and add your number to it.
5. **Register a campaign** on that Messaging Service:
   - Use case: *Mixed* (account notifications, 2FA codes and marketing alerts).
   - Description: "Golden Opinions survey platform. We send one-time log-in codes, survey entry confirmations, prize winner notifications and, only to people who opt in, alerts about new surveys."
   - How people opt in: "Users enter their mobile number when creating an account at [your domain] and receive a one-time verification code. New-survey alerts are a separate, unchecked opt-in checkbox on the sign-up form and in account settings." Attach a screenshot of the sign-up page.
   - Sample messages: copy them from the app, for example "Golden Opinions: your code is 123456. It expires in 10 minutes. Don't share it with anyone." and "Golden Opinions: You're entered! Thanks for completing "Everyday Shopping Habits". Entry #ABC123. Winners are notified directly. Reply STOP to opt out."
   - Turn on **Advanced Opt-Out** so STOP / HELP replies are handled automatically.
6. In the Messaging Service → Integration, set the **incoming message webhook** to `https://YOUR-DOMAIN/api/webhooks/twilio` (POST). This keeps alert preferences in sync when someone texts STOP.
7. Copy these for step 4: **Account SID**, **Auth Token**, **Messaging Service SID**.

## 2. Email: Postmark (start today)

1. Create a Postmark account and a **Server** called "Golden Opinions".
2. **Sender Signatures → Add Domain** → your domain. Add the **DKIM** and **Return-Path** DNS records Postmark shows you at your registrar, then click Verify.
3. Add a DMARC record if you don't have one: TXT record at `_dmarc` with value `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`.
4. Request account approval (Postmark reviews new accounts before you can email the public). Mention: one-time codes, confirmations and winner notices, plus opt-in survey alerts with an unsubscribe link.
5. Optional: create a **Broadcast** message stream for campaign emails (keeps marketing separate from codes and confirmations).
6. Copy the **Server API token** for step 4.

## 3. Put the code in a private GitHub repository

Create a private repo (for example `golden-opinions`) and upload this folder. A developer can do this in a minute with `git init && git add . && git commit -m "Golden Opinions" && git push`.

## 4. Hosting on Render

1. Create a Render account and connect GitHub.
2. **New + → Blueprint** → choose the repo. Render reads `render.yaml` and creates one web service with a 1 GB persistent disk mounted at `/data` (that disk holds the database).
3. Fill in the values it asks for:
   - `PUBLIC_URL` = `https://goldenopinions.com` (your real domain)
   - `ADMIN_HOST` = `admin.goldenopinions.com` (the admin console only opens on this address)
   - `COMPANY_NAME`, `COMPANY_ADDRESS` (shown in email footers; required for marketing email), `SUPPORT_EMAIL`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`
   - `POSTMARK_SERVER_TOKEN`, `EMAIL_FROM` (for example `Golden Opinions <hello@goldenopinions.com>`, on the domain you verified)
   - `APP_SECRET` is generated for you.
4. **Custom domains** (Settings → Custom Domains): add `goldenopinions.com`, `www.goldenopinions.com` and `admin.goldenopinions.com`. Render shows the DNS records to add at your registrar (usually an A record for the root and CNAMEs for `www` and `admin`). HTTPS certificates are issued automatically.
5. Open `https://goldenopinions.com/healthz`. It should say `{"ok":true}`.

> Not using Render? Any host that runs a Docker container with a persistent volume works (Fly.io, Railway, DigitalOcean, a VPS). Mount the volume at `/data` and set the same environment variables.

## 5. Create your admin account

In Render, open the service → **Shell** and run:

```bash
npm run create-admin -- you@goldenopinions.com "Your Name"
```

It prints a strong password **once**; save it in a password manager. Run it again for each staff member. Running it for an existing email resets that person's password.

Log in at `https://admin.goldenopinions.com`: email + password, then the 6-digit code sent to your email.

## 6. Set up your first survey

1. **Overview → Gold Note size**: the ounces of gold in each Gold Note (e.g. 0.001). **Overview → Internal Gold Note rate**: today's dollar value of one note. The rate is never shown to participants; it only enforces the $999 / 12-month limit and the $5,000 per-survey cap.
2. **Surveys & reports → + New survey** (or **+ Sample survey** to see every answer type). Fill in the Spanish (🇪🇸 Español) sections, fill in **Prizes by place** (number of winners and Gold Notes for 1st, 2nd and 3rd place; the gold each winner receives is calculated for you), set the end and drawing dates, and use **Preview on phone**.
3. Set **Status → Live** and save.
4. Make the QR code for your posters point at `https://goldenopinions.com`.

## 7. Before you open to the public

- [ ] Your attorney has finalized the **Terms, Privacy Policy and Official Rules**. A developer replaces the template text in `public/js/app.js` (`viewLegal`), including the mail-in entry address and sponsor details. Get a professional Spanish translation.
- [ ] Each survey's total prize pool is under **$5,000**, or you've registered and bonded in New York and Florida.
- [ ] Your attorney has decided whether to name the Gold Notes' issuer, and the issuer has approved any use of its name or images.
- [ ] Twilio campaign approved and Postmark approved. The admin header shows "Texts on" and "Email on" (not TEST MODE).
- [ ] Soft launch: staff and friends sign up, take a survey, receive codes and confirmations, you draw them as test winners, they claim, you mark shipped. Then delete the test survey or close it.

## 8. Drawing day

1. Update the **Internal Gold Note rate** (Overview). **Draw winners** fills 1st place first, then 2nd, then 3rd.
2. Open the survey's report → **Draw N winners** → check the date, rate and claim deadline → **Draw & notify**. Winners get a text and an email immediately; anyone who would exceed $999 in 12 months is skipped automatically.
3. **Winners → To ship**: when someone claims, buy or pull the notes, ship them insured with tracking, then **Mark shipped** (the winner is notified).
4. Reminders go out automatically on day 3 and day 7. After the deadline, **Draw alternate** fills the spot.

## 9. Backups

- Render takes **daily snapshots** of the persistent disk automatically (restorable from the dashboard).
- For an off-site copy, run `npm run backup` (in the Shell or as a Render cron job). It writes a consistent copy to `/data/backups/`; copy those files to cloud storage regularly.

## 10. Security habits

- Only give admin accounts to staff who need them. Use a unique password for each and never share accounts.
- The audit log records every staff sign-in, draw, winner change, export and campaign (`/api/admin/audit`).
- If a laptop is lost, reset that person's password with `create-admin`. This signs them out everywhere immediately.
- Keep Node.js up to date by redeploying occasionally. The Dockerfile always uses the latest Node 22.
