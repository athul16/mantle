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

All three roles are built and enforced twice: in server code (`requireMembership` / `requireOrgMembership` in `src/lib/auth.ts`) and in the database (RLS policies). The team page (`/app/<slug>/team`) lets admins invite by email, change roles, and remove members; others see it read-only. A company can't drop to zero admins (checked in app code; a database rule for this is open decision Q4). Viewers see proctoring media only when the company setting `viewers_see_media` is on.
