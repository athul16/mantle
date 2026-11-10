# Pilot runbook

Step-by-step launch checklist for the first pilot company, and what to do when something goes wrong. Work top to bottom; every step has a check. `APP` below means the production URL (the value of `NEXT_PUBLIC_APP_URL`, e.g. `https://assess.yourdomain.com`).

## 1. Email: Resend

App emails (candidate invites, 6-digit codes) go through Resend. Company emails (teammate invites, password reset) go through Supabase Auth, which should also send through Resend.

1. Create a Resend account. Add your sending domain (Resend → Domains → Add domain), add the DNS records it shows (SPF, DKIM, and the MX/return-path record), and wait until the domain shows **Verified**.
2. Create an API key (Resend → API Keys, permission "Sending access", restricted to that domain). This is `RESEND_API_KEY`. Store it only in Vercel and your password manager.
3. Pick the sender, on the verified domain, e.g. `Acme Assessments <assessments@yourdomain.com>`. This is `EMAIL_FROM`. The app refuses anything at `example.com` on a deployment.
4. Supabase Auth SMTP: Supabase dashboard → Project Settings → Authentication → SMTP Settings → Enable custom SMTP:
   - Host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key (a separate key named "supabase-smtp" is easier to rotate).
   - Sender email and name: the same address as `EMAIL_FROM`.
   - Raise Auth → Rate Limits → "emails sent per hour" above the built-in default (custom SMTP allows this).

Check: Resend → Emails shows a delivered message after the smoke test in step 8.

## 2. Supabase project

1. Upgrade the organization to **Pro** (Billing). Pro removes the 7-day inactivity pause and gives daily backups.
2. Authentication → URL Configuration:
   - **Site URL**: `APP`
   - **Redirect URLs**: `APP/auth/callback`, `APP/auth/confirm`, `APP/auth/set-password`. Add `http://localhost:3000/**` only if you still sign in to the cloud project from local dev.
3. Authentication → Sign In / Providers: email confirmations on. Admin MFA is covered by the admin MFA work; turn it on for every admin before inviting the pilot.
4. Storage: the `proctoring` bucket must exist and be **private** (created by the migrations). `/api/health` reports `storage: false` if it is missing.
5. Migrations: every file in `supabase/migrations/` is applied (`supabase migration list --linked` shows local and remote in step).

## 3. Vercel

Project → Settings → Environment Variables. Set each for **Production**, and for **Preview** too if you use preview deployments (previews share the cloud database and must not lose email, so the app requires email config there as well).

| Variable | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Public |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | Server only, mark **Sensitive** |
| `NEXT_PUBLIC_APP_URL` | `APP` | No trailing slash. Used in invite links |
| `RESEND_API_KEY` | `re_...` | Server only, **Sensitive**. Required: without it every invite and code send fails with a clear error |
| `EMAIL_FROM` | `Name <address@your-verified-domain>` | Required. Not `example.com` |
| `CRON_SECRET` | random, at least 32 characters (`openssl rand -hex 32`) | **Sensitive**. Vercel sends it to the retention cron; the cron route rejects calls without it |

Changing an env var needs a redeploy (Deployments → ⋯ → Redeploy) before it takes effect.

Check: `APP/api/health` returns `{"ok":true,"db":true,"storage":true,"email":true}`. Any `false` names the piece to fix: `db` (URL or secret key wrong, project paused), `storage` (bucket missing), `email` (`RESEND_API_KEY` or `EMAIL_FROM` missing or a placeholder). The route never returns values, only booleans.

## 4. Publish the scenarios

Scenarios are code; publishing copies them into the platform library in the cloud database. Safe to re-run (published versions are left alone).

```bash
pnpm scenarios:publish
```

It reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `.env.local`, which points at the cloud project. Each line prints `slug@vN -> <id>`. Re-run after any scenario change that bumps a version.

## 5. Pilot company and team

1. Sign up at `APP/signup` with your own address, confirm the email, and create the pilot company on `/onboarding`. You are its admin.
2. Team (`APP/app/<slug>/team`): invite the pilot's admin(s), recruiters and viewers by email. Each gets a Supabase Auth email and lands on `/auth/set-password`.
3. Once the pilot's own admin has signed in, decide with them whether you stay a member. Never leave the company with zero admins (the app blocks this).
4. Company settings: proctoring default, `viewers_see_media`, and the retention period (retention work).

## 6. Running the pilot

