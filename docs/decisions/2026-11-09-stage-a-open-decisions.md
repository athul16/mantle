# Stage A open decisions (2026-11-09)

Decisions made provisionally while building stage A: PR #8 (step types), PR #9 (jobs and invites), PR #10 (candidate flow). Every one is already built the way described under "As built". Nothing here blocks stage B. Confirm each one or change it.

## Read this first

| # | Area | Question | As built | Needs |
|---|---|---|---|---|
| S1 | Invites | Show a "last sent" date after a resend? | Shows the first invite date only | Schema change |
| S2 | Invites | Prevent duplicate invites from two batches sent at the same moment? | App-level check only | Schema change |
| J1 | Invites | When does an invite expire? | At the job deadline (end of that day, recruiter's time zone); 14 days if no deadline | Confirm |
| J2 | Invites | A batch has some bad emails | Whole batch rejected, nothing sent | Confirm |
| J3 | Invites | Re-inviting the same email to a job | Skipped if invited, started or completed; allowed again after revoke or expiry | Confirm |
| J4 | Invites | Which invites can be resent or revoked? | Only invited or expired, not started or completed | Confirm |
| J5 | Invites | What happens to the token on revoke? | Kept, so the link can say "this invite was revoked" | Confirm |
| J6 | Invites | Email sending speed | One at a time, one retry after 1.1 s (Resend free tier ~2/s) | Confirm |
| J7 | Invites | CSV format | Uses an "email" column (and "name") if there's a header, else the first cell with "@" | Confirm |
| J8 | Assessments | Editing locked assessments | Edit while unlocked; clone once locked | Confirm |
| C1 | Candidate | When does the timer start? | On "Start" on the instructions page, not at code verification | Confirm |
| C2 | Candidate | Start deadline vs. time limit | Must start before the earlier of invite expiry and job deadline; once started, gets the full time limit | Confirm |
| C3 | Candidate | Timestamp on a timeout submit | The deadline, not when the server noticed | Confirm |
| C4 | Candidate | Same candidate on two devices | One active session; verifying again logs out the older one | Confirm |
| C5 | Candidate | Where consent is recorded | A `verified` action event with the consent text version | Confirm (a column would be a schema change) |
| E1 | Engine | Show the rubric to the candidate? | Hidden | Confirm |
| E2 | Engine | Blank email reply | Final 0, not sent for review | Confirm |
| E3 | Engine | Spreadsheet text cells | Numbers only; text cells deferred | Confirm |
| E4 | Engine | Input cells with no key | Unscored scratch cells | Confirm |
| E5 | Engine | Where reviewer reference facts live | In the server-only key, never in values the candidate page could show | Confirm |
| E6 | Engine | When the future AI rubric scorer runs | After submit, separately; `scoreAttempt` stays synchronous | Confirm |
| E7 | Engine | `/dev/engine` scenario version | Latest version of each slug | Confirm |

**Decide first:** S1 and S2. They are the only ones that need a migration, and both get harder once real invites exist.

## Schema decisions (not built)

### S1. "Sent date" after a resend
`invites` only has `created_at`, so after a resend the invite list still shows the first send date. Option: add `last_sent_at` (and maybe `sent_count`) to `invites`, set on every send and resend. Rejected for now only because it's a migration.

### S2. Duplicate invites from simultaneous batches
The app skips an email that already has an open invite for the job, but two batches submitted at the same moment can both get past that check. Option: a partial unique index on `invites (job_id, lower(email))` where status is invited, started or completed. Revoked and expired rows stay outside the index, so re-inviting keeps working.

## Jobs and invites (PR #9)

- **J1. Invite expiry.** As built: the job deadline is the invite expiry, read as the end of that day in the recruiter's time zone. Jobs with no deadline (not possible from the current form) fall back to 14 days. Rejected: a separate expiry per invite.
- **J2. Batches with bad entries.** As built: any invalid entry rejects the whole batch. The bad entries are listed and the pasted text is kept. Rejected: sending the valid ones and skipping the rest, because it's easy to miss that someone wasn't invited.
- **J3. Re-inviting.** As built: an email with an invited, started or completed invite for the job is skipped. A revoked or expired email gets a new row. Rejected: a database unique constraint (see S2).
- **J4. Resend and revoke.** As built: only for invited or expired invites. Resend clears any pending email code and moves expiry out to the job deadline. Rejected: revoking a started attempt, which belongs with the candidate flow and the results table.
- **J5. Revoke keeps the token hash.** As built: the secret row stays, so the candidate's link shows "this invite was revoked" instead of "invalid link". The candidate flow checks `invites.status`, and that is verified. Rejected: deleting the secret row.
- **J6. Sending speed.** As built: emails go out one at a time with one retry after 1.1 s. A 200-invite batch takes roughly 1–2 minutes on Resend's free tier. Rejected: parallel sends, which hit the free tier's rate limit. Revisit with Resend Pro, or move sending to a background job.
- **J7. CSV format.** As built: uses the "email" column (and "name" into `candidate_name`) if there's a header row, otherwise the first cell containing "@" in each row.
- **J8. Assessment edit and clone.** As built: assessments can be edited until locked, and cloned after. Rejected: create-only, which made the lock state pointless.

## Candidate flow (PR #10)

- **C1. Timer start.** As built: the clock starts when the candidate clicks "Start" on the instructions page. Verification and the system check don't use up their time.
- **C2. Start deadline.** As built: candidates must start before the earlier of invite expiry and job deadline. Once started, they get the full time limit even if that runs past the deadline.
- **C3. Timeout timestamp.** As built: a timed-out attempt's `submitted_at` is its deadline, not the time of the request that noticed it. This keeps "time taken" honest.
- **C4. One active session.** As built: verifying again (for example on a second device) retires the older session cookie.
- **C5. Consent.** As built: stored as a `verified` action event with the consent text version, with no schema change. Alternative: dedicated consent columns on `attempts` (migration), which may be wanted once the legal consent text exists (stage E).

## Engine (PR #8)

- **E1. Rubric hidden from the candidate.** As built: no criteria labels in the public config. Rejected: showing them, because they give away what's being graded.
- **E2. Blank reply.** As built: a blank or missing reply scores a final 0 with `needsReview: false`. Rejected: flagging it for review, since there's nothing to review.
- **E3. Spreadsheet cells are numeric only.** Text cells are deferred until a task needs them.
- **E4. Unkeyed input cells.** As built: unscored scratch cells. A key that names a missing cell throws, because that's a scenario bug.
- **E5. Reviewer facts.** As built: per-criterion reference facts live in the `inbox_reply` key (server-only), not in template values, so derived numbers can't reach the candidate page by mistake.
- **E6. AI rubric scorer.** As built: the `RubricScorer` interface is async and meant to run after submit. `scoreAttempt` stays synchronous. No AI model is called yet.
- **E7. `/dev/engine` version.** As built: it picks a scenario by slug and uses its latest version.

## Also left over

- `docs/06-assessment-engine.md` "As built" doesn't mention `inbox_reply`, `spreadsheet` or `demo-mini-close` yet.
- `demo-mini-close` v1 isn't published to the cloud database yet. Run `pnpm scenarios:publish` when it should show up for companies.
