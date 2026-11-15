# 04 · Candidate experience

No account, no download. Desktop/laptop only for MVP; phones get a "please switch to a computer" page (except the phone side camera page in phase 2).

## Screens

| # | Screen | Contents | Phase |
| --- | --- | --- | --- |
| 1 | Invite email | Company name and logo, role, time needed, deadline, start link | MVP |
| 2 | Verify | Name, email code, consent to monitoring, accommodations link | MVP |
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
- **Banners:** shown immediately if camera or screen share drops. The task area is covered until it is back, but the **timer keeps running** (decision D4, 2026-11-10); the message tells the candidate so. Each down period (start, end, camera or screen) is recorded, and the report shows the gaps and the total so the recruiter can judge it (see `docs/02-security-and-integrity.md`). A refresh or closed tab during a gap ends it when the source is back, or at submit or the deadline if it never is.

## Behavior

- Every change autosaves.
- Candidates can move between open tasks freely unless the scenario locks a step.
- All actions are timestamped (opened message, started task, submitted step) for process signals in the report.
