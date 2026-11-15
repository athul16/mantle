# 05 · Company experience

The company side turns a pile of applicants into a short ranked list. The candidates table is where recruiters live; build it first and best.

## Screens

| # | Screen | Contents | Phase |
| --- | --- | --- | --- |
| 1 | Sign up / org setup | Company name, logo, invite teammates with roles | MVP |
| 2 | Assessment library | Ready-made simulations (Accounting Intern, Pharma Intern); preview as candidate | MVP |
| 3 | Configure assessment | Time limit, pass score, a required Monitored / Not monitored choice with nothing preselected (decision D5); if Monitored, camera, screen, microphone, require full screen and gaze check (gaze needs the camera; phone later). The server rejects a missing choice | MVP |
| 4 | Create job | Role name, linked assessment, invite deadline | MVP |
| 5 | Invite candidates | Paste emails, CSV upload, or public link for a job posting | MVP |
| 6 | Candidates table | Status (invited, started, completed, expired), score, percentile, integrity label; sort, filter, bulk advance/reject, reminders | MVP |
| 7 | Candidate report | See below | MVP |
| 8 | Export | CSV of results; PDF per candidate | MVP |
| 9 | Analytics | Invited → completed funnel, score distribution, pass rates | Later |
| 10 | Scenario builder | Companies author or customize simulations | Later |
| 11 | Integrations | ATS sync (Greenhouse, Lever, Workday) | Later |
| 12 | Settings and billing | Retention: media and results periods (built, see docs/02). Branding, email templates, Stripe, SSO | Later |

For pilots, our team can run screens 1 to 3 for the client.

## Candidate report

- **Summary:** overall score, per-task scores, integrity label, time taken.
- **Per task:** what the candidate did vs. the expected answer, with partial credit explained. Rubric-scored tasks show the AI's reasoning per criterion; recruiters can override.
- **Process:** timeline of actions (e.g., "answered urgent email within 2 minutes").
- **Integrity:** the label (clear, review or suspicious) with its reasons in plain words, the counters (left the tab, pastes, copies, full screen exits, looked away, no face, speech), and each flag with timestamp, reason and evidence; confirm or clear buttons. For each absence from the window there is a filmstrip of the screenshots taken while away (+2 s, +6 s, every 10 s, and when back). Flags with speech have audio players. Cut and copy count together under Copies.
- **Notes and votes** from teammates.

Example summary:

> Bank reconciliation: tied, 6/6 items correct
> Journal entries: 4/5 (insurance adjustment booked at $6,000 instead of $5,500)
> Invoice review: caught duplicate, missed math error
> Client email: 3/4 on rubric
> Answered the urgent email within 2 minutes; finished in 38 min

## As built (Nov 2026)

- Screen 1 (sign up / org setup) is built: `/signup`, `/login`, `/onboarding`, then `/app/<company-slug>`. Teammates are managed at `/app/<company-slug>/team`.
- Every company page has the company in its URL (decision Q8), so links can be shared between teammates and two companies can be open in two tabs. Plain `/app` opens the last-used company.
- Jobs and Candidates pages exist as placeholders. Screens 2–8 are next (see `10-progress.md`).
- Screen 6 (candidates table), per job: `/app/<slug>/candidates?job=<id>`, linked from the job page ("Results and reports"). Columns: candidate, status (with a "needs review" badge), score (% and points), time taken, submitted. Sort by any column, filter by status or "needs review", search by name or email. Percentile, integrity label, bulk actions and reminders are not built yet.
- Screen 7 (candidate report): `/app/<slug>/candidates/<inviteId>`. Summary (final score, pass mark, time taken, start and submit times); per task, the candidate's answer next to the expected answer rebuilt on the server from the attempt's seed, with points and the scoring note; for `inbox_reply` tasks, the reply, what to look for per criterion, and a rubric form; the attempt timeline from action events; notes with a hire / no hire / unsure vote.
- Rubric review: admins and recruiters enter points per criterion; the database function `review_rubric_step` checks the role and ranges, records who reviewed and when, recomputes the attempt total and writes the audit log. A reviewed task can be changed later. Viewers see everything read-only, but can add notes and votes (`03-roles-and-permissions.md`).
- Job page invite list: email, status, first invited, last sent (with the number of sends after a resend), expiry. Two batches sent at the same moment can't invite the same email twice (database unique index); the later batch reports it as already invited.
- Accommodations (decision D9): each unstarted invite has an "Accommodations" control on the job page for extra time (+25/50/100%) and a camera or screen-share waiver, for that candidate only; the assessment's locked settings don't change. Every change goes to the audit log, and the candidate report shows the accommodations in its summary and the timeline's start line. Admins set the contact email candidates see in Settings.
- Proctoring v2 settings (2026-11-15): the Configure assessment screen has switches for Require full screen, Microphone and Gaze check (gaze is only offered with the camera). The invite drawer's accommodations also waive full screen and microphone per candidate; waivers are shown on the invite row and the report. The report's Integrity card shows the label with its reasons, the new counters and filmstrips; see `docs/02` for the rules and `decisions/2026-11-15-proctoring-v2.md` for why.
