# 05 · Company experience

The company side turns a pile of applicants into a short ranked list. The candidates table is where recruiters live; build it first and best.

## Screens

| # | Screen | Contents | Phase |
| --- | --- | --- | --- |
| 1 | Sign up / org setup | Company name, logo, invite teammates with roles | MVP |
| 2 | Assessment library | Ready-made simulations (Accounting Intern, Pharma Intern); preview as candidate | MVP |
| 3 | Configure assessment | Time limit, pass score, proctoring toggles (camera, screen, phone) | MVP |
| 4 | Create job | Role name, linked assessment, invite deadline | MVP |
| 5 | Invite candidates | Paste emails, CSV upload, or public link for a job posting | MVP |
| 6 | Candidates table | Status (invited, started, completed, expired), score, percentile, integrity label; sort, filter, bulk advance/reject, reminders | MVP |
| 7 | Candidate report | See below | MVP |
| 8 | Export | CSV of results; PDF per candidate | MVP |
| 9 | Analytics | Invited → completed funnel, score distribution, pass rates | Later |
| 10 | Scenario builder | Companies author or customize simulations | Later |
| 11 | Integrations | ATS sync (Greenhouse, Lever, Workday) | Later |
| 12 | Settings and billing | Branding, email templates, retention, Stripe, SSO | Later |

For pilots, our team can run screens 1 to 3 for the client.

## Candidate report

- **Summary:** overall score, per-task scores, integrity label, time taken.
- **Per task:** what the candidate did vs. the expected answer, with partial credit explained. Rubric-scored tasks show the AI's reasoning per criterion; recruiters can override.
- **Process:** timeline of actions (e.g., "answered urgent email within 2 minutes").
- **Integrity:** each flag with timestamp, reason, and snapshot; confirm or clear buttons.
- **Notes and votes** from teammates.

Example summary:

> Bank reconciliation: tied, 6/6 items correct
> Journal entries: 4/5 (insurance adjustment booked at $6,000 instead of $5,500)
> Invoice review: caught duplicate, missed math error
> Client email: 3/4 on rubric
> Answered the urgent email within 2 minutes; finished in 38 min
