# 03 · Roles and permissions

Roles are per organization, stored as `memberships.role` (`admin` | `recruiter` | `viewer`). Build the column from day one even if viewer ships later.

## Who each role is for

- **Admin:** head of recruiting or whoever signed the contract. Owns billing, users, and company-wide rules.
- **Recruiter:** runs hiring rounds day to day.
- **Viewer:** hiring managers, team leads, interviewers. The person who decides on a candidate is often not the person running the process. They need results without the ability to change anything.

## Permission matrix

| Action | Admin | Recruiter | Viewer |
| --- | --- | --- | --- |
| Billing, plan, SSO, data retention | ✓ | | |
| Add/remove teammates, assign roles | ✓ | | |
| Proctoring settings per assessment | ✓ | ✓ | |
| Create jobs, configure assessments | ✓ | ✓ | |
| Invite candidates, reminders, extend deadlines | ✓ | ✓ | |
| Per-invite accommodations (extra time, camera / screen waiver) | ✓ | ✓ | |
| Candidate contact email (shown to candidates) | ✓ | | |
| Advance or reject candidates | ✓ | ✓ | |
| Confirm or clear suspicious flags | ✓ | ✓ | |
| Export results (CSV, PDF) | ✓ | ✓ | |
| View scores and answers | ✓ | ✓ | ✓ |
| View proctoring snapshots | ✓ | ✓ | Admin setting |
| Notes and hire/no-hire vote | ✓ | ✓ | ✓ |

## Why viewer matters

1. **Prevents costly mistakes:** no accidental bulk rejections or settings changes mid-round.
2. **Privacy:** least-privilege access to candidate data and webcam snapshots; larger clients' security reviews will ask.
3. **Adoption:** if viewer seats are free and recruiter seats paid, companies invite every hiring manager.
4. **Better decisions:** manager notes and votes sit next to the score.

MVP may ship with admin + recruiter only.

## As built (Nov 2026)

All three roles are built and enforced twice: in server code (`requireMembership` / `requireOrgMembership` in `src/lib/auth.ts`) and in the database (RLS policies). The team page (`/app/<slug>/team`) lets admins invite by email, change roles, and remove members; others see it read-only. A company can't drop to zero admins: a database trigger (`memberships_keep_one_admin`) refuses removing, demoting or moving an org's last admin for anyone, the service role included, and the team page shows a friendly message first (decision D13 / Q4). Deleting the whole company, or the person's account, is not blocked. Viewers see proctoring media only when the company setting `viewers_see_media` is on.

Two-factor (decision D1): admins and recruiters must use an authenticator app, and viewers must too while `viewers_see_media` is on, because that lets them see snapshots. See `02-security-and-integrity.md`.

The team page reads names and invite state from `profiles` with the member's own client, so a member sees the emails of people in their own companies only.
