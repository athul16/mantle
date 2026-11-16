# Pilot decisions (2026-11-10)

Every open decision the team must make before (and soon after) the first pilot company. Collected from earlier decision docs, PR open-decision sections (#17 to #23), batch 3 PRs (admin MFA, retention, launch hardening) and `08-roadmap-and-open-questions.md`. Older docs stay as the record; this file is the one place to decide from.

## Read this first

Sixteen decisions. Ten are needed before the pilot, two during it, four can wait. Research reuses `2026-11-08-skeleton-open-questions.md` (Q2 to Q9) and `2026-11-09-stage-a-open-decisions.md` (S1, S2) where they already covered the ground.

| # | Question | Recommendation | Urgency | Blocks |
|---|---|---|---|---|
| D3 | Consent wording and legal review | Pilot with US (North Carolina) candidates only; a one-off lawyer review of the notice and retention promise before the first real candidate; keep "no face identification" | before pilot | First real candidate |
| D2 | Default retention and what deletion keeps | Snapshots 90 days, results 365 days; keep an anonymised invite row for counts; delete notes and votes with the candidate | before pilot | Retention PR defaults |
| D1 | Who must use MFA; Sign in with Microsoft | Require app-based MFA for admins and recruiters; add Microsoft sign-in only if the pilot firm runs Microsoft 365 | before pilot | Admin MFA PR scope |
| D13 | Sign-up and team rules (Q2 to Q7) | Q7 is built; Q3 is half built; Q2, Q4, Q5 are not. Do Q3, Q4, Q5 in one small PR; turn on Q2 (as a code) once Resend works | before pilot | Pilot sign-up, team page |
| D12 | Invite schema: last sent date, duplicate batches | Do both in one migration now, before real invites exist | before pilot | Nothing, but harder later |
| D4 | Pause the timer when camera or share drops | Pause the server timer, capped at 5 minutes per attempt; show downtime on the report | before pilot | Fairness complaints |
| D9 | Accommodations | Per-invite extra time and proctoring waiver, set by the recruiter; show the company contact in the notice | before pilot | Disabled candidates |
| D5 | Proctoring on by default | No preselection: the recruiter must pick monitored or not | before pilot | Nothing technical |
| D10 | Harbor Lane v1: accept gaps or extend step types | Fix the cheap gaps (first name, date order), accept the rest, publish after the accountant review | before pilot | Publishing the scenario |
| D11 | Report data rules from PR #19 | Keep (a) and (b); for (c) keep the automatic score in its own column | before pilot | Measuring the AI scorer later |
| D14 | Pilot pricing and terms | Free first hiring round with a cap, in exchange for feedback and a reference; then price per completed candidate | before outreach | First pitch meeting |
| D15 | Simulation length | Keep 30 minutes; measure start, completion and time used in the pilot | pilot | Nothing |
| D8 | AI rubric scorer for replies | Not in the pilot's scoring path; run Claude Sonnet 5.5 as a hidden suggestion and compare with human reviews | before scale | Auto-scoring `inbox_reply` |
| D6 | Require full screen; rule thresholds | Keep full screen optional and thresholds as built; revisit after ~30 attempts | after first pilot data | Nothing |
| D7 | Face check | Not for the pilot; later, on-device face counting only, after legal review | later | Nothing |
| D16 | Pharma scope | Defer; ask pilot contacts; lean to industry roles (QA, batch records) | later | Nothing |

**Decide first:** D3, D2, D1, D13 and D12. D3 gates the first real candidate, D2 and D1 decide whether to change what PRs #25 and #27 already built, and D13 and D12 are schema changes that get harder once real companies and invites exist.

## Decided 2026-11-10

All sixteen are decided. Each section below has the choice and the reason under "Your decision". In short:

| # | Decision | Differs from recommendation? |
|---|---|---|
| D1 | B: MFA for admins and recruiters (viewers when `viewers_see_media` is on); no Microsoft sign-in unless asked | No |
| D2 | C: photos/screens 90 days, results 365 days; keep #25's delete-the-row | Yes: no anonymised invite row |
| D3 | No paid lawyer yet; free checks; NC-only pilot; lawyer before charging, leaving NC, or AI scoring | Yes: free checks instead of a paid review |
| D4 | Timer never pauses; flag camera/share downtime on the report | Yes: option A plus a flag, not C |
| D5 | C: recruiter must pick monitored or not | No |
| D6 | A: keep as built, tune after ~30 attempts | No |
| D7 | A: no face check in the pilot | No |
| D8 | B: shadow scoring with Sonnet 5.5, shown to no one | No |
| D9 | B: per-invite extra time + camera waiver, logged; firm email shown | No |
| D10 | B: fix first name and date order, publish after accountant review | No |
| D11 | (a), (b1), (c2) separate `auto_score` column | No |
| D12 | A: both fixes in one migration | No |
| D13 | A (B if the pilot is days away) | No |
| D14 | Holding off; first round free, ask firms | Yes: no price set yet |
| D15 | A: 30 minutes, measure completion | No |
| D16 | C: deferred | No |

J1 to J8, C1 to C5 and E1 to E7 are confirmed as built.

### Build work these decisions create

1. **MFA for recruiters** (D1): extend PR #27's admin-only rule to recruiters, and to viewers when `viewers_see_media` is on.
2. **Two retention clocks** (D2): a media retention value (90) next to results (365); purge snapshots/screens on the first, rows on the second; update the notice text and bump the consent version.
3. **Downtime flag** (D4): record camera/screen-share down periods, add a report flag with total downtime; fix docs/04's "the test pauses".
4. **Monitored / not monitored choice** (D5): replace the pre-ticked boxes in `assessment-forms.tsx` with a required choice.
5. **Accommodations** (D9): per-invite extra time and monitoring waiver, logged on the report; company contact email in the notice and verify page.
6. **Harbor Lane fixes** (D10): first-name templating and date order.
7. **`auto_score` column** (D11 c2), then **shadow AI scorer** (D8) writing to its own column.
8. **Invite migration** (D12): `last_sent_at`, `sent_count`, partial unique index.
9. **Auth hardening PR** (D13): Q3 button pages, Q4 last-admin trigger, Q5 `profiles`; Q2 code after Resend.

## Decisions

### D1. Who must use MFA, and add "Sign in with Microsoft"?

**Raised by:** docs/02, Q9 in `2026-11-08-skeleton-open-questions.md`, batch 3 `pilot-admin-mfa` · **Blocks:** admin MFA PR scope · **Urgency:** before pilot

**Background (plain English):** MFA means a 6-digit code from an authenticator app on top of the password. Batch 3 makes it mandatory for admins only. But recruiters see the same webcam snapshots and candidate data as admins and can act on candidates, so a stolen recruiter password leaks just as much. Viewers see scores, and see snapshots only when the company turns `viewers_see_media` on. App-based MFA is free in Supabase, and the database can refuse requests that didn't pass MFA (the `aal2` level) ([Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa), [MFA via RLS](https://supabase.com/blog/mfa-auth-via-rls)). "Sign in with Microsoft" uses Supabase's Azure provider. It is about half a day of work plus an app registration in Azure, and the firm's IT may have to approve it.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Admins only (batch 3 as drafted) | Only admins must enroll | Least friction | Recruiters hold the same data unprotected | As drafted | Yes |
| B. Admins and recruiters | Every role that can see snapshots or act on candidates must enroll | Covers everyone with real power; one rule to explain | One setup step per recruiter | Small change to the PR | Yes |
| C. Everyone, including viewers | All company users | Simplest rule; what security reviews like | Hiring managers who log in twice a year may skip it | Small | Yes |
| D. Add Microsoft sign-in (any of A to C) | Supabase Azure provider | Firms already use Microsoft 365; no new password | Firm IT may need to consent; a Microsoft login still counts as one factor in Supabase, so our TOTP rule still applies | ~half day + Azure app registration | Yes |
| E. SAML SSO | Firm's identity system controls access | What large firms ask for | Supabase Pro add-on; per-client setup | Pro + ~1 day per client | Yes |

**What others do:** Supabase lets you enforce MFA for all users, new users only, or opt-in ([docs](https://supabase.com/docs/guides/auth/auth-mfa)). For Microsoft, the default tenant (`common`) lets any Microsoft account in; a single firm can be pinned with its tenant URL. Supabase recommends adding the `xms_edov` claim so it can tell whether the Microsoft email is verified ([Supabase Azure guide](https://supabase.com/docs/guides/auth/social-login/auth-azure)). docs/02 already plans SSO "later".

**Recommendation:** B. Recruiters see the same snapshots as admins, so they need the same protection, and the change to the batch 3 PR is small. Viewers should also have to enroll when `viewers_see_media` is on. Add D (Microsoft) only if the pilot firm runs Microsoft 365, keep the common tenant, and add `xms_edov`. Revisit E only when a client asks for it.

> **Status 2026-11-10:** PR #27 (merged) built option A: admins only must use an authenticator app. Picking B means a small follow-up to also force recruiters (and viewers when `viewers_see_media` is on).

**Your decision (2026-11-10):** **B.** Admins and recruiters must use an authenticator-app code; viewers too when `viewers_see_media` is on. Recruiters see the same candidate photos as admins, so they need the same protection. No Sign in with Microsoft unless the pilot firm asks for it. Follow-up to PR #27.

### D2. Default retention period and what deletion keeps

**Raised by:** PR #23, docs/02, batch 3 `pilot-retention` · **Blocks:** retention PR defaults · **Urgency:** before pilot

**Background (plain English):** Today snapshots and answers stay until someone deletes them. The retention PR adds a per-company `retention_days` (draft default 180, allowed range 30 to 730) and deletion on request. Snapshots and screenshots of a candidate's screen are the most sensitive data we hold, and they are only useful while someone reviews flags, which takes days or weeks. Results are different: a US employer with 15 or more staff must keep hiring records, including tests, for one year ([29 CFR 1602.14](https://www.ecfr.gov/current/title-29/section-1602.14)). The firm may rely on us for that. Two smaller questions: whether the invite row stays (anonymised) after deletion so funnel counts still add up, and whether notes and votes go with the candidate.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. One clock, 180 days (as drafted) | Everything deleted at 180 days | Simple; as built | Media kept longer than needed; results deleted before the employer's one-year duty ends | None | Yes |
| B. One clock, 365 days | Everything deleted at one year | Covers the one-year record duty | Screenshots of candidates' screens kept a full year | Change a default | Yes |
| C. Two clocks: media 90, results 365 | Snapshots purged at 90 days; answers, scores and flags at 365 | Least sensitive data kept shortest; matches the record duty | Second setting and a second purge query | ~half day in the retention PR | Yes |
| Deletion: anonymise invite row | Keep status and dates, blank the email and name | Counts and funnel charts stay right | Must make sure nothing personal is left | Small | Yes |
| Deletion: remove notes and votes | Delete them with the candidate | Notes often name the person; deletion requests should be complete | Teams lose hiring discussion history | None | No (once deleted) |

**What others do:** Codility deletes all proctoring material after 30 days by default ([Codility](https://www.codility.com/1p/codility-advanced-video-proctoring-data-handling-reference/)). CoderPad caps webcam screenshots at 90 days, citing GDPR ([CoderPad](https://coderpad.io/resources/docs/screen/tests/cheating-prevention-detection/webcam-proctoring/)). Testlify deletes snapshots after 90 days ([Testlify](https://help.testlify.com/article/537-snapshot-deletion)). Honorlock keeps 365 days by default, adjustable ([Honorlock](https://honorlock.com/studentprivacy/)). HireVue's default deletion policy is two years, and it keeps anonymised data for reports ([HireVue](https://hvclassichelp.zendesk.com/hc/en-us/articles/43071665613204-Data-Retention-Setting-Deletion-Policies)). I could not find a published retention period for HackerRank or TestGorilla.

**Recommendation:** C, with the invite row anonymised and notes and votes deleted. It keeps the riskiest data the shortest and matches what proctoring vendors do, while results last as long as the employer must keep them. If the retention PR has to stay at one setting, choose B, and tell the company in the notice that results last a year. Change this if the lawyer (D3) says otherwise.

> **Status 2026-11-10:** PR #25 (merged) built option A: one setting, default 180 days (30 to 730), and a purge that **deletes** the invite row (no anonymised shell) plus notes and votes; the audit log keeps a no-PII record. Picking C needs a second retention value for snapshots; keeping an anonymised row reverses the PR's choice (its reasoning: a blank shell leaves empty rows in job lists).

**Your decision (2026-11-10):** **C.** Two clocks: snapshots and screenshots deleted at 90 days, results at 365 days. Photos are the most sensitive data we hold, and employers must keep hiring records for a year; competitors delete photos at 30 to 90 days. Keep PR #25's delete-the-row approach (no anonymised invite shell); notes and votes go with the candidate.

### D3. Candidate consent and monitoring wording; legal review

**Raised by:** PR #23, docs/02, docs/08 · **Blocks:** first real candidate · **Urgency:** before pilot

**Background (plain English):** Before the camera or screen share starts, candidates see a notice from `monitoringNotice()` in `src/lib/proctoring/config.ts` (version `2026-11-10`). It covers what we capture, why, who sees it, and how long we keep it, and promises we don't use photos to identify anyone. Two families of law apply. Biometric laws cover face *recognition* (scans of face geometry), not plain photos. We don't do recognition, but a future face check (D7) would bring us closer to that line. Automated-hiring laws apply when software scores or ranks candidates, which our auto-scoring already does and the AI scorer (D8) would do more of. **This is not legal advice.** The summary below is research for the lawyer meeting, not a substitute for it.

| Law | Applies to us when | Status (Nov 2026) |
|---|---|---|
| Illinois BIPA | We scan face geometry of someone in Illinois | In force; damages now counted per person, not per scan ([2024 amendment](https://www.jdsupra.com/legalnews/damages-limiting-amendment-to-bipa-2311064/)). Private lawsuits allowed |
| Texas CUBI | We capture a biometric identifier of a Texan | Consent first, destroy within a reasonable time; only the AG enforces, up to $25,000 per violation ([Texas AG](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/biometric-identifier-act)) |
| Washington RCW 19.375 | We "enroll" biometric identifiers in a database for a commercial purpose | Notice and consent; only the AG enforces ([RCW 19.375](https://lawfilesext.leg.wa.gov/Law/RCW/RCW%20%2019%20%20TITLE/RCW%20%2019%20.375%20%20CHAPTER/RCW%20%2019%20.375%20%20CHAPTER.htm)) |
| NYC Local Law 144 | A NYC employer uses a tool that substantially assists hiring decisions | Annual independent bias audit, published summary, advance notice to candidates; enforcement tightening after a Dec 2025 Comptroller audit ([summary](https://www.bryq.com/new-york-city-ai-bias-law/)) |
| Colorado | High-risk or automated decisions about Colorado residents | SB 24-205 was repealed and replaced by SB 26-189, a narrower disclosure-based law signed 14 May 2026, effective 1 Jan 2027 ([JD Supra](https://www.jdsupra.com/legalnews/colorado-ai-law-in-flux-comprehensive-2107294/)) |
| Illinois HB 3773 | AI used in employment decisions about Illinois residents | Notice duty under the Illinois Human Rights Act, in force since 1 Jan 2026 |
| EU AI Act | Candidates in the EU | Hiring tools are high-risk (Annex III). The Digital Omnibus moved those duties to 2 Dec 2027 ([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)). The ban on emotion recognition at work has applied since Feb 2025 |
| GDPR / UK GDPR | Candidates in the EU or UK | Needs a lawful basis and a notice. Biometric data used to identify people is special-category data. Art. 22 limits decisions based solely on automated processing ([Art. 22](https://gdpr-info.eu/art-22-gdpr/)) |
| Canada PIPEDA | Candidates in Canada | Meaningful consent, purpose limits, access rights |

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Ship current notice, no lawyer | Pilot as is | Fastest | Unreviewed promises in front of real people; hard to fix after the fact | None | Partly |
| B. One-off lawyer review, US-only pilot | Employment or privacy lawyer reviews the notice, the retention promise and the data processing terms; pilot candidates in NC only | Bounded cost; NC has no biometric statute; most laws above don't apply yet | Must block or warn on out-of-state and EU candidates or accept the risk | A few hours of legal time | Yes |
| C. Full multi-state and EU review | Review for every regime above | Ready to sell anywhere | Expensive and slow for one pilot | Days of legal time | Yes |

**What others do:** HackerRank labels flags and leaves the decision to the company (docs/02). CoderPad caps media at 90 days, citing GDPR. Vendors that face NYC LL 144 publish bias audits. Every vendor reviewed puts monitoring details in a notice before the test starts.

**Recommendation:** B. Keep the promise of no face identification and the "no one is rejected automatically" line, and keep the AI scorer (D8) out of decisions for now, so the automated-hiring laws barely touch the pilot. Ask the lawyer to confirm the notice text, the retention numbers from D2, and whether our auto-scoring counts as an automated tool under LL 144 or SB 26-189. Move to C before selling to a firm hiring in NYC, Illinois, Colorado or the EU.

> **Status 2026-11-10:** PR #25 changes the notice to "kept for N days after your assessment ends, then deleted" (from the org setting) and bumps `MONITORING_CONSENT_VERSION`. The lawyer should review that wording.

**Your decision (2026-11-10):** **No paid lawyer yet; NC-only pilot.** Free checks first: compare our notice with HackerRank's, Codility's and CoderPad's; check every promise in the notice matches what the app actually does; have the pilot firm's HR/legal review it; ask UNC law clinics and Launch Chapel Hill. Pay for a lawyer before any of: charging money, candidates outside NC, or turning on AI scoring.

### D4. Pause the timer while camera or screen share is down?

**Raised by:** PR #23 (docs/04 says the test pauses) · **Blocks:** fairness complaints · **Urgency:** before pilot

**Background (plain English):** When the camera or screen share stops (a browser glitch, a closed tab, a laptop going to sleep), the task area is covered until it is back. The server timer keeps running, so the candidate loses time they couldn't use. docs/04 promises the test pauses, so the docs and the product disagree today. A real pause means the server must track paused time and extend the deadline. It also needs a cap, otherwise "stop sharing" becomes a way to buy unlimited thinking time with the task hidden.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Keep running; fix docs | As built; docs/04 updated | No work | Candidates lose time for glitches; complaints land on the pilot firm | Docs edit | Yes |
| B. Keep running; recruiter can add time | Report shows downtime; recruiter grants extra minutes | Human judgment; matches HackerRank | Needs an "add time to a started attempt" action; only helps if the recruiter notices | ~1 day | Yes |
| C. Pause, capped | Server stops the clock while monitoring is down, up to 5 minutes in total; after that the clock runs and the gap is flagged | Fair by default; matches docs/04 | Time accounting on the server; edge cases (refresh during a pause) | ~1 to 2 days | Yes |

**What others do:** HackerRank does not pause the timer. Instead, recruiters can add time while a test runs or after it ends ([HackerRank](https://hackerrank-knowledge-base.help.usepylon.com/articles/4811403281)). Proctorio deployments generally keep counting, and Proctorio support cannot pause ([Ohio University](https://help.ohio.edu/TDClient/30/Portal/KB/Article/112/Troubleshooting-connecting-to-Proctorio)). Some programs allow a 5 or 10 minute pause ([ATI FAQ](https://iwcc.edu/wp-content/uploads/ATI-FAQ-PROCTRIO.pdf)). Honorlock guides tell students to relaunch and contact the instructor if time runs out ([FSW guide](https://fsw.teamdynamix.com/TDClient/2031/Portal/KB/ArticleDet?ID=165139)).

**Recommendation:** C with a 5-minute total cap, and show the paused time on the report. It keeps the docs/04 promise, and the cap stops anyone gaming it. If there is no time before the pilot, do A and show the downtime on the report, then add C or B after.

**Your decision (2026-11-10):** **Don't pause.** The timer always runs. Add a flag on the report when the camera (or screen share) goes off, with how long it was down. Update docs/04, which still says the test pauses.

### D5. Proctoring on by default for new assessments?

**Raised by:** PR #23 bug note · **Blocks:** nothing technical · **Urgency:** before pilot

**Background (plain English):** In `jobs/assessments/assessment-forms.tsx`, the new-assessment form ticks Camera and Screen share by default, so every new assessment is monitored unless the recruiter unticks both. Monitoring is a selling point, but it is also the most intrusive part of the product. Our pitch to accounting firms is about a talent shortage: firms want more candidates to finish, not fewer (docs/09). Defaults matter because most people never change them, and proctoring settings lock once the first candidate starts.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. On by default (today) | Both boxes ticked | Shows off the feature; most integrity | Monitoring by accident; more candidate drop-off; more consent surface | None | Yes |
| B. Off by default | Both unticked | Least intrusive | Firms that want proctoring may miss it | One-line change | Yes |
| C. Explicit choice | "Monitored" / "Not monitored" radio with no preselection, plus one line on what each means | Every proctored round is a deliberate choice; good record for D3 | One more click | ~1 hour | Yes |

**What others do:** HackerRank's image proctoring is off by default ([HackerRank](https://hackerrank-knowledge-base.help.usepylon.com/articles/5663779659)).

**Recommendation:** C. Monitoring then only happens when someone chose it, which also helps the consent story in D3. Switch to A if pilot recruiters keep forgetting to turn it on.

**Your decision (2026-11-10):** **C.** The recruiter must pick Monitored or Not monitored, with nothing preselected. Nobody gets watched by accident, and firms want more candidates to finish.

### D6. Require full screen? Rule thresholds?

**Raised by:** PR #23 · **Blocks:** nothing · **Urgency:** after first pilot data

**Background (plain English):** Full screen is offered but not required. The rules in `THRESHOLDS` (`src/lib/proctoring/rules.ts`) are first guesses: flag after 3 trips out of the window, one 30-second absence, or 60 seconds away in total; 5 pastes or 200 pasted characters; 2 full-screen exits; and "suspicious" from 3 flags. Browsers that don't report what is being shared are accepted as `unknown`. Without real attempts we can't tell whether these numbers flag too much or too little. Too many flags train recruiters to ignore them, which undermines the main pitch (docs/02: reviewing a flag takes seconds).

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Keep as built; tune after data | Optional full screen; current thresholds | No work; decide on evidence | First pilot may see odd flag rates | None | Yes |
| B. Require full screen | Block the workspace outside full screen | Fewer "left window" events | Breaks the built-in calculator and other workflows; accessibility tools often need other windows | ~half day | Yes |
| C. Refuse `unknown` share surface | Only accept browsers that report "monitor" | Stronger screen check | Blocks Safari and Firefox users | Small | Yes |

**What others do:** HackerRank rates integrity High or Medium and lets recruiters override (docs/02). Codility and HackerRank do not publish their thresholds.

**Recommendation:** A. Review flag rates after about 30 pilot attempts, ask the recruiter which flags were useful, then tune. Choose B or C only if the pilot firm asks for stricter rules.

**Your decision (2026-11-10):** **A.** Keep as built: full screen optional, thresholds unchanged. Tune the flag rules after about 30 real attempts. Forcing full screen breaks the calculator and screen readers.

### D7. Face check (no face / several faces)

**Raised by:** PR #23, docs/02 · **Blocks:** nothing · **Urgency:** later

**Background (plain English):** docs/02 plans an on-device check that counts faces in the camera snapshot: zero (candidate left) or two or more (someone helping). The browser's built-in `FaceDetector` works only in Chromium behind a flag, so this needs a library such as MediaPipe Face Detector, which runs in the browser ([MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector)). Counting faces is not recognising who someone is. Even so, Illinois BIPA lawsuits have targeted face geometry, so the legal position should be written down before we build it (D3).

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Not now | Recruiters look at snapshots themselves | No legal surface | Flags miss "nobody there" | None | Yes |
| B. On-device face count | MediaPipe in the browser; only the count is sent; no face data stored | Useful flag; nothing biometric leaves the device | Model download; false flags in bad light; needs legal sign-off | ~2 to 3 days | Yes |
| C. Server-side analysis (cloud vision) | Send snapshots to a vision API | Phone detection etc. (HackerRank-style) | Third-party processing of faces; bigger legal exposure | ~3 days + per-image cost | Yes |

**What others do:** HackerRank analyses webcam images with Amazon Rekognition and Google Gemini to spot extra people and phones (docs/02).

**Recommendation:** A for the pilot, then B after the lawyer confirms that face counting with no stored template falls outside BIPA. The case for building it gets stronger if recruiters in the pilot say snapshot review is too slow.

**Your decision (2026-11-10):** **A. Not for the pilot.** Face counting is too close to Illinois face-scan law (BIPA) without legal sign-off.

### D8. AI rubric scorer for written replies

**Raised by:** docs/08, E6, PR #22 · **Blocks:** auto-scoring `inbox_reply`; today every reply needs a human · **Urgency:** before scale, optional for pilot

**Background (plain English):** Written replies (Harbor Lane's email to Dana is worth 40 of 100 points) are scored against a rubric. Each criterion has guidance and per-candidate reference facts, held server-only in `src/lib/engine/step-types/inbox_reply/server.ts`. Today a person scores every reply. An AI model could suggest a score per criterion with a short reason, and the recruiter would confirm or override. It would run after submit, as decided in E6. The cost is pennies: a reply plus rubric is about 3,000 tokens in and about 1,000 to 3,000 out, thinking included. Scoring by AI raises the stakes under the automated-hiring laws in D3, so a person should stay in the loop.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Humans only (today) | Reviewer scores every reply | No AI-law exposure; simple | Doesn't scale; scores wait on reviewers | None | Yes |
| B. Shadow AI | AI scores silently; compare with human scores; not shown | Builds accuracy evidence with no risk | Cost with no user benefit yet | ~1 to 2 days; ~$0.03 per reply on Sonnet 5.5 | Yes |
| C. AI suggests, human confirms | Shows score and reason per criterion; the score stays provisional until a person confirms | Faster review; matches "AI labels, company decides" | Recruiters may rubber-stamp; LL 144 / SB 26-189 questions | ~2 to 3 days | Yes |
| D. AI final score | No human step | Fully automatic | Highest legal and trust risk | Same as C | Yes |

Model and price per million tokens (input / output), from [claude.com/pricing](https://claude.com/pricing). Batch processing halves these.

| Model | Model ID | Input | Output | Rough cost per reply |
|---|---|---|---|---|
| Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 | $0.50 | under $0.01 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2 | $10 | ~$0.02 to $0.04 |
| Claude Opus 5.5 | `claude-opus-5-5` | $4 | $20 | ~$0.04 to $0.07 |

**What others do:** HackerRank uses AI to label integrity and lets recruiters override (docs/02). Vervoe and TestGorilla offer AI scoring of open answers, with company review.

**Recommendation:** B during the pilot with Claude Sonnet 5.5, then C once AI and human scores agree on most criteria. Even at scale, Sonnet costs pennies per candidate. Keep D off the table. Revisit the model if Haiku 5.5 matches Sonnet's agreement rate in the shadow data. Keeping the automatic and reviewed scores apart (D11c) is what makes this comparison possible.

**Your decision (2026-11-10):** **B. Shadow mode** with Claude Sonnet 5.5: scores every reply silently, shown to no one. Proves accuracy against human scores before we trust it; costs pennies per reply.

### D9. Accommodations (no webcam, extra time, screen reader)

**Raised by:** docs/08, PR #23 · **Blocks:** candidates who need accommodations · **Urgency:** before pilot

**Background (plain English):** Some candidates need more time (for example dyslexia), have no webcam, or use a screen reader. US employers must make reasonable accommodations in hiring, and the test vendor is how they deliver them. Today the notice just says "contact the company", and nothing in the product can grant extra time or waive monitoring for one person. Proctoring settings lock per assessment once the first candidate starts (docs/02), so any per-person waiver must be an exception that is logged.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Off-product (today) | Candidate emails company; company clones an assessment with other settings | No work | Clunky; the clone breaks "same rules for the round"; contact details not shown | None | Yes |
| B. Per-invite accommodations by recruiter | On an invite: extra time (+25%, +50%, +100%) and "no camera / no screen share"; logged and shown on the report | Simple; recruiter decides; same model as HackerRank | Candidate still has to ask first | ~1 day | Yes |
| C. B + candidate request form | Candidate asks in product from the verify page; recruiter approves | Smoothest for candidates | More screens and emails | ~2 to 3 days | Yes |

**What others do:** HackerRank lets the test owner add time as a percentage per candidate ([HackerRank](https://hackerrank-knowledge-base.help.usepylon.com/articles/4811403281)). Codility has a screen-reader mode candidates can turn on, and a link to tell the person who invited them about other needs ([Codility](https://support.codility.com/hc/en-us/articles/360043319374-Best-Practices-for-Candidates-with-Disabilities)). Testlify documents a similar accommodation setup ([Testlify](https://help.testlify.com/article/736-assessment-accessibility-and-accommodations)).

**Recommendation:** B, and put the company's contact email in the notice and on the verify page. It is the common pattern and is small. Move to C if pilot candidates struggle to reach the company.

**Your decision (2026-11-10):** **B.** Per-invite extra time and camera/screen-share waiver, set by the recruiter and logged on the report. Show the firm's contact email to candidates (notice and verify page). Employers are legally required to accommodate.

### D10. Harbor Lane bank rec v1: accept the gaps or extend the step types?

**Raised by:** PR #22 · **Blocks:** publishing `harbor-lane-bank-rec` · **Urgency:** before pilot

**Background (plain English):** Harbor Lane is the 30-minute bank reconciliation from docs/07 Example 4. The current step types forced several differences, listed in `src/lib/engine/scenarios/harbor-lane-bank-rec.ts`: one grid instead of four tabs; no row insertion; fixed rows that hint at what to look for; all-or-nothing cells, so a candidate who misses the update scores 25 of 45 instead of docs/07's 30; the reply needs a human reviewer; no first-name greeting; AP accepted for the check error without an explanation; process signals come from events; and one date order differs. An accountant still has to review it.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Publish v1 as is (after accountant review) | Gaps documented | Fastest | Row hints make it easier; first-name gap looks unpolished | None | Yes (new version) |
| B. Fix the cheap gaps, accept the rest | First-name templating, the date order, maybe partial credit for the trap cell | Polished where candidates notice it | Small engine change | ~half to 1 day | Yes |
| C. Extend step types first | Tabs, row insertion, partial credit, memo reading | Matches docs/07 fully | Delays the pilot by a week or more | ~1 to 2 weeks | Yes |

**What others do:** Not applicable (our own scenario). HackerRank's guidance to clone rather than edit live questions is the same rule we follow: changes become a new version (Q6).

**Recommendation:** B, then publish once the accountant has reviewed it. Candidates see the first-name greeting and the dates, and the scoring differences are documented and fair to everyone in the round. Choose C only if the accountant says the row hints make it too easy.

**Your decision (2026-11-10):** **B.** Fix first-name greeting and the date order, then publish after the accountant reviews it. Switch to C only if the accountant says the row labels make it too easy.

### D11. Report data rules from PR #19

**Raised by:** PR #19 · **Blocks:** nothing now; affects D8 data · **Urgency:** before pilot

**Background (plain English):** Three choices in the candidate report. (a) Viewers can add notes and hire/no-hire votes even though they can't change scores. docs/03's permission matrix lists exactly this. (b) The report rebuilds the expected answers from the attempt's seed, using the server-only service client. Scenario versions are frozen (Q6), so the rebuild always gives the same answers. (c) When a reviewer scores a reply, the new score overwrites the provisional one in place. The audit log keeps a record, but the original automatic score is no longer a column we can query.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| (a) Keep viewer notes and votes | As built | Matches docs/03; managers' input next to scores | None found | None | Yes |
| (b1) Keep rebuilding from seed | As built | No duplicate data; key stays server-only | Service client on a report page | None | Yes |
| (b2) Store expected answers at scoring time | Save them with the score | No service client on reads | Copies answer keys into a table, more to protect | ~half day | Yes |
| (c1) Overwrite in place | As built | Simple | Can't measure auto vs human agreement (D8) without parsing the audit log | None | n/a |
| (c2) Keep auto score in its own column | `auto_score` stays; `score` is the final | Clean history; feeds D8 | Small migration | ~2 hours | Yes |

**What others do:** HackerRank lets recruiters override automated flags and keeps the original (docs/02).

**Recommendation:** Keep (a) and (b1). Choose (c2), because the AI scorer decision (D8) needs the original automatic score next to the human one, and adding a column is cheapest before real data exists.

**Your decision (2026-11-10):** **Keep (a) and (b1); do (c2):** a separate `auto_score` column next to the final `score`. We need both scores side by side to check the AI scorer in D8.

### D12. Invite schema: "last sent" date (S1) and duplicate batches (S2)

**Raised by:** `2026-11-09-stage-a-open-decisions.md` · **Blocks:** nothing, but harder once real invites exist · **Urgency:** before pilot

**Background (plain English):** Already researched in the stage A doc. S1: after a resend, the invite list still shows the first send date, because `invites` only has `created_at`. S2: two batches submitted at the same moment can both invite the same email, because the duplicate check runs in app code. Both need a migration, and migrations are easier before real invites exist.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Both now | Add `last_sent_at` (+ `sent_count`) and a partial unique index on `invites (job_id, lower(email))` for invited, started or completed rows | Accurate list; duplicates impossible | One migration to test | ~2 to 3 hours | Yes |
| B. S1 only | Add the date columns | Fixes what recruiters see | Race stays | ~1 hour | Yes |
| C. Neither | As built | No work | Confusing dates; rare duplicate invites, harder to fix once real rows exist | None | n/a |

**What others do:** see the stage A doc; a unique index is the standard database fix for this kind of race.

**Recommendation:** A, in one migration. The index has to be added before there are any real duplicate rows. Choose C only if no migration slot is left before the pilot.

**Your decision (2026-11-10):** **A.** `last_sent_at` (+ `sent_count`) and the partial unique index on `invites (job_id, lower(email))` in one migration, before real invites exist.

### D13. Company sign-up and team rules (Q2, Q3, Q4, Q5, Q7)

**Raised by:** `2026-11-08-skeleton-open-questions.md` · **Blocks:** pilot company sign-up and team page · **Urgency:** before pilot

**Background (plain English):** Five earlier questions, researched in the skeleton doc. Here is what main (`ce46f61`) has today, checked in `supabase/migrations`, `supabase/config.toml` and `src`:

| Q | Question | Built on main? | Evidence |
|---|---|---|---|
| Q2 | Confirm email on sign-up | **No.** `enable_confirmations = false` locally; no code-entry screen. The hosted project's dashboard setting was not checked | `supabase/config.toml` |
| Q3 | Invite links behind an "Accept" button | **Half.** Candidate links are safe: `/a/[token]` uses a Continue button (POST). Teammate invites still use the client page `src/app/auth/callback/page.tsx` (`#access_token`), and `src/app/auth/confirm/route.ts` verifies on page load (GET) | `src/app/a/[token]/page.tsx`, `src/app/auth/` |
| Q4 | Last-admin database trigger | **No.** App check only in `team/actions.ts`; a pgTAP test notes the rule is provisional | `src/app/app/[orgSlug]/team/actions.ts`, `supabase/tests/policies_organizations.test.sql` |
| Q5 | `profiles` table | **No.** No table in migrations | `supabase/migrations/` |
| Q7 | Expected answers company-side only | **Yes, option A.** The report shows "Expected" and the done page shows no score | `candidates/[inviteId]/page.tsx`, `a/[token]/done/page.tsx` |

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. One small "auth hardening" PR | Q3 (button page for teammate invites and sign-up confirm; delete the callback page), Q4 trigger, Q5 `profiles` + trigger; turn on Q2 as a 6-digit code once Resend is live | All the skeleton doc's recommendations; one review | Two migrations to test; a broken profiles trigger can block sign-ups | ~1.5 to 2 days | Yes |
| B. Only Q2 and Q3 | Fix what blocks a firm on Microsoft 365 from signing up | Smallest | Last-admin race and service-key lookups stay | ~1 day | Yes |
| C. Leave as is | We set up pilot companies by hand | No work | Microsoft Safe Links can use up teammate invites before the person clicks | None | n/a |

**What others do:** see the skeleton doc. Supabase recommends a code or a button page against link scanners ([docs](https://supabase.com/docs/guides/auth/auth-email-templates)) and a `profiles` table synced by trigger ([docs](https://supabase.com/docs/guides/auth/managing-user-data)).

**Recommendation:** A. Q3 matters most, because accounting firms run Microsoft 365, and Q4 and Q5 are migrations that are cheapest before real companies exist. Q7 needs only a "decided" note. Choose B if the pilot is days away.

**Your decision (2026-11-10):** **A** (B if the pilot is days away). Q3 is the must-have: Microsoft link scanners use up teammate invites, and our targets run Microsoft 365. Q4 and Q5 in the same PR. Q2 as a 6-digit code once Resend is live. Q7 confirmed as built.

### D14. Pilot pricing and terms

**Raised by:** docs/08, docs/09 · **Blocks:** first pitch meeting · **Urgency:** before pilot outreach

**Background (plain English):** The first pilot is mainly about evidence: does the simulation tell a firm something its interviews don't? The tier 1 targets are small (Impact has 13 people; TJT and HPG run a few hiring rounds a year), and docs/09 notes small agencies are cost-conscious. Pricing can be per completed candidate (cost tracks use), per seat (predictable, but it punishes inviting hiring managers, which docs/03 says we want), or per job or round. Writing down terms now (length, data, reference rights) avoids an awkward conversation later.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Free pilot, then per completed candidate | One hiring round free (cap, e.g. 50 completed); then a price per completion; viewer seats free | Easy yes; price tracks value; fits low-volume firms | Revenue swings with hiring seasons | Contract template | Yes |
| B. Free pilot, then per seat per month | Subscription per recruiter | Predictable revenue | Small firms hire in bursts; discourages seats | Same | Yes |
| C. Free pilot, then per job / round | Flat fee per hiring round | Simple for campus rounds | Hard to price across very different round sizes | Same | Yes |
| D. Paid pilot (discounted) | Charge from day one | Tests willingness to pay sooner | Slower yes; we have no references yet | Same | Yes |

**What others do:** TestGorilla sells annual plans with a free tier (G2 lists roughly $0 to $4,800 a year; [G2](https://www.g2.com/products/testgorilla/pricing)). Vervoe doesn't publish prices ([Compono guide](https://www.compono.com/articles/vervoe-pricing-buyers-guide-2026)). Most competitors are subscriptions. I found no published per-candidate rates.

**Recommendation:** A. Pilot terms: one round free, a cap on completions, feedback calls, permission to use the firm as a reference, and data handled per D2 and D3. Per-completion pricing fits firms that hire in bursts, and free viewer seats get hiring managers in. Set the post-pilot price after asking "what did your last bad hire cost?" in the pitch meeting. Change to C if campus-round firms (TJT, BRC) say they think in rounds.

**Your decision (2026-11-10):** **Holding off.** First round free; ask pilot firms what they would pay. No pricing code needed yet. Context: competitors charge roughly $10 to $25 per candidate. HackerRank $100/month for 120 candidates a year, then $20 each; Codility $1,200/year for 120; TestGorilla yearly plans from $2,580, one credit per candidate; TestDome pay-per-candidate packs with no contract (100 for $1,000). Most require yearly contracts; packs fit firms like ours that hire in bursts.

### D15. Simulation length

**Raised by:** docs/08 · **Blocks:** nothing · **Urgency:** pilot

**Background (plain English):** The target is 30 to 45 minutes, and Harbor Lane is 30. Longer tests can measure more, but candidates may quit, and in a talent shortage the strong candidates have options. The evidence is mixed, and mostly from vendors. Some find length barely predicts completion and that most drop-off happens in the first 5 to 10 minutes. Others see drop-off rise past about 40 minutes. The pilot will give us our own numbers.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. 30 minutes (Harbor Lane) | As built | Inside every "safe" range found | Less room for more tasks | None | Yes |
| B. 40 to 45 minutes (Example 1) | Longer close simulation | More signal per candidate | Needs `document_review` work; more drop-off risk | Scenario work | Yes |
| C. Two-stage | 15-minute screen, then 30-minute simulation for those who pass | Low barrier at the top | Two invites; more build | ~days | Yes |

**What others do:** Criteria reports about 80% completion up to 40 minutes and more drop-off beyond ([Criteria](https://criteriacorp.com/blog/how-much-testing-is-ok)). Modern Hire's 30-million-assessment study found length a weak predictor, with most dropout in the first 5 to 10 minutes ([HR Tech Feed](https://hrtechfeed.com/?p=170069)). CodeSignal suggests about 60 minutes for top-of-funnel tests ([CodeSignal](https://codesignal.com/blog/design-assessments-for-candidate-experience/)).

**Recommendation:** A. Measure invite-to-start, start-to-finish, time used and where people stop, from the attempt events we already record. Go longer only if completion stays above about 80% and the firm wants more signal.

**Your decision (2026-11-10):** **A.** Keep 30 minutes and measure completion in the pilot. Drop-off rises past about 40 minutes.

### D16. Second vertical: pharma scope

**Raised by:** docs/08 · **Blocks:** nothing · **Urgency:** later

**Background (plain English):** The second market is pharma. The open question is which candidates: pharmacy students (dispensing, dosing, interactions, counselling) or industry roles (quality assurance, regulatory, batch records, SOPs). Pharmacist hiring leans on licensure, which already tests clinical knowledge. Industry roles are document-heavy (review a batch record, spot the deviation), which fits the `document_review` step type we are building for accounting. Either path needs a pharmacist or QA reviewer, the way accounting needs an accountant.

| Option | What it means | Pros | Cons | Effort / cost | Reversible? |
|---|---|---|---|---|---|
| A. Pharmacy students | Dispensing and counselling scenarios | Large, defined pool; schools as partners | Licensure already screens; clinical scenarios need careful review | Reviewer + scenarios | Yes |
| B. Industry roles (QA, regulatory, batch records) | Document review simulations | Reuses `document_review`; employers pay for compliance skills | Smaller, more specialised pool | Reviewer + scenarios | Yes |
| C. Decide later | Ask pilot contacts and reviewers first | No wasted work | None now | None | Yes |

**What others do:** not researched further; this is a later decision.

**Recommendation:** C now, leaning B. It reuses the engine work, and compliance-heavy employers already pay for proof of skill. Confirm by asking two or three pharma contacts the same "last three hires" question from docs/09.

**Your decision (2026-11-10):** **C. Deferred**; accounting only for now.

## Batch 3 judgment calls

Already built; revisit only if you disagree.

- **PR #24 (merged):** on Vercel (production and preview) email refuses the local outbox and errors clearly if `RESEND_API_KEY` or a real `EMAIL_FROM` is missing; `example.com` senders are refused. Rejected: keying off `NODE_ENV` (e2e runs `next start` in production mode).
- **PR #24:** `/api/health` is public and returns booleans only (`ok`, `db`, `storage`, `email`); 503 when not ok.
- **PR #24:** candidate code resend cooldown is enforced in the database update, so double clicks can't send two codes. No new rate limits elsewhere.
- **PR #24:** error pages show a reference id, never the message or stack.
- **PR #25 (merged):** retention clock starts at the candidate's last activity (latest of invite, expiry, attempt deadline, submission).
- **PR #25:** only org admins may delete a candidate; recruiters and viewers can't. Typed "delete" confirmation.
- **PR #25:** the daily purge runs at 03:30 UTC, refuses without `CRON_SECRET`, and continues past single failures.
- **PR #25:** changing the notice bumps the consent version, so candidates mid-assessment are asked to agree again.
- **PR #27 (merged):** admins only must use TOTP (recruiters and viewers optional); enrol at `/app/account/security`, code at `/app/account/verify`; TOTP enabled in local `supabase/config.toml` (on by default in hosted Supabase). Also fixed: another company's candidate report now returns a real 404.

## Provisional calls to confirm (already built, not blocking)

From `2026-11-09-stage-a-open-decisions.md`, built as described. **All confirmed as built (2026-11-10).**
- J1 invite expiry at job deadline (end of day, recruiter time zone), else 14 days
- J2 a batch with any bad email is rejected whole
- J3 re-invite skipped if invited, started or completed; allowed after revoke or expiry
- J4 resend or revoke only invited or expired invites
- J5 revoked token kept so the link says "revoked"
- J6 emails sent one at a time, one retry after 1.1 s
- J7 CSV reads an "email" column, else the first cell with "@"
- J8 edit assessments while unlocked, clone once locked
- C1 timer starts on "Start", not on code verification
- C2 must start before the earlier of invite expiry and job deadline; then gets the full time
- C3 a timeout submit is stamped at the deadline
- C4 one active device; verifying again logs out the older one
- C5 consent stored as an action event with the text version
- E1 rubric hidden from candidates
- E2 blank reply scores 0, not sent to review
- E3 spreadsheet cells are numbers only
- E4 input cells with no key are unscored scratch cells
- E5 reviewer reference facts only in the server-only key
- E6 AI scorer runs after submit, separately
- E7 `/dev/engine` shows the latest version of each scenario

## Action items (people, not decisions)

- [ ] Resend: account, verified sending subdomain, SMTP in Supabase Auth, `RESEND_API_KEY` and `EMAIL_FROM` in Vercel. **Since PR #24, production invites and candidate codes fail with a clear error until this is done.** Then check `https://<app>/api/health` returns all true
- [ ] Supabase: upgrade to Pro (Free pauses after 7 idle days); Authentication → URL Configuration (Site URL, redirect URLs); confirm TOTP MFA is enabled
- [ ] Vercel: add `CRON_SECRET` (`openssl rand -hex 32`) when PR #25 merges, or the daily purge refuses every call; also add it to `.env.example`; check every env var in `01-architecture-and-hosting.md`, plus `EMAIL_FROM`, which the code reads but that table doesn't list
- [ ] Accountant reviews `harbor-lane-bank-rec`; then `pnpm scenarios:publish`
- [ ] D3 free checks: compare our notice with HackerRank's, Codility's and CoderPad's; check each promise in the notice against what the app does; pilot firm's HR/legal reviews it; ask UNC law clinics and Launch Chapel Hill
- [ ] Paid lawyer review before charging money, candidates outside NC, or turning on AI scoring (D3)
- [ ] Pick and contact the first pilot company (`09-go-to-market.md`); ask what they would pay (D14)
- [x] Apply `20261110200000_retention.sql` (PR #25) to the cloud (applied 2026-11-10)
- [ ] Later: find a pharmacist reviewer
