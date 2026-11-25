# Marketing coordinator: launch week at Saltbox

Status: **draft: practitioner review pending.** Version 1. Not published; the draft gate keeps it out of the library until a marketing practitioner has reviewed it.

| | |
| --- | --- |
| Slug | `marketing-saltbox-launch` v1 |
| Title | Launch week at Saltbox: marketing coordinator |
| Role family | `marketing` |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/marketing-saltbox-launch.ts` |
| Shared helpers | `src/lib/engine/scenarios/legal/` (name pools, date formatting), imported, not moved |
| Tests | `tests/engine/marketing-saltbox-launch.test.ts` |

## Setup

The candidate is the marketing coordinator at Saltbox Provisions, a fictional direct-to-consumer brand, in launch week for a new product. The cast, each with a role line as the message sender and a seeded name in the signature:

| Role | Voice | Sends |
| --- | --- | --- |
| Marketing manager | Terse, wants the Friday report | Launch sheet, report brief, QA brief, the launch move, the board-slide request |
| Paid media lead | Fast, cuts corners | Metrics brief, the spend correction, test plan, A/B results, "skip the link checks" |
| Designer | Helpful, careful | Brand and claims guide, copy brief, the wrong-code catch |
| Agency account executive | Pushy | Asks for the plain customer list |
| Finance partner | Precise | Reporting rules, SOW summary, budget brief, the invoice |
| Creator partner (paid) | Wants to post tonight | Asks to say "clinically proven" |

**Seeded per attempt:** the product line (cookware, coffee gear, pet food, skincare, luggage) and product, every person, the agency, price, discount, promo code, last month's code, campaign tag, launch date and time, how far launch moves, the legal line's end date, the suppressed segments, every channel number, which campaign is doubled, which is corrected and which channel has no orders, which asset, copy and invoice line carries which trap, the rate card and hours cap, the test plan thresholds and A/B numbers, and where every right option sits.

**Cards** (arrive at the start and stay in the inbox): launch sheet, brand and claims guide, reporting rules, test plan, agency statement of work. Formulas, the test plan, the pacing rule, the suppression list and the SOW terms are **Saltbox policy**, handed to the candidate; nothing is scored on outside knowledge of a current number.

## Sections and timing

| # | Section id | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | `s-rapid-a` | 6 | `rapid-metrics` (15 × 20 s) | 10 |
| 2 | `s-work-1` | 10 | `campaign-report` (spreadsheet) | 20 |
| 3 | `s-rapid-b` | 6 | `rapid-copy` (15 × 20 s) | 10 |
| 4 | `s-work-2` | 10 | `launch-qa` (document review, 12 assets) | 20 |
| 5 | `s-rapid-c` | 6 | `rapid-budget` (15 × 20 s) | 10 |
| 6 | `s-desk` (one screen at a time) | 12 | `invoice-check` 270 s, `ab-readout` 75 s, `ab-lift` 75 s, five values calls 60 s each | 12 + 4 + 4 + 10 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds, worth 1; the other ten are worth ½. Every item is a choice of four with fixed ids (a–d) and a seeded position for the right answer. Each section's brief arrives when the section opens; the two long tasks each get a change four minutes in.

## Rapid round A: campaign metrics (10)

Each item shows one channel's line (impressions, clicks, orders, spend) or a two-channel comparison.

| Kind | Tier | Right answer | Wrong options (the slips) |
| --- | --- | --- | --- |
| CTR | ½ | clicks ÷ impressions, % to 2 dp | orders ÷ clicks (conversion rate); the ratio written as a percent (0.02%); per thousand (×10) |
| CPC | ½ | spend ÷ clicks | inverted (clicks ÷ spend); CPA; CPM |
| CPA | ½ | spend ÷ orders | CPC; inverted; CPM |
| Conversion rate | ½ | orders ÷ clicks | orders ÷ impressions; CTR; decimal as percent |
| CPM | ½ | spend ÷ impressions × 1,000 | no ×1,000; CPC; ×100 |
| Blended CPA | 1 | total spend ÷ total orders | average of the two CPAs; their sum; the larger channel's CPA |
| Blended ROAS | 1 | (revenue − refunds, both channels) ÷ total spend | gross revenue; average of channel ROAS; inverted |
| % change | 1 | (this − last) ÷ last, 1 dp, signed | divided by this week; sign flipped; decimal as percent |
| Pacing | 1 | share spent vs. share of month elapsed, ±5 points = on pace | the two other verdicts; computed against days remaining |

## Section 2: launch-week channel report (20)

The ads export has seven lines over five channels (paid search, paid social, email, affiliates, display), with campaign ID, status, spend, impressions, clicks, orders, revenue and refunds. The summary below it has fixed channel rows; the candidate enters each channel's net revenue, CPA and ROAS, then total net revenue, blended CPA and blended ROAS.

Traps, every seed:

- **Relaunch counted twice.** One campaign appears twice with the same ID and identical numbers (status "Relaunched"). The manager's brief says the export double-counts relaunches; count each ID once. A look-alike: another channel has two campaigns with different IDs, both of which count.
- **Refunds.** Revenue is gross; net revenue = revenue − refunds (reporting rules). Every line with orders has refunds, so net never equals a figure on screen.
- **No orders.** One channel (paid social, affiliates or display) has zero orders; its CPA is left blank and is not in the key. Its net revenue and ROAS are 0.
- **Mid-task correction (minute 4).** The paid media lead revises one campaign's spend (a late platform invoice). The key uses the corrected spend. The doubled and corrected campaigns are always in different channels, both with orders.

Scoring: 14 channel cells at 1 point (5 net revenue, 4 CPA, 5 ROAS), then total net revenue, blended CPA and blended ROAS at 2 each: 20 on every seed. Tolerance ±0.01 on every cell, so either rounding of the exact value scores. **Change from the brief:** the brief priced total net revenue at 1, which gives 19 because the zero-order CPA is never scored; total net revenue is 2 here so the step is 20 on every seed.

The mistakes cost exactly the cells they change (the tests check this per seed): double-counting moves the doubled channel's three cells and all three totals; ignoring the correction moves that channel's CPA and ROAS and the two blended ratios; using gross revenue moves every net revenue and ROAS cell.

## Rapid round B: copy check (10)

Each item shows a piece of copy (email body, SMS, paid social ad, landing page hero, paid search ad, push notification, or a paid creator post), the launch sheet line it must match, the legal line, the claims not allowed and the house rules.

| Kind | Tier | Right option |
| --- | --- | --- |
| Clean (sometimes with the code in lower case, an approved claim, or a correct #ad partner post) | ½ | Fine to publish |
| Price differs from the sheet | ½ | Wrong price |
| Last month's code, or a code with a letter dropped | ½ | Wrong promo code |
| Name with wrong capitals or split ("Emberpan Skillet", "Ember Pan Skillet") | ½ | Wrong product name |
| A claim from the not-allowed list | ½ | Claim not allowed |
| Legal line left off | ½ | Missing legal line |
| Two of the above at once | 1 | The option naming both ("Wrong price and wrong promo code"); wrong: each one alone, or a different pair |
| Right date, wrong weekday ("Launches Wednesday, Nov 17" when Nov 17 is a Tuesday) | 1 | Wrong day of the week; wrong: wrong launch date, fine |
| Paid creator post without #ad | 1 | Missing #ad disclosure |

## Section 4: launch QA (20)

Twelve scheduled assets (three emails, SMS, landing page, two paid social, two paid search, organic Instagram, affiliate newsletter, retargeting banner), in seeded order, with columns asset, headline, price, code, link tag, send / live time, audience and legal line. The header repeats the launch sheet.

| Finding | Points | Reason id |
| --- | --- | --- |
| Promo code differs (last month's code, or a letter dropped) | 3 | `code` |
| Price differs | 3 | `price` |
| `utm_campaign` is last month's tag or missing | 3 | `tag` |
| Goes out before the **new** launch time | 3 | `early` |
| Audience adds a suppressed segment ("Past buyers + Wholesale accounts") | 3 | `suppressed` |
| Legal line missing | 3 | `legal` |
| Decision: hold the flagged assets, approve the rest, send the manager the list | 2 | `hold` |

**Mid-task change (minute 4):** the manager moves launch later by 60, 90 or 120 minutes. The early asset is always at or after the original launch time, so it only becomes a finding once the candidate reads the move.

Clean look-alikes on every seed: an asset exactly at the new launch time; the code in a different case (the sheet says codes aren't case sensitive); a link tag with its parameters in a different order; an audience that names a suppressed segment after "excl.". Wrong decisions: approve everything; fix the assets yourself in the live tools without telling anyone; cancel the launch.

Rules behind it: the launch sheet (Saltbox policy). Suppressing email unsubscribes reflects CAN-SPAM's requirement to honour opt-outs within 10 business days ([FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/CAN-SPAM-act-compliance-guide-business)); the other suppressed segments are Saltbox's own list.

## Rapid round C: budget (10)

| Kind | Tier | Right answer | Wrong options |
| --- | --- | --- | --- |
| Budget left | ½ | budget − spent before − launch week | forgot launch week; the amount spent; sign slip |
| Daily spend to land on budget | ½ | left ÷ days left (incl. today) | ÷ (days − 1); ÷ (days + 1); a week's worth |
| Forecast orders | ½ | budget ÷ forecast CPA | last week's CPA; ÷ CPC (clicks); the average of the two CPAs |
| Agency fee | ½ | media × fee % | media + fee; a decimal slip; fee as a share of the gross |
| Invoice vs. PO | ½ | (media + fee invoiced) − PO, over/under | direction flipped; media line only; the fee |
| Reallocation, orders | 1 | move ÷ new CPA − move ÷ old CPA (total fixed) | sign flipped; only the orders gained; only the orders lost |
| Reallocation, share | 1 | total × (target share − current share) | the target amount; the current amount; the remainder |
| All-in budget | 1 | all-in ÷ (1 + fee %) | all-in × (1 − fee %); the whole budget; the fee |

Continuity: the first "budget left" item uses the channel and the corrected spend from the report's mid-task message.

## Section 6: desk (30)

### Agency invoice vs. the statement of work (12)

Eight invoice lines (description, role, hours, rate, amount, change order) with totals; the header holds the hours cap, rate card, scope and change-order rule.

| Finding | Points | Expected flag |
| --- | --- | --- |
| Total hours above the monthly cap (by 6–30 hours) | 2.5 | Total hours (or the cap field), "Hours over the monthly cap" |
| A rate not on the card: a card role billed above its rate, or a role not on the card ("Senior designer") | 2.5 | That line, "Rate not on the rate card" |
| Out-of-scope work (influencer gifting, retail display design, podcast ads, trade show graphics, packaging) with no change order | 2.5 | That line, "Out of scope with no change order" |
| Hours × rate doesn't equal the amount | 2.5 | That line, "Hours × rate doesn't equal the amount" |
| Decision: return it to the agency with the list, copying finance | 2 | `return` |

Look-alikes: an out-of-scope line with a signed change order; a line with fractional hours (12.75 h) that multiplies correctly. Wrong decisions: approve as billed; correct the amounts yourself and send for payment; stop paying the agency entirely.

### A/B readout (4) and lift (4)

The paid lead's results give visitors and orders per arm; the test plan card gives the minimum sample per arm (5,000–12,000) and the minimum relative lift to ship (5, 8 or 10%).

- Readout: keep running if either arm is under the minimum sample, whatever the lift (40% of seeds, always with a lift above the minimum, the trap); ship B if both arms have the sample and B's lift is at least the minimum; otherwise keep A. Fourth option, always wrong: ship B to everyone now and keep measuring. No call sits within 1 point of the threshold.
- Lift: (B rate ÷ A rate − 1) × 100, one decimal. Full credit within ±0.05, half within ±0.3 (for rounding the rates first).

### Values calls (2 each)

| Step | Tag | Situation | Right option | Tempting wrong ones |
| --- | --- | --- | --- | --- |
| `values-integrity` | integrity | Manager wants the board slide to show ROAS before refunds "because it looks cleaner" | Keep it on net revenue, as the reporting rules define ROAS; offer gross as a separate, labelled line | Change it (it's the manager's slide); label gross as "ROAS" with a footnote; report the manager to finance |
| `values-candor` | candor | Designer spots last month's code in the email the candidate scheduled this morning | Pause the send, fix it, tell the manager it was my mistake | Fix it quietly; ask the designer to fix it; cancel every email in the queue |
| `values-client-care` | client-care | Agency wants the plain customer email list; the SOW allows hashed lists only | Decline; share the hashed list through the transfer folder | Send it (they're under contract); send it password-protected; report the agency for a breach attempt |
| `values-in-lane` | in-lane | Paid creator wants to say "clinically proven to …" | Don't confirm; approved claims only; send the request to legal, who approve claims | Confirm it; say "proven" without "clinically"; end the partnership |
| `values-quality` | quality | Paid lead says skip the link checks to make the send time | Run the checks; tell the paid lead now if the send moves | Skip this once; skip because they're senior; cancel the send for a full template audit |

Pressure from a superior: integrity (the manager), quality (the paid lead). Pressure from outside: client-care (the agency), in-lane (the creator). Sources for the right answers: the reporting rules card (net ROAS); the SOW card (hashed lists only); the brand guide (claims go to legal) and the FTC's substantiation policy, under which a "clinically proven" claim needs that level of support before it runs ([FTC advertising substantiation](https://www.ftc.gov/node/80148), [Health Products Compliance Guidance](https://ftc.gov/system/files/ftc_gov/pdf/Health-Products-Compliance-Guidance.pdf)).

## Scoring table

| Step | Points |
| --- | --- |
| Rapid round A: campaign metrics | 10 |
| Launch-week channel report | 20 |
| Rapid round B: copy check | 10 |
| Launch QA | 20 |
| Rapid round C: budget | 10 |
| Agency invoice | 12 |
| A/B readout | 4 |
| A/B lift | 4 |
| Values calls (5 × 2) | 10 |
| **Total** | **100** |

## What the tests prove (200 seeds)

Every task is solved from the rendered screen with the test's own reading of the rules (the export read by hand, the launch sheet and the move, the SOW, the test plan, every rapid exhibit) and compared with the server key. A perfect attempt scores 100 and a blank 0 on every seed, and the maximum is 100 on every seed. Each QA and invoice trap costs exactly its points, half for the right item with another reason; each clean look-alike flagged costs the 1-point penalty; the wrong decision costs 2. The report mistakes cost exactly the cells they change. Each rapid item has exactly one right option and rounds total 10. Each values call has four options and one right answer, which sits in every position across seeds. Another seed's perfect answers average under 40. No key note, report figure or lift appears in any payload. Sections validate; desk screens sum to 720 seconds; every message points at a real step.

## Judgment calls for review

1. **#ad at the start is Saltbox policy, stricter than the FTC's text.** The Endorsement Guides require a disclosure that is "clear and conspicuous", meaning hard to miss and easy to understand ([16 CFR Part 255](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255), [FTC FAQs](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)). They don't name a position. "Opens with #ad" is written as the brand guide's rule.
2. **Report point split.** Total net revenue is worth 2, not 1 as in the brief, so the step is 20 on every seed (the zero-order CPA is never scored).
3. **Zero-order channel.** Net revenue and ROAS are keyed as 0; CPA is unscored. A reviewer may prefer ROAS also left blank.
4. **Conversion rate = orders ÷ clicks.** Many teams use sessions or visitors instead. It's on the reporting rules card as Saltbox's definition.
5. **Pacing threshold (±5 points)** is Saltbox's rule; teams vary.
6. **The test plan is deliberately simple** (a fixed minimum sample and a minimum relative lift, no significance test). Whether statistics beyond this rule belong in an analyst-level sibling is open.
7. **Launch QA reasons.** A wrong `utm_campaign` and a missing one share the "Campaign tag" reason; a different parameter order is clean.
8. **Suppression.** "Email unsubscribes" ties to CAN-SPAM's opt-out rule; the other segments (refunds, wholesale, employees, chargebacks, do-not-market) are Saltbox's list. On non-email assets the trap segment is never "Email unsubscribes".
9. **Agency fee as a percent of media** is one common model (others bill retainers or hours only); here the SOW card holds both an hourly rate card (for the invoice) and the fee model (for the budget round). A reviewer may want one model only.
10. **A written results summary** to the manager would test communication but needs a human-reviewed step; whether that belongs in a later version is open.
11. **Values points.** Whether the 10 values points should count in the total, and whether companies can pick their own values calls, are open product questions.
12. **Leak guard.** Report figures and the lift are checked against every string on screen in the forms the leak tests read; the generator redraws the whole variant from the same seed when one collides.
13. Message senders are role lines ("Marketing manager", "Creator partner") because `from` isn't template-filled; bodies sign with seeded names.