1. Jobs (`APP/app/<slug>/jobs`): create a job, attach an assessment (choose the scenario and time limit), set the invite deadline.
2. On the job page, paste candidate emails or upload a CSV (at most 200 new candidates per batch). The result lists who was invited, who already had an invite, and **who failed to send**; resend those from the invite list.
3. Candidates open their link, ask for a code (one email per 30 s per invite), verify, read the instructions, then start the timer. Answers save as they go; the deadline is enforced on the server.
4. Results (`APP/app/<slug>/candidates`): scores per candidate, then the report. Integrity flags are **suspicious labels with evidence** (time, reason, snapshot). A recruiter confirms or clears each flag; nothing auto-rejects a candidate.

## 7. Data deletion request

When a candidate (or the pilot company on their behalf) asks for their data to be deleted:

1. Confirm the request comes from the candidate's own address or from the company admin. Note the date; respond within 30 days.
2. In the Supabase SQL editor, find the invite(s): `select id, org_id, job_id, status from invites where lower(email) = lower('<address>');`
3. Delete the proctoring media first (it is not removed by the database cascade): Storage → `proctoring` → `<org_id>/<attempt_id>/`, delete the folder for each attempt (`select id from attempts where invite_id = '<invite_id>';`).
4. Delete the invite: `delete from invites where id = '<invite_id>' and org_id = '<org_id>';`. This cascades to the invite secret, attempt, attempt secret, responses, events, flags and snapshot rows.
5. Reply to the requester confirming deletion. Keep only the date and the fact of deletion, not the data.

Once the retention work lands, prefer its delete action over manual SQL.

## 8. Production smoke test

Run after every deploy that matters, and before inviting the pilot. Use a mailbox you control.

1. `APP/api/health` → `{"ok":true,"db":true,"storage":true,"email":true}` and HTTP 200.
2. `APP/` loads; `APP/login` loads; `APP/dev/engine` returns 404.
3. Sign in at `APP/login` as a test admin of a **test company** (not the pilot's). `APP/app` redirects to `/app/<slug>`.
4. Create a job with the demo scenario and a 15-minute limit. Invite your own address.
5. The invite email arrives (check spam too; Resend → Emails shows it delivered). The link is `APP/a/<token>`.
6. Open the link, click Continue, receive the 6-digit code, verify, pass the system check, start, answer one step, refresh the page (the answer is still there), submit.
7. Back in the company app: the candidate shows as completed, with a score and the report.
8. Delete the test candidate (section 7) or keep the test company separate from the pilot.

## 9. When things go wrong

### Emails are not arriving

1. `APP/api/health`: if `email` is `false`, `RESEND_API_KEY` or `EMAIL_FROM` is missing or a placeholder. Fix in Vercel and redeploy. Until then every invite shows as "failed to send" and candidates asking for a code get an error, but nothing is lost: invites exist and can be resent.
2. Vercel → Logs, filter `invite email failed` or `EnvError`. The log names the variable, never its value.
3. Resend → Emails: bounced or blocked? Check the domain is still verified and the address is right.
4. Spam: ask the candidate to search for the company name, and to allowlist the sender.
5. Resend the invite from the job page (this issues a new link; the old one stops working).

### A candidate is stuck

- **"This link isn't valid"**: they copied part of the link, or the invite was resent (old links stop working). Resend and ask them to use the newest email.
- **Code never arrives / "wait a few seconds"**: codes are limited to one per 30 s per invite. Check spam; then follow "Emails are not arriving".
- **"Too many wrong codes"**: they can ask for a new code, which resets the count.
- **Error page with a reference**: their answers are saved. Ask them to retry or reopen the link. Search Vercel → Logs for the reference (it is the error digest) to find the server error.
- **Timer ran out after a crash**: the deadline is enforced on the server and can't be extended or reset in the app, and a started invite can't be revoked or re-invited. If the company agrees to a retake, note the old result, delete the old invite (section 7, steps 3 and 4) and invite the candidate again.
- **Camera or screen permission blocked**: the system check page explains how to allow it in their browser. Proctoring flags are only labels for review.

### The whole app is down

1. `APP/api/health`: `db: false` means Supabase is unreachable (status.supabase.com, or the project is paused or over limits).
2. Vercel → Deployments: roll back to the last good deployment (⋯ → Promote to Production / Instant Rollback).
3. Tell the pilot contact. Candidates mid-attempt keep their saved answers.
