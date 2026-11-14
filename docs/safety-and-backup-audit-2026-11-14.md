# Safety and backup audit, 2026-11-14

Written by Claude (overnight), for DJ. Plain words, no jargon. What is protected, what is weak, what to do next.

## One-line verdict

The app is well guarded on the inside. The big risks are that all of our records live on one company's servers (Vercel and Neon), the only off-site backup is on the same company's storage (Vercel Blob), and nobody has yet pulled a backup back out to prove it actually works. Fix those first.

## What is protected today

**People and permissions.** Every page and every API call has to say who is calling. Passwords are stored as one-way hashes (bcrypt), so a stolen database file would not reveal anyone's password. Admins are a separate flag from Sales access, and Sales access is separate from "can see all deals". After five wrong login tries, the account is locked for a short time. Login over an untrusted link is always on HTTPS. The Bots screen (on the other branch) adds a deny-by-default rule to every Sales route so a bot key cannot open a door we did not list.

**Secrets.** Every outside key (CRON_SECRET, PIPEDRIVE_API_TOKEN, Slack, HighLevel, Google, Neon password) lives in Vercel's environment settings. The app never shows a key to the browser, never puts one in a URL, never writes one in the history log, and never logs one. A rule (`tests/lib/secret-compare-guard.test.ts`) fails the build if a developer compares a secret with the normal equals sign, which could leak the secret by timing. Sentry (where our error reports go) scrubs bot keys and Bearer tokens out of error text.

**Sales is secret.** Sales pages and code never load for someone without Sales access. A build-time test (`check:sales-secrecy`) refuses to ship if a non-Sales page downloads a script that even mentions Sales. Robert cannot see Sales until DJ and Ben decide.

**The copy from Pipedrive.** Read only. Admin only. The token stays in Vercel. The import never calls out to Slack or anywhere else. Every copied row has a Pipedrive id, so re-running the copy updates, it does not duplicate. After the final copy and lock, the import refuses to run again.

**Database backups.** Once a day at 3 AM UTC, the app writes a full copy of every table to Vercel Blob storage. The job lives in `src/app/api/cron/backup/route.ts` and is called by Vercel Cron. A separate restore tool (`scripts/restore-from-backup.ts`) can wipe a database and load a snapshot back in. A test (`tests/lib/backup-coverage.test.ts`) fails the build if a new table is added and not added to the backup list.

**Per-feature safety.** Direct-mail orders, assets with external reviewers, client credentials, calendar tokens, HighLevel messages: each has its own permission or key rules, mostly admin-only for the risky parts.

## What is weak

1. **The off-site backup is on the same company as the main database.**
   The main database is at Neon. Backups are at Vercel Blob. Both are different "failure domains" for a bug or a fat finger, but they are the same company billing-wise and could be reached with the same compromised account. If someone got into the Vercel account, they could delete both. Google Drive would be a true second home, run by a different company.

2. **Nobody has pulled a backup back out yet.**
   The restore script exists and passes unit tests, but we have never run it end-to-end against a fresh database to prove the whole chain works. A backup you have not restored is a story, not a backup.

3. **The backup job's only alert is a silent failure.**
   If the daily backup fails, Vercel marks the cron red and Sentry gets the error. Nobody is paged or messaged. If the job breaks for a week, we would only know by looking. There is no "backup health" page and no "last successful backup was X days ago" alert.

4. **There is no proof we could read the backup without the app.**
   The backup is one big JSON file, which is machine-readable, but a human reading it would have a hard time. If the app were gone and we had only the JSON, we would need a programmer to make sense of it. This is what DJ meant by "even if the app no longer exists, our data are still safe." Today it is "safe" but not "ready to read."

5. **Files in Vercel Blob are not backed up separately.**
   Direct-mail assets, Sales file attachments, and client files live in Vercel Blob. The database points to them. If Vercel Blob lost them (or the account was closed), the database would still point to missing files. There is no off-site copy of the file blobs themselves.

6. **One person's password unlocks admin.**
   The admin password re-check (on bots) is per-session. A stolen admin login lets someone create keys, see every client, and change anything in the app. There is no two-factor sign-in built into the app (we use NextAuth with a password only). An attacker with the admin's password and no second step is in.

7. **The dev database password is in a local file on the laptop.**
   `.env` holds the dev database URL with the password in it. If the laptop is stolen or infected, a reader of that file gets into the dev database. (Not production, but the dev database still has real-looking client data.)

8. **No full key register with "last rotated" dates.**
   A `docs/credentials.md` file exists on the bots branch, but it only lists what exists, not when each key was last changed. Rotation is a game of memory. The bullet-proof rule is that every key should have an expiry and a next-rotate date.

