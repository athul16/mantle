# Paralegal self-review pack, November 2026

Six paralegal simulations are built, merged and waiting for the team's own sign-off before any company can use them. There is no outside reviewer for this pass; the team reviews.

1. **Litigation: Morrow v. Tidewater Freight** (`litigation-morrow-tidewater`, 52 minutes)
2. **eDiscovery: Project Larch review batch** (`ediscovery-larch-review`, 50 minutes)
3. **Corporate: Halyard Robotics Series A** (`corporate-halyard-robotics`, 50 minutes)
4. **Real estate: closing on 418 Alder Lane** (`realestate-alder-closing`, 50 minutes)
5. **Personal injury: Diaz, intake to demand** (`pi-diaz-demand`, 50 minutes)
6. **Immigration: H-1B petition packet** (`immigration-h1b-packet`, 50 minutes)

Overview of the vertical: `docs/14-paralegal-simulations.md`. Full scenario docs: `docs/paralegal/<slug>.md`.

## How to review

- **Every seed is a different variant.** Names, numbers, dates and which row carries which trap change; the rules, traps and expected treatment don't. Approving a rule here approves it for every variant. To see one variant, run the scenario with any seed in the local app.
- **Each simulation has three tables:** the planted traps (expected answer and the rule behind it), the judgment calls the authors flagged, and timing. Write **approve**, **change** or **reject** in the Verdict column and what to change in the Note column. Where the expected answer is defensible but not the only one, say whether the alternative should also get credit.
- **What to check.** Is the expected answer what a competent paralegal does? Is the rule stated in the material, or is it fair to expect from memory? Is anything a paralegal shouldn't decide (privilege, conflicts, case value, ratification) correctly escalated rather than decided? Is the time enough for the work?
- **v1 is already published for testing** (2026-11-17), so the team can take each one on the live site while reviewing. Published rows are frozen: anything marked change or reject is fixed in a new version, which is published after sign-off.

All five share these properties, so they aren't repeated per simulation: 100 points scored automatically (no written replies); three rapid rounds of 15 items × 20 s with items 3, 6, 9, 12 and 15 the harder kinds; inbox steps are multiple choice; fictional people, firms, courts and states; false flags in review tasks cost 1 point each (floored at 0); the right row with the wrong reason earns half.

| Shared choice | Verdict | Note |
| --- | --- | --- |
| Inbox steps are multiple choice, not written replies, so nothing waits for a human scorer | | |
| Message senders are role lines ("Your supervising partner"), bodies signed with seeded names | | |
| False flag −1 each; right row, wrong reason = half points | | |
| Fictional courts (D. Wex., 14th Cir., Supreme Court of Wexford), fictional states (Wexford, Calloway), no Bluebook text, no CPT codes | | |

---

## 1. Litigation: Morrow v. Tidewater Freight (52 minutes, 100 points)

**Setup.** Litigation paralegal at a plaintiff's firm, cargo-damage case in the fictional District of Wexford. Real FRCP and federal holidays; invented local rules (L.R. 5.2, 7.1). Doc: `docs/paralegal/litigation-morrow-tidewater.md`.

### Traps

