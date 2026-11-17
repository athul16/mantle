# Litigation paralegal: Morrow v. Tidewater Freight

Status: **draft: team self-review pending.** Version 1. Published to the cloud library as v1 on 2026-11-17 for the team's own testing; fixes from the review ship as v2.

| | |
| --- | --- |
| Slug | `litigation-morrow-tidewater` v1 |
| Role family | `legal` |
| Time | 52 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/litigation-morrow-tidewater.ts` |
| Shared helpers | `src/lib/engine/scenarios/legal/` (deadlines, citation guide, name pools) |
| Tests | `tests/engine/litigation-morrow-tidewater.test.ts`, `tests/engine/legal-helpers.test.ts` |

## Setup

The candidate is a litigation paralegal at a plaintiff's firm (seeded from a pool of fictional firms), working for a partner on *Morrow Provisions, LLC v. Tidewater Freight Lines, Inc.*, a cargo-damage case: a refrigerated load of produce arrived spoiled. The court is the fictional U.S. District Court for the District of Wexford; appeals go to the fictional Fourteenth Circuit; the state's highest court is the Supreme Court of Wexford. Its reporters (N.F.R., N.F. Supp., Wex.) are fictional too, so no citation can point at a real case.

Everything people-, name- and number-shaped is seeded per attempt: firm and opposing firm, every person, the city, trailer and claim numbers, Bates numbers, citations, page numbers, holdings, dates, the filing limits, the settlement offer, which document or authority carries which trap, and where the right option sits. Timing rules are the real Federal Rules of Civil Procedure (public domain) and the real federal holiday calendar. Local rules (D. Wex. L.R. 5.2 and 7.1) are invented for the scenario.

## Sections and timing

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: deadlines | 6 | `rapid-deadlines` (15 × 20 s) | 10 |
| 2 | Privilege review | 11 | `privilege-review` (`document_review`, 15 documents) | 20 |
| 3 | Rapid round: citation format | 6 | `rapid-citations` (15 × 20 s) | 10 |
| 4 | Cite-check | 11 | `cite-check` (`document_review`, 9 authorities) | 20 |
| 5 | Rapid round: procedure | 6 | `rapid-procedure` (15 × 20 s) | 10 |
| 6 | Trial prep and inbox (one screen at a time) | 12 | `exhibit-list` 360 s, `inbox-filing` 150 s, `inbox-opposing` 105 s, `inbox-client` 105 s | 15 + 7 + 4 + 4 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds and worth 1 point; the other ten are worth ½. Messages from the partner, the opposing paralegal and the client arrive when their section opens.

## Rapid round A: deadlines

Each item is a docket entry: the event, its date, the rule and period, the service method and the federal holidays from the event to 13 days past the period. The candidate picks the deadline from four dates (each shown with its weekday).

Rule applied (shared helper `computeDeadline`): FRCP 6(a)(1): exclude the event day, count every day including intermediate weekends and holidays, and if the last day is a Saturday, Sunday or legal holiday, run to the next court day. FRCP 6(d): service by U.S. mail adds 3 days after the 6(a) period ends, then rolls again. E-service and hand delivery add nothing; periods running from entry of judgment, a 26(f) conference or a waiver request get no mail days.

Periods used: answer 21 (12(a)(1)(A)(i)), counterclaim answer 21 (12(a)(1)(B)), amendment as of course 21 (15(a)(1)(B)), interrogatories / RFPs / RFAs 30 (33(b)(2), 34(b)(2)(A), 36(a)(3)), opposition 14 (L.R. 7.1(b)), reply 7 (L.R. 7.1(c)), objections to a report and recommendation 14 (72(b)(2)), new-trial motion 28 (59(b)), notice of appeal 30 (FRAP 4(a)(1)(A)), initial disclosures 14 after the 26(f) conference (26(a)(1)(C)), answer after waiver 60 (12(a)(1)(A)(ii)).

| Kind | Tier | Per round | Trap |
| --- | --- | --- | --- |
| Plain | ½ | 6 | Ends on a court day; holidays inside the period still count |
| Weekend | ½ | 4 | Ends on a Saturday or Sunday: roll forward to Monday, not back to Friday |
| Holiday | 1 | 3 | Ends on an observed federal holiday, or on a weekend before a Monday holiday (e.g. Fri, Jul 3, 2026; Fri, Dec 31, 2027) |
| Mail | 1 | 2 | Add 3 days after the rolled 6(a) date, then roll again |

Wrong options, most tempting first: the unrolled date, rolling backward, counting the event day, forgetting (or wrongly adding) the 3 mail days, counting court days only, a neighbouring court day.

## Section 2: privilege review (20)

A 15-document production index (Bates, date, type, from, to/CC, subject, proposed treatment) for Morrow's volume due today. Header fields give our firm's and the client's email domains and the Bates rule.

| Finding | Points | Expected flag | Rule |
| --- | --- | --- | --- |
| Attorney-client email set to Produce | 4 | That row, "Privileged: withhold it and log it" | Client asking our firm for legal advice, nobody else on it |
| Work-product memo set to Produce | 4 | That row, "Privileged" | Associate's analysis of a defense, prepared for this case (FRCP 26(b)(3)) |
| Withheld email copied to an outsider | 4 | That row, "Privilege likely waived" | Partner's advice email CCs the refrigeration vendor's rep; confidentiality is gone, so withholding it as attorney-client is wrong. The partner makes the call. |
| Bates gap | 3 | The row after the gap (or the one before), "Bates gap" | 2–6 numbers skipped |
| Bates repeat | 3 | The row that reuses numbers (or the one before), "Bates repeat" | 1–2 pages stamped twice |
| Decision | 2 | "Hold the volume: send the flagged documents to the partner…" | A paralegal flags privilege calls; doesn't make them, and doesn't serve a known-bad volume |

Look-alikes that are right: a correctly withheld attorney-client email, correctly withheld work-product notes, and an email from the client to Tidewater that mentions "our attorney" (produced; not privileged). Bates problems only sit between ordinary produced records. False flag: −1 each, floored at 0.

## Rapid round B: citation format (10)

Each item shows the research-file record (name, court, year, volume, reporter, page range, the page the point is on), the citation as written, and a one-line version of the firm's guide. The candidate picks the wrong part, or "Correct as written".

The guide (ours, not any published manual; `CITATION_GUIDE` in `legal/citations.ts`): `Name v. Name, volume Reporter first-page, pin (court-abbreviation year)`; "v." with a period; always a pin cite; 14th Cir. and D. Wex. in the parenthetical; Supreme Court of Wexford cases (reporters Wex., Wex. 2d) get the year alone.

| Kind | Tier | Count | Right answer |
| --- | --- | --- | --- |
| Correct (14th Cir. or D. Wex.) | ½ | 3 | Correct as written |
| "vs." or "v" | ½ | 2 | Case name |
| Wrong volume or reporter series | ½ | 2 | Volume or reporter |
| Wrong year | ½ | 2 | Court or year |
| Wrong first page | ½ | 1 | First page or pin cite |
| Wrong pin (transposed digits or nearby page) | 1 | 2 | First page or pin cite |
| Court named for a Wexford Supreme Court case | 1 | 1 | Court or year |
| Correct Wexford Supreme Court cite (year only) | 1 | 1 | Correct as written |
| Wrong court abbreviation (14th Cir. ↔ D. Wex.) | 1 | 1 | Court or year |

## Section 4: cite-check (20)

The table of authorities of the opposition brief (citation, parenthetical, brief pages), drafted partly with an AI tool. The partner's email holds the verified research file: every real case cited plus two not cited, each with its citation, page range, the holding and the page it's on, and its status.

| Finding | Points | Expected flag | Rule |
| --- | --- | --- | --- |
| Case not in the research file | 5 | "Not in the research file: can't be verified" | The "AI hallucination" trap: nobody has read it, so it can't be cited |
| Overruled case | 4 | "No longer good law" | File status: overruled by a later case of the same court |
| Misquoted parenthetical | 3 | "Parenthetical doesn't match the holding" | The brief's "holding that…" changes the meaning (e.g. "may" vs "never", "intent" vs "negligence") |
| Wrong pin cite | 3 | "Wrong pin cite" | Pin differs from the page the holding is on |
| Wrong year | 3 | "Wrong year" | Year differs from the file |
| Decision | 2 | "Hold the filing: send the partner the list of problems…" | A missing or overruled authority needs an attorney to decide what replaces it |

Four authorities are right. Half points for the right row with another reason; −1 per false flag.

## Rapid round C: procedure (10)

Thirteen quick-question kinds (½ each, ten drawn), six harder kinds (1 each, three drawn) and two number items in fixed slots 6 and 12 (1 each). Each choice question has four options in a seeded order.

Easy: work-product memo; what starts a case (FRCP 3); e-service adds no days (6(d)); serve represented parties through counsel (5(b)(1)); discovery responses aren't filed (5(d)(1)(A)); clawback (26(b)(5)(B)); subpoena duces tecum; Bates number; nonparty documents by FRCP 45 subpoena; certificate of service; summary judgment is dispositive; litigation hold; Rule 11 signature by an attorney of record.

Hard: forwarding advice to an outsider can waive privilege; reasonable written notice for a deposition (30(b)(1)); unanswered RFAs are deemed admitted (36(a)(3)); e-filing on the last day runs to midnight court time (6(a)(4)(A)); draft expert reports are protected (26(b)(4)(B)); any non-party adult may serve a summons (4(c)(2)).

Numbers: interrogatories left under the 25 limit (33(a)(1)), given 16–23 served; depositions left under the 10-per-side limit (30(a)(2)(A)(i)), given 2–9 taken.

## Section 6: trial prep and inbox (30)

### Exhibit list vs. binder (15)

Twelve exhibits (PX-1 to PX-12): eight documents (one listed twice) and three deposition transcripts. Columns: description, date and Bates on the list, and what's in the binder tab. The header gives the Bates ranges produced by each side.

| Finding | Points | Expected flag | Rule |
| --- | --- | --- | --- |
| Empty tab | 3 | "Not in the binder" | Find the document or drop it from the list |
| Same document twice | 4 | The later exhibit (either counts), "Same document listed twice" | Same Bates and date, different wording |
| Never produced | 4 | "Never produced in discovery" | Bates outside both productions; may be excluded at trial (FRCP 37(c)(1)) |
| Wrong deposition date | 4 | "Date doesn't match the document" | Transcript cover date differs from the list by 1–9 days |

### Inbox (15)

| Step | Points | Right answer |
| --- | --- | --- |
| `inbox-filing` (multi-select) | 7 | Under L.R. 5.2: text recognition so files are searchable; each exhibit as its own labelled attachment; split the brief only when it's over the seeded size limit; email the proposed order in Word only when there is one. Wrong: one combined PDF, emailing the clerk, waiting until midnight when the partner said 5 pm. Scored right/(right options) − wrong/(wrong options), floored at 0. |
| `inbox-opposing` | 4 | Send nothing; reply politely that requests go through counsel and forward the email to the partner |
| `inbox-client` | 4 | Say you can't give legal advice, have the partner call today, and pass the offer on right away |

## Scoring table

| Step | Points |
| --- | --- |
| Rapid round A: deadlines | 10 |
| Privilege review | 20 |
| Rapid round B: citation format | 10 |
| Cite-check | 20 |
| Rapid round C: procedure | 10 |
| Exhibit list | 15 |
| Filing by 5 pm | 7 |
| Opposing counsel's paralegal | 4 |
| Client asks for advice | 4 |
| **Total** | **100** |

Tests (200 seeds): every task is solved from the rendered material with the tests' own reading of the rules and compared with the server key; a perfect attempt scores 100, a blank 0; each planted trap costs exactly its points (half for the right item with the wrong reason); each rapid item has exactly one right option; another seed's perfect answer averages under 40.

## Judgment calls for review

1. **Reply period 7 days, not 14.** The brief listed "reply 14"; replies to an opposition are usually shorter, so the fictional L.R. 7.1(c) gives 7. Opposition is 14 under L.R. 7.1(b).
2. **Only federal holidays.** FRCP 6(a)(6) also counts state holidays; the scenario says Wexford adds none. Observed dates follow 5 U.S.C. 6103(b) (Saturday → Friday, Sunday → Monday), including New Year's Day 2028 observed Fri, Dec 31, 2027.
3. **Mail days after the roll.** FRCP 6(d) is applied as "compute the 6(a) date, add 3, roll again" (the reading since the 2016 amendments).
4. **Holidays are listed on every deadline item.** A docketing calendar shows them, and 20 seconds isn't enough to recall every observed date. It still tests the rule (holidays inside the period count; roll forward, not back).
5. **Waived privilege is a flag, not a decision.** The expected reason is "privilege likely waived" on a withheld email that CCs an outsider; the decision option says the partner makes privilege calls.
6. **Fictional reporters and courts** (N.F.R., N.F. Supp., Wex.) instead of real ones, so a seeded citation can never match a real case.
7. **Inbox steps are multiple choice, not written replies,** so the whole simulation scores automatically. A written reply to the opposing paralegal could be added later as an `inbox_reply` step.
8. **The fabricated case looks real** (plausible name, court and holding); the only tell is its absence from the research file, which is the point of the trap.
9. Message senders are role lines ("Your supervising partner") because message `from` fields aren't template-filled; the bodies sign with the seeded names.
10. **Number answers are single digits.** The shared leak tests also read key numbers as cents, so a two-digit answer like 12 ("1200") could collide with a page or Bates number. The deposition question asks for depositions left (10 per side) rather than minutes left in a 7-hour day.
11. Some production-index dates fall on weekends (people email on weekends); not a trap.
