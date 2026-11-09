# Skeleton open questions (2026-11-08)

Questions raised while building the skeleton: company auth (agent A), engine core (agent B), and setup (Claude). Research and recommendations are filled in below each question.

## Read this first

Ten questions came out of the skeleton build. Each one has a recommendation below. Most are small, but three decide how the next build steps (invites and the candidate flow) get written, so answer those first.

| # | Question | Recommendation | Urgency | Blocks |
|---|---|---|---|---|
| Q1 | Email provider | Resend for everything (Supabase Auth emails and the app's own emails), sent from a subdomain; free now, Pro ($20/mo) before the first pilot round | now | All emails: teammate invites, sign-up confirmation, candidate invites and codes |
| Q2 | Confirm email on sign-up | Off only until Q1 is set up (a day or so), then back on, in dev and production | now | Testing sign-up |
| Q6 | Scenarios: code vs. table | Keep agent B's approach: code is the source of truth, each table row is a frozen copy of one version, attempts point at the row | now | Candidate flow (step 4) |
| Q8 | Active company: cookie or URL | Put the company in the URL (`/app/[orgSlug]/…`) now, while there are only a few pages | now-ish | Nothing yet; gets costlier with every page |
| Q10 | Keep Cache Components on | Keep it on; Next's next major version turns it on for everyone | now-ish | Every page we build |
| Q3 | Invite link landing | Server route via `token_hash`, but behind an "Accept invite" button so email scanners can't use up the link | before pilot | Invite reliability |
| Q4 | "Last admin" database rule | Yes, add the trigger | before pilot | Nothing now |
| Q5 | `profiles` table | Yes, add it, synced by trigger | before pilot | Team page, notes, audit log |
| Q7 | Expected answers in score breakdowns | Keep them, company-side only; candidates never see expected answers; no candidate scores in the MVP | before pilot | Candidate report (step 6) |
| Q9 | Company login method | Keep password; add app-based MFA for admins and "Sign in with Microsoft" before the pilot; SAML SSO only when a client asks | before pilot | Nothing now |

**Decide first**

1. **Q1 (email provider):** nothing that emails a person works until this is set up. It's also an action item for you (account + DNS records).
2. **Q6 (scenarios):** the candidate flow has to load "this attempt's scenario" and needs to know where that comes from.
3. **Q8 (cookie vs. URL):** every new page (jobs, candidates, reports) is written differently depending on the answer. Changing it later means touching all of them.

## Decisions

### Q1. Which email provider sends invites, codes, and sign-up confirmations?

**Raised by:** agent A, docs/01 · **Blocks:** inviting new teammates, sign-up confirmation emails, candidate invite emails and 6-digit codes (skeleton step 3–4) · **Urgency:** now

Context: Supabase's built-in email has a very low hourly limit and already returned `over_email_send_rate_limit` during testing; it also rejects `@example.test` addresses. docs/01 lists "Resend or Postmark". Supabase Auth needs custom SMTP configured, and the app will also send its own emails (candidate invites, codes, reminders) — same provider or not?

**Background (plain English):** Two kinds of email go out. Supabase sends "account" emails (teammate invites, confirm-your-email, password reset). Our app sends candidate emails (invite link, 6-digit code, reminders), because candidates aren't Supabase users. Supabase's built-in sender is a demo service: it allows **2 emails per hour** and only delivers to people on your Supabase team, so it can't reach real users at all ([Supabase SMTP docs](https://supabase.com/docs/guides/auth/auth-smtp)). Once you connect your own provider, Supabase allows 30 account emails/hour by default (adjustable). If invites land in spam, candidates don't start and the pilot looks broken. That makes deliverability matter more than price.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Resend for both | Supabase SMTP plus app emails through Resend | One-click Supabase setup ([Resend guide](https://resend.com/docs/knowledge-base/getting-started-with-resend-and-supabase)); modern API; generous free tier | Younger company with a shorter deliverability track record; free tier caps at **100/day**, which one candidate batch can exceed | Free: 3,000/mo, 100/day. Pro $20/mo for 50,000 ([pricing](https://resend.com/pricing)) | Yes: SMTP settings + one email module |
| B. Postmark for both | Same, through Postmark | Long-standing reputation for transactional email; keeps transactional and marketing mail strictly separate | Free tier is only 100 emails/**month**; no one-click Supabase setup (enter SMTP by hand) | $15/mo for 10,000 ([pricing](https://postmarkapp.com/pricing)) | Yes |
| C. Split: Supabase→one, app→another | Two providers | None that matter at our size | Two dashboards, two sets of DNS records, two places to debug bounces | Higher | Yes |

**What others do:** Supabase lists Resend, Postmark, AWS SES, SendGrid, ZeptoMail and Brevo as supported SMTP providers ([docs](https://supabase.com/docs/guides/auth/auth-smtp)). Resend and Supabase have an official integration ([partner page](https://supabase.com/partners/integrations/resend)).

**Recommendation:** A, Resend for both, sending from a subdomain such as `mail.<yourdomain>` with SPF/DKIM/DMARC set. Start free, and move to Pro ($20) before the first real hiring round, since an intern round of 100+ applicants hits the free daily cap. Switch to Postmark if a pilot firm reports invites landing in spam.

**Your decision:** Resend for both Supabase Auth and app emails (decided 2026-11-08).

### Q2. Should "Confirm email" stay on for company sign-up?

**Raised by:** agent A · **Blocks:** testing sign-up without a working email provider · **Urgency:** now

Context: With confirm-email on, new company users must click an email link before logging in. Agent A suggested turning it off during development. Question is also what production should use.

**Background (plain English):** "Confirm email" makes a new user prove they own the address before they can log in. Without it, anyone can sign up as `partner@bigfirm.com`, create a company, and look legitimate to candidates who get invites from it. That's a real phishing risk for a product that emails strangers. Turning it off in development is only needed because email doesn't work yet (Q1). Once Q1 is done, there's no reason to keep it off. A wrinkle: accounting firms mostly use Microsoft 365, whose link scanner can "click" one-time links before the person does (see Q3). A 6-digit code in the email avoids this ([Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)).

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Off until Q1 works, then on everywhere | Temporary dev switch | Unblocks testing today; production is safe | Must remember to switch back | Toggle in dashboard | Yes |
| B. Off in dev, on in prod | Separate settings | Fast local testing | Dev never exercises the real flow, so bugs show up first in prod | Toggle | Yes |
| C. On, using a 6-digit code instead of a link | Template shows `{{ .Token }}`; user types it in | Not affected by Outlook link scanners; same pattern as candidate codes | Small extra screen to build | ~half day | Yes |

**What others do:** Most B2B SaaS require confirmation before the account can invite others. Supabase turns it on by default for hosted projects.

**Recommendation:** A now. Before the pilot, move to C (code instead of link) so Outlook users aren't locked out. Change only if testing with a pilot firm shows links work reliably in their mail system.

**Your decision:** _(blank)_

### Q3. How should teammate invite links land: client page or server route?

**Raised by:** agent A · **Blocks:** nothing urgent; affects invite reliability · **Urgency:** before pilot

Context: Default Supabase invite emails put the session in the URL fragment (`#access_token=…`), which only a browser page can read, so agent A built `/auth/callback` as a client page. Alternative: change the Supabase invite email template to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` so the server route `/auth/confirm` verifies it. Files: `src/app/auth/callback/page.tsx`, `src/app/auth/confirm/route.ts`.

**Background (plain English):** An invite link is a one-time key. The default Supabase link puts the key after a `#`, which only the browser sees. That works, but it's the older "implicit" style that Supabase discourages for server-rendered apps ([SSR guide](https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow-for-ssr)). The `token_hash` template lets our server check the key instead, which is simpler and matches how sign-up confirmation already works. **Research finding:** Microsoft 365's "Safe Links" (common at accounting firms) can open links in the background to scan them. A server route that uses up the key on page load can be "clicked" by the scanner first, so the real person sees "link expired" ([Supabase docs on prefetching](https://supabase.com/docs/guides/auth/auth-email-templates); [Ghost forum report](https://forum.ghost.org/t/magic-links-don-t-work-when-outlook-safe-links-are-enabled/18033); [Microsoft community thread](https://techcommunity.microsoft.com/discussions/microsoftdefenderforoffice365/possible-major-problem-with-ms-defender-scanningclicking-links/3874918)). The current `/auth/confirm` does exactly that. The same applies to candidate invite links: opening `/a/{token}` must not use anything up.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Keep client page (`#access_token`) | Today's build | Works now | Discouraged flow; tokens sit in browser history; still exposed to scanners | None | Yes |
| B. Server route, verifies on page load | Template change only | Simple; one code path | Outlook scanners can use up the link | Template edit | Yes |
| C. Server route behind a button | Link opens an "Accept invite" page; clicking the button posts to the server, which verifies | Survives scanners; one code path | One extra click | ~half day | Yes |
| D. 6-digit code in the invite | User types the code from the email | Fully scanner-proof | More friction for teammates | ~half day | Yes |

**What others do:** Supabase recommends either a code or "link to your own page with a button" for this exact problem ([docs](https://supabase.com/docs/guides/auth/auth-email-templates)).

**Recommendation:** C, and apply the same "button before use" rule to sign-up confirmation and the candidate `/a/{token}` page. Delete the client callback page afterward. If pilot firms still report expired links, fall back to D.

**Your decision:** _(blank)_

### Q4. Add a database rule so a company can never lose its last admin?

**Raised by:** agent A · **Blocks:** nothing now; schema change · **Urgency:** before pilot

Context: App code blocks demoting/removing the last admin, but two simultaneous requests could both pass the check. A database trigger on `memberships` would make it impossible. This is a migration (needs plain-English approval first).

**Background (plain English):** If a company ends up with zero admins, nobody can invite people, change settings, or fix it, and you'd have to repair it by hand in the database. Today the app checks "is there another admin?" before removing one. But if two admins remove each other at the same moment, both checks can pass. It's rare, but a rule inside the database makes it impossible, not just unlikely. The rule would also stop admin removal by any future code path (scripts, new screens) that forgets the check. One detail: the rule must still allow deleting the whole company.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Database trigger | Database refuses any change that leaves a company with 0 admins (locks the company row while it checks) | Guaranteed; covers every code path | One migration to write and test | ~2 hours | Yes (drop trigger) |
| B. App check only (today) | Keep as is | No work | Race possible; future code can skip it | None | n/a |
| C. "Owner" field on the company | One named owner who can't be removed without a transfer | Clear accountability | Bigger model change; owner leaves = support ticket | ~1 day | Harder |

**What others do:** GitLab blocks removing an organization's last owner ([issue](https://gitlab.com/gitlab-org/gitlab/-/issues/423005)). GitHub tells you to add a new owner before removing yourself ([docs](https://docs.github.com/es/enterprise-server@3.5/organizations/managing-organization-settings/transferring-organization-ownership)).

**Recommendation:** A. It's small, permanent protection. The only reason to skip it is if you plan to move to a single named owner (C).

**Your decision:** _(blank)_

### Q5. Add a `profiles` table for teammate names and emails?

**Raised by:** agent A · **Blocks:** nothing now; affects team page, notes, audit log display · **Urgency:** before pilot

Context: Teammate emails are read from Supabase's private `auth.users` via the server-only key, only for people the user can already see. A `public.profiles` table (name, email, avatar) synced from auth would let normal queries show "who wrote this note" without the service key. Schema change.

**Background (plain English):** Supabase keeps user accounts in a locked area (`auth.users`). To show "Jane Smith wrote this note", the app currently uses the master "service" key to look Jane up. That key bypasses all security rules, so the fewer places use it, the better. A `profiles` table copies each user's name and email into the normal area, where the usual company-isolation rules apply. Notes, votes, audit logs and the team page all need names, so this comes up on almost every report screen.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. `profiles` table + trigger | Copy name/email on sign-up and email change; users see only teammates' profiles | Supabase's recommended pattern; normal queries and joins work; service key stays rare | A broken trigger can block sign-ups, so it needs a test | ~half day | Yes |
| B. Keep service-key lookups | Today's approach | No migration | Master key used on every report page; no joins | None | n/a |
| C. Copy name/email onto `memberships` | Store on the membership row | No new table | Stale if the user changes email; duplicated per company | ~2 hours | Yes |

**What others do:** Supabase's own docs recommend a `public.profiles` table synced by trigger, and warn that "if the trigger fails, it could block signups" ([docs](https://supabase.com/docs/guides/auth/managing-user-data)).

**Recommendation:** A, before building notes or the candidate report. Skip only if you'd rather not have a second copy of emails (the copy is tiny and protected by the same rules).

**Your decision:** _(blank)_

### Q6. How do scenarios defined in code relate to the `scenarios` table?

**Raised by:** agent B · **Blocks:** candidate flow (step 4) needs to load an attempt's scenario · **Urgency:** now

Context: Scenario steps and generators live in code (`src/lib/engine/scenarios/`), registered by `slug@version`. The `scenarios` table has `definition` (JSON) and `published_at`. Agent B assumed: table rows point to code by slug + version, with `definition` copied from code at publish time. Alternative: code is the only source; table stores just slug/version/title. Future scenario builder (docs/05 screen 10) lets companies author scenarios — that needs data-defined steps, but generators are code.

**Background (plain English):** A scenario has two parts: the visible content (emails, spreadsheets, instructions) and the secret parts (number generators and scoring). The secret parts must be code. The question is whether the database keeps a copy of the visible part. What matters most: a candidate who started on version 1 must finish and be scored on version 1, even if version 2 ships mid-round. Otherwise two candidates in one round were tested differently, which is a fairness problem (docs/02).

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Code is the source; table row is a frozen copy per version (agent B) | Publishing copies the public definition into a new row; attempts point at the row | Old attempts always reproducible; reports work without code lookups; same table later holds company-built scenarios | Copy can drift if someone edits code without bumping the version | As built; add a check that fails if code and row differ | Yes |
| B. Code only; table holds slug/version/title | Everything read from code | Simplest; no copy | Old versions must stay in code forever; the builder needs a redesign later | Less now, more later | Harder later |
| C. Everything in the database | Steps as data, generators picked by name | Builder-ready | Generators and scoring are code anyway; big build now | High | Hard |

**What others do:** HackerRank says question edits don't affect candidates already mid-test, and recommends cloning library questions rather than editing them ([test edits](https://hackerrank-knowledge-base.help.usepylon.com/articles/3765449705-i-made-changes-to-test-content.-when-does-it-take-effect-for-the-candidates%3F), [library questions](https://hackerrank-knowledge-base.help.usepylon.com/articles/7502854057-can-i-edit-hackerrank-library-questions%3F)). Docs/02 already locks settings once candidates start.

**Recommendation:** A, with two rules: a published version is never edited (change = new version number), and a test fails if code and the stored copy differ. Revisit when the scenario builder starts.

**Your decision:** Code is the source of truth; publishing freezes a copy in the table; attempts point at that row (decided 2026-11-08).

### Q7. Should score breakdowns include the expected answer?

**Raised by:** agent B · **Blocks:** candidate report design (step 6) · **Urgency:** before pilot

Context: Score notes currently say e.g. "expected $202.52". Fine for company reports (docs/05 wants "what the candidate did vs. the expected answer"). Risk only if candidates ever see their score breakdown (docs/04 "Done" screen, docs/04 screen 9 "candidate profile" later). Decide whether candidates ever see scores/feedback.

**Background (plain English):** Recruiters need "candidate said $6,000, expected $5,500" to trust the score. Candidates seeing expected answers is different: because numbers are generated per candidate, one person's answers don't help another, but the *method* leaks. Over time that turns the simulation into a known test. Showing candidates *some* feedback does help: Codility reports lower drop-out when candidates see a basic score. Candidates in some places can also legally request their data (TestGorilla notes this under GDPR), so the company-side notes shouldn't contain anything we couldn't defend.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Company-only details; no candidate scores in MVP | Keep "expected" notes; the Done screen shows thank-you only (docs/04 as written) | Simplest; protects scenarios | Candidates get no feedback | None | Yes |
| B. A + optional coarse feedback later | Company can turn on "you scored 72%" or skill-level feedback, never answers | Better candidate experience; matches competitors | Needs a separate candidate-safe summary | ~1 day later | Yes |
| C. Full breakdown to candidates | Same view as the company | Transparent | Leaks method and answers; companies unlikely to want it | Low | Hard (once leaked) |

**What others do:** Codility: candidate score feedback is opt-in per account or test, showing a basic breakdown ([docs](https://support.codility.com/hc/en-us/articles/360043826373-Automated-Candidate-Feedback)). TestGorilla: shares results with candidates by default on newer accounts, but not exact questions and answers ([profiles](https://support.testgorilla.com/hc/en-us/articles/18223035807515), [sharing](https://support.testgorilla.com/hc/en-us/articles/9028448342811)). Vervoe has an opt-in candidate feedback feature ([help](https://help.vervoe.com/hc/en-us/articles/22667146745748-Enabling-the-Candidate-Feedback-Feature)). HackerRank: no candidate-facing score found in its docs.

**Recommendation:** A now, designed so B is easy: keep candidate-safe summaries as a separate field from the company's "expected" notes, never the same text. Change if a pilot firm wants candidate feedback for its employer brand.

**Your decision:** _(blank)_

### Q8. Active company: cookie or URL?

**Raised by:** agent A (judgment call) · **Blocks:** nothing; easy now, harder later · **Urgency:** now-ish (cheaper to change early)

Context: Users in several companies switch via a cookie (`active_org`), re-checked against memberships on every request. Alternative: put the company in the URL (`/app/[orgSlug]/…`), which makes links shareable between teammates and makes multi-tab use with two companies safe.

**Background (plain English):** Most accounting-firm users belong to one company, so day to day this rarely shows. Where it shows: a recruiter pastes a candidate report link to a partner, and with a cookie the link opens in whatever company the partner last used, or says "not found". Your own team (setting up pilots per docs/05) will belong to several client companies at once. With a cookie, two tabs on two clients can quietly act on the wrong company. Every page built from now on is shaped by this choice, so it's cheapest to decide while there are only four pages.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Company in URL (`/app/acme-cpa/candidates`) | Slug in every app link | Shareable links; safe multi-tab; obvious which company you're in | Slug rules (unique, rename handling); restructure four pages now | ~1 day now; more later | Costly later |
| B. Cookie (today) | Remember last-picked company | Built; short URLs | Wrong-company links and tabs; your team works across clients daily | None | n/a |
| C. Cookie + "resource decides" | Keep cookie, but a report link carries its own ID, and the server switches company to match | Links work | Multi-tab still unsafe; switching on page load surprises users | ~half day | Yes |

**What others do:** Linear, GitHub and Vercel put the workspace in the URL and let one login hold several ([Linear docs](https://linear.app/docs/workspaces)). I couldn't find public docs on how assessment vendors (TestGorilla, HackerRank) structure workspace URLs.

**Recommendation:** A, done now before jobs, candidates and reports pages exist. Stay on B only if you're confident your team will never operate pilot companies from inside the app.

**Your decision:** Company in the URL (`/app/[orgSlug]/…`) (decided 2026-11-08).

### Q9. Login method for company users

**Raised by:** agent A (judgment call), docs/02 · **Blocks:** nothing now · **Urgency:** before pilot

Context: Built email + password only. docs/02 says "email + password or magic link; MFA required for admins; SAML SSO later". Questions: add magic link? Google sign-in? When to require MFA for admins?

**Background (plain English):** Company users see candidates' personal data, webcam snapshots and scores, so a stolen password is a real breach. MFA (a 6-digit code from an authenticator app) is the cheapest strong protection and is **free on every Supabase plan**; text-message MFA costs $75/month ([pricing](https://supabase.com/pricing), [MFA docs](https://supabase.com/docs/guides/auth/auth-mfa)). Magic links have the same Outlook-scanner problem as Q3. Accounting firms overwhelmingly run Microsoft 365, so "Sign in with Microsoft" fits them better than Google. Enterprise SAML SSO is available on Supabase Pro ($0.015 per user after the first 50).

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Password + authenticator MFA for admins | Admins must enroll; the database blocks admin actions without MFA | Free; meets docs/02 | Setup step for admins | ~1 day | Yes |
| B. A + "Sign in with Microsoft" | Supabase's Azure login provider | Matches firms' existing accounts; fewer passwords | Firm IT may need to approve the app | ~half day + Azure app registration | Yes |
| C. Magic link | Email link instead of password | No passwords | Outlook scanners; slower logins | ~half day | Yes |
| D. SAML SSO | Firm's identity system controls access | What large firms ask for | Pro plan; per-client setup | Pro + ~1 day per client | Yes |

**What others do:** docs/02 already plans MFA for admins and SSO later. Supabase can require MFA in the database itself ([MFA docs](https://supabase.com/docs/guides/auth/auth-mfa)).

**Recommendation:** A before the first pilot, B if the pilot firm uses Microsoft 365, D only when a client asks. Skip magic links. Change if a pilot firm mandates SSO from day one.

**Your decision:** _(blank)_

### Q10. Keep Next.js "Cache Components" on?

**Raised by:** agent A (judgment call) · **Blocks:** nothing; affects every page we build · **Urgency:** now-ish

Context: Next 16's Cache Components mode was on in the scaffold. It caused stale redirects and session-read errors that agent A fixed with `connection()`, per-page `loading.tsx`, and `revalidatePath`. It pre-renders static parts for speed. Alternative: turn it off for simpler, fully dynamic app pages, since nearly every page is per-user.

**Background (plain English):** Cache Components makes Next.js build a ready-made "shell" of each page ahead of time, then fill in user-specific parts as they load. For a logged-in app, almost everything is user-specific, so the speed gain is small and the rules are stricter. That's what caused the bugs agent A fixed. **Research finding:** the bundled Next 16.4 docs say Cache Components and partial prefetching "will be enabled everywhere in the next major release, and the options will be removed" (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md`). Turning it off now means migrating later anyway. The docs also give a per-page escape hatch, `export const instant = false`, which lets a page simply wait on the server (`.../02-guides/authentication-with-cache-components.md`).

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Keep on, with a house pattern | Session reads behind `connection()`/Suspense; mutations call `revalidatePath`; `instant = false` on tricky pages | Matches where Next is going; fixes already done; candidate pages can show a fast shell | Stricter rules; new contributors hit the same errors | Low (write the pattern down) | Yes |
| B. Turn off | Classic fully dynamic pages | Simpler mental model today | Forced migration at the next major version; loses the shell for candidate pages | Low now, a migration later | Yes, but redone later |

**What others do:** Next's official guides now assume Cache Components; the old model is documented as "Caching and Revalidating (Previous Model)" (`.../02-guides/caching-without-cache-components.md`).

**Recommendation:** A. Write the three-rule pattern into the repo docs so every page follows it. Turn it off only if the same kind of bug keeps costing more than a few hours per page.

**Your decision:** Keep Cache Components on (decided 2026-11-08).

## Judgment calls already made (review optional, not blocking)

- **Engine client/server split by folder** (agent B): each step type has `public.ts` / `client.tsx` / `server.ts`; rejected one combined object (would leak `score()` into the browser bundle).
- **Generator returns `{ values, keys }`** (agent B): keys never reach templates; rejected recomputing keys inside `score()`.
- **Scheduled inbox messages withheld by the server** until their minute (agent B); rejected sending all and hiding in the browser.
- **Partial credit for numeric steps** (agent B): full within tolerance, half within a wider band, else 0; rejected linear sliding credit.
- **Money stored as whole cents** (agent B).
- **RNG: hand-written sfc32 + cyrb128** (agent B); rejected adding the `seedrandom` package.
- **Sign-up doesn't ask for a company; onboarding does** (agent A).
- **Service key only for auth admin calls; all data writes go through the user's own client so RLS applies** (agent A).
- **Adding an existing user to a company is instant, no email** (agent A).
- **Candidate secrets in separate server-only tables** (Claude, approved).

## Action items (only you can do these)

- [ ] Supabase → Auth → URL Configuration: set Site URL; add redirect URLs `http://localhost:3000/**` and later `https://<vercel-domain>/**`.
- [ ] Create the Vercel project from the GitHub repo and add the 4 env vars.
- [ ] Push `feat/skeleton` when ready.
- [ ] (Q1) Create the email provider account, verify a sending subdomain (add its SPF/DKIM/DMARC DNS records), then connect it to Supabase (Resend: Integrations → Supabase, or Supabase → Auth → SMTP settings). Built-in Supabase email only delivers to your Supabase team members, 2/hour.
- [ ] (Q1) After SMTP is on: Supabase → Auth → Rate Limits, raise the email limit above the default 30/hour if you expect bursts of teammate invites.
- [ ] (Q3, once decided) Supabase → Auth → Email Templates: update the Invite (and Confirm sign-up) template to the agreed link or code format.