| # | Task | Trap | Expected answer | Rule | Pts | Verdict | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Rapid A | Deadline ends on a weekend | Roll forward to Monday, not back to Friday | FRCP 6(a)(1)(C) | ½ each | | |
| 2 | Rapid A | Deadline ends on an observed federal holiday, or a weekend before a Monday holiday | Next court day after the holiday | FRCP 6(a)(1)(C), 6(a)(6); 5 U.S.C. 6103(b) | 1 each | | |
| 3 | Rapid A | Service by mail | Compute the 6(a) date, add 3 days, roll again | FRCP 6(d) | 1 each | | |
| 4 | Rapid A | Holidays inside the period | Still count (only the last day rolls) | FRCP 6(a)(1)(B) | ½ | | |
| 5 | Privilege | Attorney-client email set to Produce | Flag "Privileged: withhold it and log it" | Client asks the firm for legal advice, nobody else on it | 4 | | |
| 6 | Privilege | Work-product memo set to Produce | Flag "Privileged" | Prepared for this case (FRCP 26(b)(3)) | 4 | | |
| 7 | Privilege | Withheld advice email CCs the vendor's rep | Flag "Privilege likely waived" | Outsider on it; the partner makes the call | 4 | | |
| 8 | Privilege | Bates gap of 2–6 numbers | Flag the row after (or before) the gap | Production numbering must be continuous | 3 | | |
| 9 | Privilege | Bates numbers stamped twice | Flag the reused row (or the one before) | Same | 3 | | |
| 10 | Privilege | Decision | Hold the volume, send the flagged documents to the partner | Paralegal flags privilege calls, doesn't make them | 2 | | |
| 11 | Privilege | Look-alike: client email to Tidewater mentioning "our attorney" | Produce (not privileged); correctly withheld A-C and WP rows are clean | Sent to the adversary | −1 if flagged | | |
| 12 | Rapid B | "vs." / "v", wrong volume or reporter, year, first page, pin, court abbreviation | Pick the wrong part, or "Correct as written" | The firm's guide in `CITATION_GUIDE` | ½ or 1 | | |
| 13 | Rapid B | Wexford Supreme Court case with a court named in the parenthetical | "Court or year" is wrong (year alone) | Firm guide | 1 | | |
| 14 | Cite-check | **Case not in the research file (the AI hallucination)** | Flag "Not in the research file: can't be verified" | Nobody has read it; it can't be cited | 5 | | |
| 15 | Cite-check | Overruled case | Flag "No longer good law" | File status: overruled by the same court | 4 | | |
| 16 | Cite-check | Parenthetical changes the holding ("may" vs "never") | Flag "Parenthetical doesn't match the holding" | Must match the file's holding | 3 | | |
| 17 | Cite-check | Wrong pin cite | Flag "Wrong pin cite" | Pin = page the holding is on | 3 | | |
| 18 | Cite-check | Wrong year | Flag "Wrong year" | Year per the file | 3 | | |
| 19 | Cite-check | Decision | Hold the filing, send the partner the problems | An attorney decides what replaces an authority | 2 | | |
| 20 | Rapid C | Procedure questions (waiver by forwarding, 30(b)(1) notice, RFAs deemed admitted, midnight e-filing, draft expert reports, who serves a summons) | One right option each | FRCP as cited in the doc | ½ or 1 | | |
| 21 | Rapid C | Interrogatories left under 25; depositions left under 10 per side | The subtraction | FRCP 33(a)(1), 30(a)(2)(A)(i) | 1 each | | |
| 22 | Exhibit list | Empty binder tab | Flag "Not in the binder" | Find it or drop it | 3 | | |
| 23 | Exhibit list | Same document listed twice (different wording) | Flag the later one (either counts) "Same document listed twice" | Same Bates and date | 4 | | |
| 24 | Exhibit list | Bates outside both productions | Flag "Never produced in discovery" | May be excluded, FRCP 37(c)(1) | 4 | | |
| 25 | Exhibit list | Deposition date off by 1–9 days | Flag "Date doesn't match the document" | Transcript cover date | 4 | | |
| 26 | `inbox-filing` | Partner wants the opposition filed by 5 pm | Pick: OCR text, each exhibit separate and labelled, split only over the size limit, Word proposed order only if there is one. Not: one combined PDF, emailing the clerk, waiting until midnight | Fictional L.R. 5.2 | 7 (multi) | | |
| 27 | `inbox-opposing` | Opposing paralegal asks for documents directly | Send nothing; requests go through counsel; forward to the partner | Contact through counsel | 4 | | |
| 28 | `inbox-client` | Client asks whether to take an offer | Can't give legal advice; partner calls today; pass the offer on right away | UPL; duty to convey offers | 4 | | |

### Judgment calls

| # | Call | Verdict | Note |
| --- | --- | --- | --- |
| 1 | Reply period 7 days (fictional L.R. 7.1(c)), opposition 14 | | |
| 2 | Only federal holidays count; Wexford adds none (FRCP 6(a)(6) would allow state holidays) | | |
| 3 | Mail days added after the 6(a) roll, then roll again | | |
| 4 | Holidays listed on every deadline item (a docketing calendar shows them) | | |
| 5 | Waived privilege is a flag, not a decision; the partner decides | | |
| 6 | Fictional reporters (N.F.R., N.F. Supp., Wex.) so no cite matches a real case | | |
| 7 | Inbox is multiple choice; a written reply to the opposing paralegal could come later | | |
| 8 | The fabricated case looks real; the only tell is its absence from the research file | | |
| 9 | Role-line senders | | |
| 10 | Number answers kept to single digits (leak test reads numbers as cents); depositions left, not minutes left | | |
| 11 | Some production-index dates fall on weekends; not a trap | | |

### Timing

| Section | Minutes | Work | Verdict | Note |
| --- | --- | --- | --- | --- |
| Rapid A: deadlines | 6 | 15 × 20 s | | |
| Privilege review | 11 | 15 documents, 6 findings | | |
| Rapid B: citation format | 6 | 15 × 20 s | | |
| Cite-check | 11 | 9 authorities against the research file | | |
| Rapid C: procedure | 6 | 15 × 20 s | | |
| Trial prep and inbox | 12 | Exhibit list 360 s, filing 150 s, opposing 105 s, client 105 s | | |

**Overall verdict (litigation):** ______ &nbsp; Reviewer: ______ &nbsp; Date: ______

---

## 2. eDiscovery: Project Larch review batch (50 minutes, 100 points)

