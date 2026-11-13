# Pipedrive cutover checklist

The copy tool reads your Pipedrive account and fills the Sales Command Center with the same people, deals, leads and notes. It never changes anything in Pipedrive.

DJ runs the copy, Claude helps with the HighLevel changes, and Ben checks that his deals look right.

## Before you start

Copied: organizations, people, deals, leads, activities, notes and files. The copy sends no Slack messages or alerts, and no app rules fire. Only admins can open the copy screen.

NOT copied:
- Emails and call logs (emails come with the Gmail project)
- Products on deals
- Labels
- Smart Docs
- Projects
- Campaigns

About files and notes:
- Files over 4 MB, or not a PDF, Word, Excel, PNG or JPG file, are not copied. The report lists them under "Things to look at" so they can be attached by hand.
- Files on leads are copied into storage. The app has no screen for lead files yet, and converting a lead does not move them.
- Notes on people and organizations are copied. The app has no screen for them yet.

## The checklist

1. **DJ: add the Pipedrive token.**
   - In Pipedrive, click your profile picture, then Personal preferences, then the API tab. Copy the token (a long code that lets the app read your Pipedrive account).
   - In Vercel (the service that runs the app), open the project, then Settings, then Environment Variables. Add one named `PIPEDRIVE_API_TOKEN`. Tick Production only. Tick Sensitive if it is offered.
   - Redeploy (restart the app so it sees the new setting).
   - Never paste the token in chat or send it to anyone. The app only uses it to READ from Pipedrive. It is deleted at the end (step 10).
   - Check: the copy screen shows "Pipedrive token ending in" and the last 4 characters. If you still see "Add the Pipedrive key first", the token or the redeploy is not done.
2. **DJ: do a practice run.**
   - In the app, open Sales settings. Find the card "Copy from Pipedrive" and press Open.
   - Press "Practice run (saves nothing)". It reads everything and saves nothing. Stay on the page until it finishes.
   - Read the report. The count table shows New, Changed, Same and Left out for each kind. This is what a real copy would do.
   - "Things to look at" lists problems. Each line names a kind of record, how many times it happened, and a few example Pipedrive ids. Read every line and ask Claude about anything unclear.
   - "Whose records go to whom" is the owner table, one row per Pipedrive user.
3. **DJ: fix the owners.** A Pipedrive person marked "Not matched" has their records go to whoever started the copy. Pick the right team member from the list ("Pick a team member"). A change applies on the next copy.
4. **DJ: press "Copy for real".**
   - It asks no question. Stay on this page. The screen shows the step it is on (Step 1 of 9, and so on).
   - It can pause by itself. If Pipedrive says slow down, the screen says "Pipedrive asked us to slow down. Continuing in a minute." and carries on. Leave the page open.
   - If you leave the page, the copy pauses. Come back and press "Keep going".
   - If it stops with "The copy stopped", nothing is lost. Press "Start again".
   - When it ends, look at "Things to look at" again. If the first line says "File storage is not set up, so no more files were copied.", tell Claude before going on.
5. **DJ, with Ben if possible: check the copy.**
   - Press "Check the copy". It reads every Pipedrive list, so it can take up to a minute.
   - The table shows "In Pipedrive", "In the app", "Left out on purpose" and a Result. "Matches" is good. "short" or "extra" means the app has fewer or more than Pipedrive. Counts should match within 1 percent.
   - Under "Compare these deals in Pipedrive" are 5 deals. Open each one in Pipedrive next to the app. Compare title, value, stage, owner and status.
   - Write down anything that differs and send it to Claude. Do not go on until it is explained.
6. **Ben and Robert, with DJ: a 30-minute walkthrough.** Robert joins only when DJ and Ben have decided Sales is shown to him. Who gets access is decided in Team settings.
7. **DJ and Claude: replace the two HighLevel pieces. Do this BEFORE the final copy (step 8).**
   - The workflow named "SMS Internal Alert - New Lead (from Pipedrive)". It is published and texts Ben and Robert.
   - The hand-off that sends new HighLevel leads into Pipedrive.
   - Both need the HighLevel link into the app (called Plan 3B). That link needs a new key. A new key gets its own safety checklist and your own yes first. No key is made without both. Never paste a key in chat.
   - The text alert probably only needs its trigger changed to HighLevel's own new-lead event. Not confirmed yet.
   - Pipedrive cannot be switched off until both pieces are replaced.
8. **DJ: the final copy, on switch-off day.**
   - Ask the team to stop typing in Pipedrive first. Anything added after the final copy will not reach the app.
   - Press "Copy for real" once more, then "Check the copy" again. Both should look right.
   - Find the box "Final copy and lock". It appears only after a real copy has finished. Type LOCK in capitals and press "Final copy and lock".
   - This copies one last time and ends copying for good. After it, the screen says "Copying is locked" and no copy can run again. If the final copy fails, it does not lock.
   - When it finishes, press "Check the copy" once more to check the final copy.
9. **DJ: keep Pipedrive read-only for 2 weeks.** Use it only to look things up. Nobody types new things in. When the 2 weeks are up, do step 10, then cancel Pipedrive.
10. **DJ: remove the token.** Delete `PIPEDRIVE_API_TOKEN` in Vercel, redeploy, and revoke the token in Pipedrive. Do it after the last "Check the copy" (the check needs the token) and before you cancel Pipedrive (so you can still sign in).

## Good to know

- Pipedrive is the boss until the lock. Copying again copies Pipedrive over the copied records. Edits made in the app to copied people, deals and leads are replaced.
- A deal or lead archived in the app comes back on the next copy.
- A person merged away in the app can get links again on the next copy.
- A custom field value you clear in Pipedrive stays in the app.
- A lead you converted in the app is reset to Pipedrive's status on the next copy.
- A Pipedrive user who is deactivated but still matches a Sales member by email maps to that member.
- A practice run can show slightly more activities and notes than the real copy. It cannot check links, so it counts a few rows the real copy later leaves out.
- "Check the copy" can take up to a minute because it reads every Pipedrive list.
- The report names about 30 left-out files in all. After that it gives one line per reason, with a count.
- Copying does not write to the history log (the Sales history). Look at the run report instead.
- If Check the copy shows a general error, wait a minute and press it again.
- Old meetings copied from Pipedrive never trigger the morning missed-meeting rule. Only meetings made in the app after the copy do.

## If something goes wrong

- Until the final copy, Pipedrive stays the source of truth. Keep using it as normal.
- If the final copy or the switch fails, point the HighLevel hand-off back to Pipedrive within 5 minutes. Put the text alert back too if you changed it.
- If the final copy stops partway, the screen says "The copy stopped" and "It did not lock." Nothing is lost. Press "Start again".
- The copied data stays in the app so Claude can look into what went wrong.
- Nothing was written back to Pipedrive or HighLevel. The tool only reads from Pipedrive, so there is nothing to clean up.
- After the lock, the app cannot copy again. Pipedrive is still the full record. Anything typed into the app since then stays only in the app.

## Note for Ben

> **What it does:** Copies your Pipedrive people, deals, leads, activities, notes and files into the Sales Command Center so you find everything where you expect it.
>
> **What you need to do:**
> 1. Log in to the app.
> 2. Look at your deals.
> 3. Tell DJ anything that looks different from Pipedrive.
>
> **What it costs:**
> - No new tool is needed. The copy tool is part of the app.
> - Copied files use the app's existing file storage.
> - Cancelling Pipedrive after the 2 weeks removes its monthly fee.
>
> **Ready when you are.**
