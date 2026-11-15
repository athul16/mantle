# 13 · Design system

The product is called **Mantle**. Every screen follows the clickable prototype in [`design/prototype.html`](design/prototype.html) (open it in a browser; the "Prototype controls" pill in the bottom-left corner switches between recruiter and candidate screens and states). **The prototype is the source of truth for how the app looks.** When a screen in the app and the prototype disagree, change the app, unless the difference is listed below as deliberate.

## Where things live

| What | Where |
| --- | --- |
| Tokens (colours, fonts, shadows) and all component classes | `src/app/mantle.css`, ported unchanged from the prototype's `<style>` block |
| Tailwind | `src/app/globals.css` loads Tailwind's theme and utilities only, **no preflight**: the prototype's own reset depends on browser defaults |
| Fonts | `src/app/layout.tsx`: Inter (body) and Space Grotesk (h1, h2, `.display`) through `next/font` |
| Mantle mark, company logo tile, avatars | `src/components/brand.tsx` (`MantleMark`, `CompanyLogo`, `Avatar`, `initials`) |
| Icons | `src/components/icons.tsx`: `<Icon name="…" />`, the prototype's 24×24 stroke set |
| Form primitives | `src/components/ui.tsx`: `Field`, `Button` / `buttonClass`, `Notice`, `FormMessage`, `AuthCard` |
| Company shell (header, tabs, account menu) | `src/app/app/[orgSlug]/layout.tsx`, `org-switcher.tsx` |
| Candidate shells (dark brand sidebar, candidate header) | `src/app/a/ui.tsx` and the workspace files under `src/app/a/[token]/` |

## Rules

- Use the classes in `mantle.css` (`.btn`, `.btn-primary`, `.btn-dark`, `.card`, `.badge b-ok|b-warn|b-bad|b-accent`, `.input`, `.label`, `.tbl`, `.sheet`, `.eyebrow`, `.muted`, `.row`, `.col`, `.g8`…) and the tokens (`var(--accent)`, `var(--line)`…). The prototype sets layout with inline styles; matching it that way is fine.
- One accent colour (blue `#1B45CA`). Status is always colour + icon + label, never colour alone.
- Candidate screens carry the **company's** name and logo tile; Mantle stays in the background ("Powered by Mantle"). Company screens carry the Mantle mark.
- Light theme only (the prototype has no dark mode).
- To change the look of everything at once, change the tokens in `mantle.css`, then update `design/prototype.html` to match.

## Screens

| Prototype screen | App route |
| --- | --- |
| Sign in / Create a company account | `/login`, `/signup` |
| Set up your company | `/onboarding` |
| Set your password (invited teammate) | `/auth/set-password` |
| Two-factor code / setup / your authenticator apps | `/app/account/verify`, `/app/account/security` |
| Jobs (+ create job) | `/app/<slug>/jobs` |
| Assessments library, Configure assessment | `/app/<slug>/jobs/assessments` |
| Invite candidates | `/app/<slug>/jobs/<jobId>/invite` |
| Candidates · list | `/app/<slug>/jobs/<jobId>`, `/app/<slug>/candidates` |
| Candidate report | `/app/<slug>/candidates/<inviteId>` |
| Team, Settings | `/app/<slug>/team`, `/app/<slug>/settings` |
| Invite email, code email | `src/lib/jobs/emails.ts`, `src/lib/email/` |
| Invite landing, verify, system check, instructions | `/a/<token>`, `/verify`, `/check`, `/instructions` |
| Workspace, review, done | `/a/<token>/workspace`, `/review`, `/done` |
| Link states (expired, withdrawn, not recognised, error) | `/a/<token>` and its `error.tsx` |

## Deliberate differences from the prototype

Keep these unless the team decides otherwise:

- **Links inside running text are underlined** (`mantle.css`, "app additions"). The accent blue on near-black text fails axe's `link-in-text-block` check, which CI runs on every page.
- **Read-only users see text, not disabled controls**, on Team and Settings (the prototype greys out the controls). This is clearer and more accessible.
- **Honest copy where the app works differently:** no "AI-suggested" wording (nothing is AI-scored yet), rubric scores are number inputs (partial points), the monitoring overlay says the timer keeps running (team decision D4: it never pauses, and the report shows each gap), and an invite batch with an invalid address is blocked rather than skipped.
- **Scores show one decimal**, so close candidates aren't hidden as ties.
- **The Create job dialog keeps a time-zone note** under "Invites close" (invites expire at the end of that day in the recruiter's time zone).
- **Two-factor setup shows the QR code after a click**, so a page reload can't create two enrolments.
- **The invite email subject starts with the company name**, because the sender is a shared no-reply address.

Prototype features the backend doesn't support yet are not shown in the app (no dead buttons, no made-up data). They are listed in `10-progress.md` under "Prototype features not built yet".