**Setup.** Contract reviewer at the firm defending Larchmont Polymers. The review protocol is inbox message `m1`, open all attempt: period (both days included), four of six issue tags, Larchmont's lawyers, custodians, review manager, foreign-language queue. Doc: `docs/paralegal/ediscovery-larch-review.md`.

### Traps

| # | Task | Trap | Expected answer | Rule | Pts | Verdict | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Coding rounds | On-topic document dated 2–25 days outside the period | Not responsive, not privileged, No tag | Responsive = in period **and** about a tag | 1.5 (naive costs 1.0) | | |
| 2 | Coding rounds | Document dated exactly on the first or last day | Responsive, its tag | Both days included | 1.5 (naive costs 1.0) | | |
| 3 | Coding rounds | Advice request with a consultant / vendor on Cc | Responsive, **not** privileged | Third party breaks privilege | 1.5 (naive costs 0.5) | | |
| 4 | Coding rounds | Business email with a lawyer only copied | Responsive, **not** privileged | Copying a lawyer isn't privilege | 1.5 (naive costs 0.5) | | |
| 5 | Coding rounds | Memo "prepared at the request of [lawyer] for the litigation", no lawyer on it | Responsive, **privileged** | Work product | 1.5 (naive costs 0.5) | | |
| 6 | QC review | Out-of-period document coded responsive | Flag "Dated outside the review period" | Protocol period | 3 | | |
| 7 | QC review | Off-tag topic coded responsive | Flag "Not about a protocol issue" | Only this candidate's four tags | 3 | | |
| 8 | QC review | Third-party-copied advice request coded privileged | Flag "Wrong privilege call" | Third party | 3 | | |
| 9 | QC review | Lawyer-and-Larchmont-only advice coded not privileged | Flag "Wrong privilege call" | Attorney-client | 3 | | |
| 10 | QC review | Hot document (deleting test sheets / knew off-spec) with Hot = No | Flag "Hot document not marked Hot" | Protocol hot rule | 3 | | |
| 11 | QC review | Responsive document with another tag | Flag "Wrong issue tag" | | 3 | | |
| 12 | QC review | Look-alikes: boundary date coded R, lawyer-copied coded not P, WP memo coded P, a second hot coded Hot, etc. | Leave unflagged | | −1 if flagged | | |
| 13 | Search terms | Narrow strings have fewer hits than the right one | Pick `(term* OR "phrase") w/15 context` | Find every relevant sample document, then fewest hits | 4 | | |
| 14 | Review estimate | Projection from a sample | Projected = hits ÷ sample × collection; hours = projected ÷ rate, one decimal | Arithmetic (dividing sample hits by the rate loses the hours) | 2 + 2 | | |
| 15 | Privilege log | Author or recipients blank | Flag "Author or recipients missing" | Each entry needs them | 3 | | |
| 16 | Privilege log | "Email." / "Correspondence." description | Flag "Description too vague" | Must say what it's about | 3 | | |
| 17 | Privilege log | "Email from counsel advising that …" | Flag "Description reveals the legal advice" | Describe without revealing | 3 | | |
| 18 | Privilege log | Attorney-client claimed, no lawyer on it | Flag "No lawyer on it: the basis doesn't fit" | | 3 | | |
| 19 | Privilege log | Consultant / vendor among recipients | Flag "Third party on it: not privileged, produce it" | | 3 | | |
| 20 | `hot-doc` | Custodian email meets the hot rule | Code Hot, email the review manager the doc ID now, discuss with no one else | Protocol escalation | 5 | | |
| 21 | `foreign-doc` | Spanish / German / French / Portuguese email | Tag Foreign language, route to **this protocol's** queue uncoded | Protocol; no free online translator (confidentiality) | 4 | | |
| 22 | `partial-priv` | Advice forwarded to a colleague with a business note | Produce with the privileged message redacted, log the redaction | Redact partial privilege | 5 (one of three cases) | | |
| 23 | `partial-priv` | Custodian replies to the lawyer asking for more advice | Withhold the whole document and log it | All of it privileged | (same step) | | |
| 24 | `partial-priv` | Advice forwarded to a consultant / vendor | Produce in full | Privilege waived | (same step) | | |

### Judgment calls

| # | Call | Verdict | Note |
| --- | --- | --- | --- |
| 1 | QC section first (14 min), so the protocol is read before any 20-second coding | | |
| 2 | Coding rounds worth 15 each (45 of 100), not 10 | | |
| 3 | Protocol lives in the inbox, not on each item; lawyers identifiable by organisation in every From/To/Cc | | |
| 4 | Review estimate spreadsheet added (4 pts); search string and inbox trimmed to pay for it | | |
| 5 | Non-responsive documents get "No tag", so the out-of-period trap costs two fields | | |
| 6 | Hot coding only in QC and the inbox, not a fourth rapid field | | |
| 7 | Privilege simplified: legal advice recognisable from the text; mixed content only in the partial-privilege chain | | |
| 8 | Work-product memo has no recipient in the rounds but is addressed to outside counsel in the log | | |
| 9 | No real court or Federal Rules timing used | | |

