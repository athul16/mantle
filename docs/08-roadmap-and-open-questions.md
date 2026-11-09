# 08 · Roadmap and open questions

## Phases

Each phase starts only after a real company clears the gate.

| Phase | Scope | Gate to next phase |
| --- | --- | --- |
| 1. Build the MVP | Skeleton (accounts, invites, candidate flow, timer, autosave, results table, reports); engine with `inbox_reply` + `spreadsheet` first, then `journal_entry` + `document_review`; camera snapshots + screen share; one accounting simulation | First pilot company signed |
| 2. Pilots | 1 to 2 companies, set up by us (accounting targets and outreach order in `09-go-to-market.md`); one real hiring round each; phone side camera; recruiter feedback | A pilot company would pay |
| 3. Self-serve | Company signup and billing, scenario builder, analytics, ATS integrations, viewer role if not shipped, SOC 2 when asked | |

## Build order for phase 1

1. Repo, Next.js app, Supabase project, schema + RLS
2. Company auth, orgs, memberships
3. Jobs, invites, invite emails
4. Candidate flow: verify, system check, instructions, workspace shell, timer, autosave, submit
5. Engine: step type interface + `inbox_reply` + `spreadsheet`
6. Results table + candidate report
7. Proctoring: browser signals, camera snapshots, screen share, flags
8. `journal_entry` + `document_review`; Example 1 simulation end to end (Example 4 is a shorter 30-minute option that needs only `spreadsheet`, `journal_entry`, and `inbox_reply`)

## Open questions

- **Pharma scope:** pharmacy students (dispensing, dosing, interactions, counseling) or industry roles (QA, regulatory, batch records, SOPs)? Confirm with the first pilot company.
- **Pricing:** free first pilot, then per completed candidate? Per seat? Per job?
- **Simulation length:** target 30 to 45 minutes; validate drop-off in pilots.
- **Rubric scoring model:** which LLM, and how to show reasoning so recruiters trust it.
- **Accessibility:** accommodation flow for candidates without webcams or needing extra time.
- **Legal review:** consent language, retention defaults, biometric and automated-hiring rules.
- **Expert reviewers:** find an accountant and a pharmacist to review scenarios.