9. **The sync cron (just built) does not alert on failure.**
   It logs to Sentry and keeps the failed run visible on the Import screen, but there is no admin notification. If the sync fails for two days in a row, nobody is told.

10. **No admin health page.**
   DJ has no one place to look and say "everything is green." He has to click into Sentry, into Vercel, into the Import screen, and into the Bots screen (eventually) to put the picture together.

11. **Monitoring is passive.**
   Sentry catches errors when they happen. Nothing checks the app regularly and asks "is it still up, does the login page still render, can we read a deal". A quiet failure that does not throw an error (for example, a cron silently not running) can go unnoticed.

12. **Dependency and security audits are not scheduled.**
   `npm audit` is not run on a schedule. A vulnerable library sits until a developer notices. There is no secret-scanning in CI (no gitleaks).

## What could blow up, worst first

- **Vercel account compromise or closure.** Everything gets locked out at once. The backup is in that account too, so it would be locked out with the rest. Mitigation needs Google Drive (or another company's storage).
- **A bad migration deployed on top of real data.** If a migration drops the wrong column or type, the latest backup is only as old as the previous night's 3 AM backup, and nobody has restored one before.
- **An admin's password leaks.** Adds, edits and deletes everything. No second factor exists in the app itself.
- **Vercel Blob loses a file.** Old client PDFs point to missing files. We do not know until someone opens one.
- **Pipedrive automatic sync overwrites a change Ben made in the app.** This is by design during the switch (Pipedrive is the boss), but if nobody told Ben, he could lose a change.
- **The daily backup job fails for a week.** We would notice only by chance. The oldest safe copy would be however many days back.

## Recommended order, with a short note each

1. **Google Drive off-site backup.** Write each daily backup to a Google Drive folder in the Venture Practices Workspace, alongside Vercel Blob. Google is a different company, with a different login, and a well-known support path.
2. **Tested restore.** Before DJ can say the backup is real, pull last night's backup, load it into a throwaway Neon branch, and open the app against it. Record the result. Repeat every month.
3. **Admin health page.** One screen that shows: last backup time, backup success or failure, last sync times for each integration, failed cron runs this week, Sentry errors this week, open admin alerts. Admin only. Nothing new to monitor, just one place to look.
4. **Backup failure alert.** The daily backup job tells admins (in-app notification and the client Slack digest channel) when it fails, or when it has not run in 36 hours. One line each. No noise on success.
5. **Exit export to Drive in open formats.** A weekly export of records to CSV and JSON into a Drive folder, with files alongside, and a plain README that says "this is how a human reads these files". So the data survives the app.
6. **Key register with rotation dates.** Expand `docs/credentials.md` to one line per key with: what it is, where it lives (Vercel env name), who created it, when it expires, when to rotate, who can revoke it. A reminder to DJ 14 days before each expiry.
7. **Sync failure alert.** The Pipedrive sync tells admins when a run fails or has not finished in 36 hours. Same pattern as the backup alert.
8. **Two-step sign-in for admins.** Email code, authenticator app, or passkey. Admins only at first, then everyone who can see client data.
9. **Secret scan in CI.** A build-time check that refuses to merge if a key or token appears in a source file. `gitleaks` is the usual tool.
10. **Scheduled checks.** Once a day: ping the login page, run the backup restore once a month, check that every cron ran in the last 24 hours. Report in a monthly plain-words report to DJ (what passed, what failed, what you should do next).
11. **Dev database password rotation.** When DJ is back at a long session, change the dev database password in Neon and rotate the `.env` locally. One-time task.
12. **File blob off-site copy.** Copy Vercel Blob files to Drive weekly. More expensive on bandwidth; lower priority than records.

## What I did overnight (14 Nov)

- Fixed the eight old failing tests. The full suite is now 3017 pass, 0 fail.
- Built the automatic Pipedrive to Sales sync. Off by default. Runs three times a day once turned on. See `docs/sales-pipedrive-cutover.md`. Code at `src/app/api/cron/sales-pipedrive-sync/route.ts`.
- Wrote this audit.

## What I did not do and why

- No new admin alerts on failure yet (needs a small design: notification type, message shape, where it lands).
- No Google Drive backup. Needs DJ to set up a Workspace OAuth client and pick a Drive folder.
- No admin health page. Agreed earlier it needs a mockup first.
- No two-step sign-in. Bigger change, affects every user.
- No secret scanning in CI. CI setup is not yet in this repo; I would need to know where CI lives.

## Questions for DJ

1. Which Workspace account owns the Drive folder we will back up to? (The company Workspace, not DJ's personal.)
2. Which Vercel plan are we on? Pro gives us more cron slots and longer functions, which matters for the admin health page and the sync.
3. Are you OK with me writing the mockup for the admin health page next, and showing it to you before I build it?