### Timing

| Section | Minutes | Work | Verdict | Note |
| --- | --- | --- | --- | --- |
| Protocol and QC review | 14 | Read protocol, 20 rows, 6 miscodes | | |
| Coding round 1 | 6 | 15 × 20 s, three fields each | | |
| Search terms and privilege log | 10 | Search 150 s, estimate 150 s, log 300 s (8 entries) | | |
| Coding round 2 | 6 | 15 × 20 s | | |
| Review inbox | 8 | Hot 150 s, foreign 150 s, partial privilege 180 s | | |
| Coding round 3 | 6 | 15 × 20 s | | |

**Overall verdict (eDiscovery):** ______ &nbsp; Reviewer: ______ &nbsp; Date: ______

---

## 3. Corporate: Halyard Robotics Series A (50 minutes, 100 points)

**Setup.** Corporate paralegal on a fictional Delaware startup closing its Series A. Real SEC, IRC and DGCL rules; invented bylaws, charter, plan and NDA playbook. Doc: `docs/paralegal/corporate-halyard-robotics.md`.

### Traps

| # | Task | Trap | Expected answer | Rule | Pts | Verdict | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Rapid A | Fully diluted % | (shares + options) ÷ (outstanding + options outstanding + pool) | Fully diluted counts the pool | 1 | | |
| 2 | Rapid A | Post-money % | new ÷ (before + new) | | 1 | | |
| 3 | Rapid A | Calendar deadlines (Form D 15 days, 83(b) 30 days, Form 3 10 days) | Don't count the event day; weekend or holiday rolls forward | Rule 503, IRC §83(b) / §7503 | ½ | | |
| 4 | Rapid A | Business-day deadlines crossing a federal holiday (Form 4 2, 8-K 4, 13D 5) | Count weekdays that aren't federal holidays | SEC business days | 1 | | |
| 5 | Cap table | Transfer from the CTO to the family trust | Move shares between the two lines; total unchanged | A transfer isn't an issuance | 4.5 if missed | | |
| 6 | Cap table | Grant to a new hire from the pool | Pool down, options outstanding up; hire has no line | | 4.5 if missed | | |
| 7 | Cap table | Option exercise | Options outstanding down, employee's Common up | | 4.5 if missed | | |
| 8 | Cap table | Fully diluted total and percentages | Only the round and the pool top-up change the total; % to two decimals ±0.01 | | 2 + 1.25 each | | |
| 9 | Rapid B | Board consent unanimous; stockholder consent by votes needed; notice 10–60 days; attendance waives notice; §204 ratification; quorum on a board with vacancies | One right option each | DGCL §141(f), §228, §222, §229, §204; majority of the whole board | 1 each | | |
| 10 | Board actions | Meeting without a quorum | Flag "No quorum" | Majority of the whole board | 4.5 | | |
| 11 | Board actions | Special meeting on short notice, a director absent | Flag "Not enough notice" | Bylaws notice; §229 waiver only by attending | 4.5 | | |
| 12 | Board actions | Written consent missing one signature | Flag "Written consent not signed by every director" | §141(f) | 4.5 | | |
| 13 | Board actions | Options over preferred, Class B Common, or Series A before the restated charter | Flag "Stock the charter or the plan doesn't allow" | Charter classes; plan is Common only | 4.5 | | |
| 14 | Board actions | Decision | Send the partner the list; likely §204 ratification is the attorney's call. Not: send as is, redate or add signatures, strip pages | | 2 | | |
| 15 | Board actions | Look-alikes: exact quorum with notice, regular meeting with no notice, fully signed consent in another order, grant over Common, authorized issuance | Leave unflagged | | −1 if flagged | | |
| 16 | NDA | Liability cap below the playbook minimum | Flag "Below the playbook minimum" | Playbook | 3 | | |
| 17 | NDA | Governing law not Delaware | Flag "Not the playbook's required choice" | Playbook (venue in Delaware is clean) | 3 | | |
| 18 | NDA | Non-solicit longer than the maximum | Flag "Longer than the playbook allows" | Playbook | 3 | | |
| 19 | NDA | Automatic one-year renewals | Flag "A term the playbook doesn't allow" | Fixed term only | 3 | | |
| 20 | Closing checklist | Two documents each missing one signatory's page | Flag each | | 2 + 2 | | |
| 21 | Closing checklist | Two of: charter only sent for filing; good standing too old (3 or 5 days); compliance certificate signed by the CFO | Flag each | Deal conditions | 2 + 2 | | |
| 22 | Closing checklist | Decision | Hold the closing until pages are in and each condition is met or waived in writing | | 2 | | |
| 23 | `inbox-founder` | CEO asks to date the grant consent before the new valuation | Don't backdate; consent is effective when the last director signs; pass to the partner | §141(f); no backdating | 4 | | |
| 24 | `inbox-diligence` | Acquirer wants the full cap table before its NDA is signed | Send nothing until the NDA is signed and the partner approves | Confidentiality | 4 | | |

