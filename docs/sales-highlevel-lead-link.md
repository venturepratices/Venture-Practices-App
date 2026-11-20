# HighLevel lead link

When someone fills in the Check Availability form in HighLevel, the lead shows up in the Revenue Team's Marketing Inbox by itself. It lands with the next person in the lead rotation (set in Sales settings) and a first call due the next business day. This replaces the hand-off that sends new leads into Pipedrive.

It only saves the lead. It sends no message of any kind (Sales code is not allowed to). The team's text alert stays a HighLevel workflow, and only its trigger changes (step 6).

## Before you start: the key checklist

This follows the approved key safety page (`docs/credentials.md` has the register row).

1. A written reason and DJ's yes: this page is the reason. DJ's yes in chat starts step 1.
2. The code safety work is done and tested: the secret is checked before anything else, the link refuses after 60 leads in 10 minutes or 300 in a day (and tells the admins), nothing is stored except the lead, and a test makes sure this code can never message Slack or email.
3. No spending cap is needed. No paid service is involved.
4. Smallest power: the key can only add leads. It cannot read anything and cannot change an owner, a stage or a status.
5. Owner: DJ. Lives 90 days at most. Put a calendar reminder 7 days ahead when you make it.
6. The register row is already in `docs/credentials.md` (without the key). Fill in the date on the day you make it.
7. Recommended: in Vercel, Firewall, add a rate limit on `/api/webhooks/*` of about 60 a minute per IP.

## Steps

**1. DJ: make the key.** The key is a long random code. This command makes one and puts it on your clipboard without showing it. Run it in PowerShell:

```powershell
([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")) | Set-Clipboard
```

Do not paste it anywhere except steps 2 and 3. Never in chat, email or a doc.

**2. DJ: put it in Vercel.** Open the project, Settings, Environment Variables. Add one named `WEBHOOK_INBOUND_SECRET`. Tick **Production only** and **Sensitive**. Paste the key. Save, then redeploy (restart the app so it sees the new setting).

**3. DJ: build the new HighLevel workflow.** Use the HighLevel account that holds the Check Availability form. Leave the old Pipedrive hand-off alone for now.
- Make a new workflow named "New lead to Revenue Team".
- Trigger: the same one the Pipedrive hand-off uses (the form being submitted).
- Action: **Webhook**. Method POST. Address: the app's address, then `/api/webhooks/leads/intake` (the same address you sign in at).
- Header: add one named `x-shared-secret` and paste the key as its value.
- HighLevel already sends the contact's id, name, email, phone, ZIP and company on its own. In Custom Data, add only what it does not send: `practice_name` and `practice_zip` (use the form's own fields), `form_type` (the form's name), and `event` set to `opt_in`. The app reads these names in other spellings too (for example `Practice Name`).
- If the webhook step has no place for a header, tell Claude before going further. The key can also go in Custom Data as `secret`, but a header is safer.
- Clear your clipboard when both steps are done: run `Set-Clipboard $null`.

**4. DJ and Claude: test it.** Make a test contact in HighLevel whose practice and name both start with `TEST ` (for example practice `TEST Webhook Dental`, name `TEST Webhook Lead`) and run the workflow on it.
- HighLevel's workflow history should show the call answered with `"created":true` and a lead id.
- In the app, open Revenue Team, Marketing Inbox. The lead is named after the practice, has an owner from the rotation, and carries a call "Reach out within 1 business day".
- Run the workflow on the same contact again. It should answer `"created":false` and no second lead appears.
- Clean up: Sales settings, Demo data, Remove TEST rows (tick "also remove notes, activities, files and field values the team added on TEST rows"). It asks for your password.

**5. Check the safety pieces once.** Run the workflow once with a wrong header value. HighLevel should show a refusal (401) and no lead appears.

**6. DJ and Claude: switch over, the same day.**
- Turn off the old HighLevel workflow that sends new leads to Pipedrive.
- Change the trigger of "SMS Internal Alert - New Lead (from Pipedrive)" to HighLevel's own new-lead event, so Ben and Robert keep getting the text. Update its text to point at the app.
- Then follow the rest of `docs/sales-pipedrive-cutover.md` (final copy, lock).
- Between step 3 and this step a real lead would arrive in both places and show twice after the next Pipedrive copy. Keep that gap short. If it happens, tell Claude the lead's name and it will be merged.

## If something goes wrong

- Leads stop arriving: look at the workflow history in HighLevel for the answer it got (401 means the key does not match, 503 means the key is not set in Vercel, 429 means a limit was reached).
- To go back: turn the old Pipedrive hand-off on again within 5 minutes, then turn the new workflow off.
- To turn the link off completely: delete `WEBHOOK_INBOUND_SECRET` in Vercel and redeploy. Every call is then refused.
- If the key leaks: delete it in Vercel and redeploy first, then make a new one. Look at Sales history for leads made by the webhook (it shows "webhook" as who made them).

## Changing the key (every 90 days, with no gap)

1. Make a new key (step 1).
2. In Vercel add it as `WEBHOOK_INBOUND_SECRET_NEXT` and redeploy. Both keys now work.
3. Change the header in the HighLevel workflow to the new key. Test.
4. In Vercel, move the new value into `WEBHOOK_INBOUND_SECRET`, delete `WEBHOOK_INBOUND_SECRET_NEXT`, redeploy.
5. Update the date in `docs/credentials.md` and the calendar reminder.

## What it does and does not do

- Makes the practice, the person and the lead. If the email or phone matches a person already there, it uses that person. If the practice name and ZIP match one already there, it uses that practice. It never edits an existing person or practice.
- The same contact sent twice makes one lead. A contact whose earlier lead is already converted or archived gets a new one.
- A contact is matched by HighLevel's contact id, or by email, or by phone (the spec's rule). So two people at one practice who share the office email or phone count as one contact while that lead is open: the second makes no new lead and their name is not saved. If that happens often, tell Claude.
- A request with no contact id, email or phone is matched by the practice name and ZIP (or the person's name), so a retry of it does not make a second lead.
- It never changes an existing lead's owner, stage or status. The only thing it adds to an existing open lead is HighLevel's contact id, when the lead did not have one.
- A text reply from HighLevel is acknowledged and ignored.
- Not built yet, on purpose, and worth deciding: an inbox that saves each request and retries later. Today a crash answers 500 and HighLevel retries by itself. If HighLevel ever stops retrying, that one lead is not saved. The error is recorded in Sentry, and HighLevel keeps the workflow history, so the lead can be sent again.
