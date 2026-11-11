# 04 · Candidate experience

No account, no download. Desktop/laptop only for MVP; phones get a "please switch to a computer" page (except the phone side camera page in phase 2).

## Screens

| # | Screen | Contents | Phase |
| --- | --- | --- | --- |
| 1 | Invite email | Company name and logo, role, time needed, deadline, start link | MVP |
| 2 | Verify | Name, email code, consent to monitoring, whom to contact for accommodations (the company's contact email) | MVP |
| 3 | System check | Browser, screen size, connection; camera permission, entire-screen share, start photo (if enabled); phone QR pairing (phase 2) | MVP |
| 4 | Instructions | Scenario intro, time limit, allowed tools, rules, one untimed practice step | MVP |
| 5 | Simulation workspace | See layout below | MVP |
| 6 | Review and submit | Unanswered/flagged steps, final submit | MVP |
| 7 | Done | Thank-you, what happens next, company contact, optional 1-question survey | MVP |
| 8 | Resume / expired | Reopen link to resume with remaining time; clear expired message | MVP |
| 9 | Candidate profile | Reuse a verified result across companies | Later |

## Simulation workspace layout

- **Top bar:** timer (server-backed), scenario name, saved indicator, small camera preview, screen-share status.
- **Left:** inbox. Messages can arrive over time (scheduled by the scenario). Unread counts, timestamps.
- **Right:** workspace. Opens whatever the current message or task needs: spreadsheet grid, PDF/document viewer, journal entry builder, reply composer, multiple choice.
- **Built-in calculator** for accounting.
- **Banners:** shown immediately if camera or screen share drops; the test pauses until restored.

## Behavior

- Every change autosaves.
- Candidates can move between open tasks freely unless the scenario locks a step.
- All actions are timestamped (opened message, started task, submitted step) for process signals in the report.

## Accommodations (as built, decision D9)

- The verify page and the monitoring notice tell candidates whom to ask for extra time or to take the test without a camera or screen share: the company's contact email (Settings), or "the hiring team" when none is set.
- A recruiter or admin sets accommodations per invite before the candidate starts: +25%, +50% or +100% time, and/or no camera / no screen share. The instructions page shows the longer limit ("45 minutes (includes 50% extra time)") and which monitoring is excused. The extra time is part of the server deadline; the browser timer only displays it.