### Judgment calls

| # | Call | Verdict | Note |
| --- | --- | --- | --- |
| 1 | Rapid A mixes in public company and fund clients for Form 3/4, 8-K, 13D | | |
| 2 | Business days skip federal holidays only; 83(b) item states the §7503 roll | | |
| 3 | Notice trap always has a director absent (§229 waiver) | | |
| 4 | "Wrong share class" covers three versions with one reason | | |
| 5 | Board decision is ratification by an attorney, not a paralegal fix | | |
| 6 | Percentages to two decimals ±0.01; share counts exact | | |
| 7 | Generator redraws a variant when a percentage could collide with a visible number (leak guard) | | |
| 8 | Inbox is multiple choice | | |
| 9 | Role-line senders | | |
| 10 | Good-standing freshness (3 or 5 days) is a deal condition, not a rule of law | | |

### Timing

| Section | Minutes | Work | Verdict | Note |
| --- | --- | --- | --- | --- |
| Rapid A: ownership and deadlines | 6 | 15 × 20 s | | |
| Cap table | 10 | 5 transactions, 8 lines + total + 8 percentages | | |
| Rapid B: governance | 6 | 15 × 20 s | | |
| Board actions | 10 | 9 actions vs. bylaws and charter | | |
| Rapid C: contract terms | 6 | 15 × 20 s | | |
| Deal desk and inbox | 12 | NDA 270 s, checklist 240 s, founder 105 s, diligence 105 s | | |

**Overall verdict (corporate):** ______ &nbsp; Reviewer: ______ &nbsp; Date: ______

---

## 4. Real estate: closing on 418 Alder Lane (50 minutes, 100 points)

**Setup.** Paralegal at the settlement attorney's office, sale of a duplex with a tenant in the fictional State of Wexford. Convention stated on every item: 365-day year, actual days in the month, rent prorated only if collected, the buyer or seller (per seed) owns the closing day, round once at the end. Doc: `docs/paralegal/realestate-alder-closing.md`.

### Traps

| # | Task | Trap | Expected answer | Rule | Pts | Verdict | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Rapid A | Calendar-year tax unpaid / paid by the seller | Unpaid: seller credits buyer for seller's days. Paid: buyer credits seller for buyer's days | Stated convention | ½ | | |
| 2 | Rapid A | Rent collected / HOA paid by the seller | Rent: seller credits buyer for buyer's days. HOA: buyer credits seller for buyer's days | Stated convention | ½ | | |
| 3 | Rapid A | Prepaid interest | Loan × rate ÷ 365 × days from closing through month end, both included | Lender practice, stated | ½ | | |
| 4 | Rapid A | Seller's payoff interest, sometimes a missed payment | From the day after paid-through date through closing, ÷ 365 | Stated | 1 | | |
| 5 | Rapid A | Fiscal-year tax (July–June) paid | Buyer credits seller from closing to June 30 | | 1 | | |
| 6 | Rapid A | Rent not collected | No credit | Prorate only if collected | 1 | | |
| 7 | Rapid A | Rent plus deposit | Buyer's share of rent plus the whole deposit, both to the buyer | | 1 | | |
| 8 | Settlement | Tax direction flips with paid / unpaid | Unpaid: buyer credit + seller debit; paid: buyer debit + seller credit | | 2 if wrong side | | |
| 9 | Settlement | Security deposit easy to forget | Buyer credit, seller debit | Buyer takes over the lease | 1 if missed | | |
| 10 | Settlement | HOA runs the other way from rent | HOA: buyer debit, seller credit; rent: buyer credit, seller debit | | ½ + ½ each | | |
| 11 | Settlement | Payoff needs per diem interest on top of principal | Seller debit = principal + interest | | 1 if wrong | | |
| 12 | Settlement | Earnest money, loan, seller credit, commission, transfer tax, buyer charges, totals, cash to close | As in the doc's line table | Four columns per line, HUD-1 style balancing | rest of 20 | | |
| 13 | Rapid B | Title terms (similar-name affidavit, gap search, race-notice, warranty vs quitclaim, subordination, priority) | One right option each | | ½ or 1 | | |
| 14 | Title | Home equity line left on title | Flag "Open lien: pay it off" (and freeze / close the line) | | 4 | | |
| 15 | Title | Mechanic's lien left on title | Flag "Open lien" | Pay or bond off and release | 3 | | |
| 16 | Title | Last year's delinquent taxes treated as permitted | Flag "Open lien" | Only taxes not yet due are permitted | 3 | | |
| 17 | Title | Judgment against a similar name set to be paid | Flag "Not our seller: clear it with a name affidavit" | Different middle initial and address | 4 | | |
| 18 | Title | Driveway easement for the neighbour accepted | Flag "Not a permitted exception" | Only utility easements permitted | 4 | | |
| 19 | Title | Decision | Title memo to the attorney before confirming the closing | Not close as written, pay everything, or delete every exception | 2 | | |
| 20 | Title | Look-alikes: first mortgage being paid off, released old mortgage, satisfied exact-name judgment, current taxes, utility easement, plat, HOA declaration | Leave unflagged | | −1 if flagged | | |
| 21 | Rapid C | Grantor (misspelling, co-owner left off, middle initial), legal description (lot / block, transposed plat page), notary (missing, expired commission), fee short | Pick the part, or ready to record | Recording requirements | ½ or 1 | | |
| 22 | Deed review | Grantor doesn't match vesting | Flag the grantor line | | 5 | | |
| 23 | Deed review | Legal description differs from the survey (lot, block or plat page) | Flag the legal description | | 5 | | |
| 24 | Deed review | No notary block | Flag the acknowledgment | Recording act needs acknowledgment | 5 | | |
| 25 | `inbox-lender` | Lender changes the loan (APR up > 1/8, APR up less, prepayment penalty, lower amount) | Always: update the statement and new cash to close; get revised instructions in writing. Plus: new 3-business-day wait for a large APR rise or added penalty, otherwise a corrected CD with no new wait | 12 CFR 1026.19(f)(2), summarised in the prompt | 8 (multi) | | |
| 26 | `inbox-buyer` | Buyer wants to move the closing | Attorney handles it: written amendment signed by both sides, then update prorations, payoff and rate lock | | 7 | | |

### Judgment calls

| # | Call | Verdict | Note |
| --- | --- | --- | --- |
| 1 | Closing-day owner varies per seed; 365-day year and actual-days months fixed; round once, ±$0.01 | | |
| 2 | Leap years avoided (all closings in 2027) | | |
| 3 | Uncollected rent isn't prorated | | |
| 4 | Payoff interest runs through the closing date | | |
| 5 | Prepaid interest includes the closing day and the last day of the month | | |
| 6 | Four columns per line, not the CFPB Closing Disclosure layout; cash rows in the balancing columns | | |
| 7 | Transfer tax and commission are the seller's by contract (stated) | | |
| 8 | Delinquent taxes use the same "open lien" reason as mortgages | | |
| 9 | Similar-name judgment cleared by a name affidavit, not payment | | |
| 10 | Inbox is multiple choice | | |
| 11 | Deed-review notary trap is always the missing block; expired commission only in Rapid C | | |
| 12 | Role-line senders | | |
| 13 | Recording act cited generically; CFPB rule cited for real | | |
| 14 | Some notary dates fall on weekends; not a trap | | |

### Timing

| Section | Minutes | Work | Verdict | Note |
| --- | --- | --- | --- | --- |
| Rapid A: prorations | 6 | 15 × 20 s with day counts | | |
| Settlement statement | 11 | 11 lines × 4 cells, totals, cash to close | | |
| Rapid B: title terms | 6 | 15 × 20 s | | |
| Title commitment | 11 | 12 items | | |
| Rapid C: deed and recording | 6 | 15 × 20 s | | |
| Deed review and inbox | 10 | Deed 300 s, lender 150 s, buyer 150 s | | |

**Overall verdict (real estate):** ______ &nbsp; Reviewer: ______ &nbsp; Date: ______

---

## 5. Personal injury: Diaz, intake to demand (50 minutes, 100 points)

**Setup.** PI paralegal at a plaintiff's firm on a car-crash file in the fictional State of Calloway (2-year PI, 3-year property, 180 days for a public entity, minors from 18, 51% bar, full-billed collateral source rule; all stated). Plain bill descriptions, no CPT codes. Doc: `docs/paralegal/pi-diaz-demand.md`.

### Traps

| # | Task | Trap | Expected answer | Rule | Pts | Verdict | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Rapid A | 2-year date on a weekend | Next court day | Stated roll rule | ½ | | |
| 2 | Rapid A | Client was a minor | Period starts on the 18th birthday | Stated tolling | 1 | | |
| 3 | Rapid A | Public entity | 180 days, not 6 months or 2 years | Stated | 1 | | |
| 4 | Rapid A | Last day on a court holiday | Roll past the holiday too | Federal holidays via helpers | 1 | | |
| 5 | Rapid A | Comparative fault, client 55–65% at fault | Recovers nothing | 51% bar | 1 | | |
| 6 | Rapid A | Net to client | After fee, costs and the health plan lien | | 1 | | |
| 7 | Chronology | Items shown shuffled; date received is not date of service; three date formats | Order by date of service consistent with referral logic | `ordering` | 5 position + 5 pairwise | | |
| 8 | Treatment gaps | Two gaps over 30 days (34–75) | Flag "gap" on either visit | "More than 30 days" | 4 + 4 | | |
| 9 | Treatment gaps | Annual physical before the date of loss | Flag "pre_loss" | Not accident treatment | 2 | | |
| 10 | Treatment gaps | Near miss of 24–30 days (often exactly 30); jump from pre-loss physical to the ED | Leave unflagged | Not more than 30; not a treatment gap | −1 if flagged | | |
| 11 | Specials | Same invoice from the provider and the plan's EOB | Count once | Each bill once | 12 if counted twice | | |
| 12 | Specials | Self-paid pre-loss physical | Leave out | Not accident treatment | 10 if included | | |
| 13 | Specials | Allowed amounts (billed − adjustment) used | Use billed | Calloway collateral source rule | 6 if wrong | | |
| 14 | Specials | LOP balances | Billed − adjustment − plan paid − patient paid, at the two LOP providers | | 4 | | |
| 15 | Rapid B | Account balance, plan reimbursement excluding an unrelated checkup, billed under the collateral source rule; who accepts a reduction; duplicate once; pre-loss stays out | One right option each | | 1 each | | |
| 16 | Rapid C | Conflicts check for the other driver; rent advances; conflicting dates of loss; records left out; runner solicitation; adjuster's offer goes to the attorney | One right option each | Ethics rules for non-lawyer staff | 1 each | | |
| 17 | Demand | Date of loss 1–9 days off the intake | Flag "wrong_date" | | 5 | | |
| 18 | Demand | Specials total includes the duplicate again | Flag "math" | | 5 | | |
| 19 | Demand | Provider left out of rows and enclosures | Flag "missing" on the enclosures | | 5 | | |
| 20 | Demand | Decision | Hold it, send the attorney the problems and a corrected draft. Not: send today, sign it yourself, send without bills | Only an attorney signs the demand | 3 | | |
| 21 | `inbox-conflict` | At-fault driver's insurer is a current firm client | Stop and take it to the attorney | Conflicts are the attorney's call | 6 | | |
| 22 | `inbox-value` | Client asks what the case is worth | Can't give a value; set up a call with the attorney | UPL | 6 | | |

### Judgment calls

| # | Call | Verdict | Note |
| --- | --- | --- | --- |
| 1 | Calloway uses full billed amounts (collateral source); paid-amount states may want a variant | | |
| 2 | Pre-loss physical excluded outright unless the attorney decides it's related | | |
| 3 | Duplicate bill costs 12 of 20 (three linked cells); lower the specials cell or zero total liens if too heavy | | |
| 4 | Ordering split 5 position / 5 pairwise; one neighbour swap costs about 1.4 | | |
| 5 | Gap rule "more than 30 days", near miss often exactly 30 | | |
| 6 | Insurer-as-client treated as an adverse interest needing an attorney's decision; tests escalation, not the conflict answer | | |
| 7 | Lost wages and policy limits shown but not tested | | |
| 8 | Rapid A dates kept in 2026–2028 (verified holiday years) | | |

### Timing

| Section | Minutes | Work | Verdict | Note |
| --- | --- | --- | --- | --- |
| Rapid A: limitations and damages | 6 | 15 × 20 s; amounts to the cent | | |
| Chronology and gaps | 10 | Ordering 330 s (8 items), gaps 270 s (16 rows) | | |
| Rapid B: medical billing | 6 | 15 × 20 s | | |
| Medical specials | 11 | 10 invoices, 5 cells | | |
| Rapid C: intake and ethics | 6 | 15 × 20 s | | |
| Demand and inbox | 11 | Demand 420 s, conflict 120 s, value 120 s | | |

**Overall verdict (personal injury):** ______ &nbsp; Reviewer: ______ &nbsp; Date: ______

---

## 6. Immigration: H-1B petition packet (50 minutes, 100 points)

**Setup.** Immigration paralegal at a law firm on an H-1B extension of stay for a worker at a fictional employer. Fictional agency and forms (P-129, WA-9035, A-28, AR-94, N-797) modelled on the real process; every rule is stated, and the attorney gives legal advice. Doc: `docs/paralegal/immigration-h1b-packet.md`.

### Traps

| # | Task | Trap | Expected answer | Rule | Pts | Verdict | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Rapid A | Filing window | 6 months before the start date, same day of the month (not 180 days) | Stated | ½ | | |
| 2 | Rapid A | Arrival record end | Approved end + 10 days | Stated | ½ | | |
| 3 | Rapid A | Arrival record, passport expires first | Passport expiry, no 10 days added | Stated | 1 | | |
| 4 | Rapid A | Grace period | 60 days after the last day of work, or the arrival record end if earlier | Stated | ½ / 1 | | |
| 5 | Rapid A | Extension filing | 45 days before the arrival record ends (not the approved end) | Firm practice | ½ | | |
| 6 | Rapid A | Six-year limit and recapture | 6 years plus full days outside; departure and return days don't count | Stated | 1 each | | |
| 7 | Forms | Identity detail off (swapped letters, day/month swap, transposed passport digits) | Flag: doesn't match the passport | Identity comes from the passport | 4 | | |
| 8 | Forms | Job title or occupation code | Flag: doesn't match the attestation | Job details match the certified attestation | 3 | | |
| 9 | Forms | Lower wage or other wage level | Flag: wage doesn't match | Same | 4 | | |
| 10 | Forms | Petition dates outside the attestation's validity | Flag: outside the validity period | Stated | 3 | | |
| 11 | Forms | Worksite not on the attestation | Flag: worksite isn't covered | Stated | 4 | | |
| 12 | Forms | Passport capitals and day-first dates; start a few days after validity begins | Leave unflagged | Look-alikes | −1 if flagged | | |
| 13 | Forms | Decision | Hold the filing, send the attorney the list, corrections through the attorney | | 2 | | |
| 14 | Checklist | Document "not in the packet" | Flag: missing | | 4 | | |
| 15 | Checklist | A-28, P-129 or support letter unsigned | Flag: not signed | | 4 | | |
| 16 | Checklist | Fee check with wrong training-fee tier or an omitted fee | Flag: wrong fee ($780 + $500 + $750, or $1,500 at 26+ employees) | Fee schedule stated | 4 | | |
| 17 | Checklist | Foreign-language degree or experience letter | Flag: needs a certified translation | | 3 | | |
| 18 | Checklist | Attestation pending, or copy of an old expired passport | Flag: not valid on the filing date | | 3 | | |
| 19 | Checklist | Decision | Hold the packet, send the attorney the list | | 2 | | |
| 20 | Rapid B | 13 easy and 6 hard term questions (amended petition for a worksite move, public access file, late RFE response) | One right option each | | ½ / 1 | | |
| 21 | Rapid C | RFE response due on a weekend or holiday | Last business day *before* (must arrive by) | Stated | ½ / 1 | | |
| 22 | Rapid C | Motion to reopen due on a weekend or holiday | Next business day *after* | Stated | 1 | | |
| 23 | Rapid C | Posting, premium processing, courier | 10 / 15 business days, courier 2 business days before; holidays don't count | Stated | ½ / 1 | | |
| 24 | `inbox-rfe` | Build the RFE response | Cover letter, notice on top, one document per requested item; not padding or the whole file | Multi-select, wrong picks cost | 12 | | |
| 25 | `inbox-backdate` | HR asks for a backdated job letter kept quiet | Refuse, say you can't date it falsely, forward to the attorney now | Never backdate a record | 10 | | |
| 26 | `inbox-beneficiary` | Beneficiary asks whether to travel while pending | No legal advice; the attorney will reply, pass it on today | UPL | 8 | | |

### Judgment calls

| # | Call | Verdict | Note |
| --- | --- | --- | --- |
| 1 | Fictional form names, but the fee amounts mirror the real public schedule (stated in the checklist) | | |
| 2 | Grace period, 10-day arrival record, filing window and recapture are simplified rules stated on each item: applying a rule, not recalling law | | |
| 3 | RFE due dates roll back, motion deadlines roll forward on purpose; the team may prefer one direction | | |
| 4 | 45-day extension filing and 2-business-day courier rule are the fictional firm's own practice | | |
| 5 | Inbox is multiple choice so everything scores automatically; the backdating step could later be a rubric-scored reply | | |
| 6 | Packet tabs shuffled per seed so the fee trap isn't in the same place for everyone | | |
| 7 | Packet passport trap is a copy of a previous passport, so it never contradicts the forms cross-check | | |
| 8 | Number answers are single digits (extension years 1–3, recaptured days 2–6) because of the leak test | | |

### Timing

| Section | Minutes | Work | Verdict | Note |
| --- | --- | --- | --- | --- |
| Rapid A: status and date math | 6 | 15 × 20 s | | |
| Forms cross-check | 10 | 14 details × 4 documents | | |
| Rapid B: terms | 6 | 15 × 20 s | | |
| Packet checklist | 10 | 12 tabs | | |
| Rapid C: deadlines | 6 | 15 × 20 s | | |
| Inbox | 12 | RFE 300 s, backdate 210 s, beneficiary 210 s | | |

**Overall verdict (immigration):** ______ &nbsp; Reviewer: ______ &nbsp; Date: ______

---

## After sign-off

1. Fix everything marked change (bump the scenario version if the key or scoring changes) and rerun the scenario tests.
2. Update the status line in each `docs/paralegal/<slug>.md` and in `docs/14-paralegal-simulations.md`.
3. Publish the new versions of anything that changed (v1 is already in the library).
