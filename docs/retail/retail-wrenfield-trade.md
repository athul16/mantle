# Assistant buyer: Wrenfield & Co. trade Monday

Status: **draft: practitioner review pending.** Version 1. Not published; it goes on the publish allowlist only after someone who does the job has reviewed it.

| | |
| --- | --- |
| Slug | `retail-wrenfield-trade` v1 |
| Role family | `retail` |
| Title | Wrenfield & Co.: assistant buyer |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/retail-wrenfield-trade.ts` |
| Shared helpers | Name pools and date helpers from `src/lib/engine/scenarios/legal/` (imported, not moved) |
| Tests | `tests/engine/retail-wrenfield-trade.test.ts` |

## Setup

The candidate is an assistant buyer on Wrenfield & Co.'s trainee scheme (a fictional US retailer). It is a Monday in spring 2027: trade meeting at 11, and the autumn range is on the water. The cast, each with a fixed role line and a seeded name:

| Role line | Voice | Sends |
| --- | --- | --- |
| Your buyer | Brisk, sets the stakes | The opening brief, the PO check, the pricing round, the critical path |
| Merchandiser | Precise about numbers and rules | The trade report, the action card, open-to-buy, the candor call |
| Store operations lead | Practical | The stock adjustment at minute 4 of the trade report |
| Supplier account manager | Friendly, pushy | The certificate update, hospitality, the cost increase, shipping without a certificate |
| Account manager, another supplier | Persuasive | The competitor's-quote call |

Seeded per attempt: the department (homeware, outdoor clothing, toys, small electricals or stationery) and its 30 lines; every name, supplier, store and date; every unit count, cost and price; the trading-card average rule (last 3 or 4 weeks); the action card thresholds (markdown weeks 4 to 6, markdown sell-through 35 to 50%, safety weeks 1 to 3); which trade report line carries which trap; which PO carries which problem and the PO order; the open-to-buy plan and which month holds the cancelled order; which critical-path step sits on which item id; the gift limit and ticket value; and where every right option sits. Prices are tax-exclusive throughout.

## Sections and timing

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | `s-rapid-a` Rapid round: retail maths | 6 | `rapid-retail-math` (15 × 20 s) | 10 |
| 2 | `s-work-1` Trade report | 10 | `trade-report` (`spreadsheet`, 12 lines) | 20 |
| 3 | `s-rapid-b` Rapid round: line actions | 6 | `rapid-actions` (15 × 20 s) | 10 |
| 4 | `s-work-2` Purchase order check | 10 | `po-check` (`document_review`, 12 POs) | 20 |
| 5 | `s-rapid-c` Rapid round: pricing and promotions | 6 | `rapid-pricing` (15 × 20 s) | 10 |
| 6 | `s-desk` Desk and inbox (one screen at a time) | 12 | `open-to-buy` 240 s, `critical-path` 150 s, five values calls 66 s each | 12 + 8 + 10 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds and worth 1 point; the other ten are worth ½. Every item is a choice of four with fixed option ids (a to d) and seeded labels. The rapid round intro isn't on screen while an item is open, so every exhibit carries the card rule it needs.

Messages: each section's brief arrives when the section opens; two mid-task messages arrive at minute 4 of their section (the stock adjustment in the trade report, the certificate update in the PO check).

Continuity: the PO whose certificate is missing in the PO check is the line in the critical-path task and the shipment in the quality call; the launch and latest-DC dates run through the brief, the PO check, the critical path and the quality call.

## Rapid round A: retail maths (10)

| Kind | Tier | Exhibit | Rule on the card | Wrong options |
| --- | --- | --- | --- | --- |
| Margin % | ½ | Cost, selling price | (price − cost) ÷ price | Markup given for margin; cost as % of price; ±4 points |
| Markup % | ½ | Cost, selling price | (price − cost) ÷ cost | Margin given for markup; price ÷ cost; ±10 points |
| Price for a target margin | ½ | Cost, target margin | cost ÷ (1 − margin) | cost × (1 + margin) (markup confusion); cost ÷ margin; ±$1 |
| Sell-through % | ½ | Received, sold (net), sent to outlet, on hand | sold ÷ (sold + on hand) | Sold ÷ received (on received); sold ÷ on hand; on hand ÷ (sold + on hand) |
| Weeks of cover | ½ | On hand, units sold over the last N weeks | on hand ÷ (units ÷ N) | Inverted; forgot to divide by N; ±1 week |
| Promotion margin with supplier funding | 1 | Regular and promo price, cost, funding per unit | (promo − (cost − funding)) ÷ promo | Funding ignored; regular price used; funding added to price |
| Cover on a trend | 1 | On hand, six weeks of weekly units | Average of the last N weeks (seeded 3 or 4) | Average of all six weeks; last week only; first N weeks |
| Markdown to a price point | 1 | Original price, current ticket (already marked down), target price | (current − target) ÷ current | Off the original price; divided by the target; original-price % less the first markdown |

## Section 2: trade report (20)

Twelve lines, season to date (weeks 1 to 8): line, on sale from (week), received, units sold, customer returns, on hand, cost, price. The trading card is in the prompt: units sold are net of returns and returned units are already in on hand; sell-through = sold ÷ (sold + on hand); weeks on sale count the launch week; average weekly = sold ÷ weeks on sale; cover = on hand ÷ average weekly; margin at the prices actually charged. On every line on hand = received − units sold + returns, so the sheet ties.

Inputs: sell-through % (two decimals, tolerance 0.011) and weeks of cover (one decimal, tolerance 0.06 against a two-decimal key) on eight fixed rows, 1 point each; department margin % and department sell-through % over all twelve lines, 2 points each.

| Trap | Where | Expected | Cost if missed |
| --- | --- | --- | --- |
| Customer returns | 3 to 5 rows with boxes, plus some without | Use units sold less returns | 2 per affected line (sell-through and cover); also moves department sell-through |
| Mid-period launch | 1 row with boxes (sometimes one more without) on sale from wk 4 to 6 | Weeks on sale = 9 − launch week | 1 (cover only) |
| Promotion note | 1 line, any row | That line's promo units at the promo price in department sales | 2 (department margin) |
| Stock adjustment (store operations, minute 4) | 1 row with boxes | Take the written-off units off on hand | 4 (that line's sell-through and cover, department sell-through) |

The generator redraws until each trap moves its answers well past the tolerance, so each trap costs exactly its points.

## Rapid round B: line actions (10)

Exhibit: weeks on sale, sell-through, cover on hand, on order (none; N weeks of stock shipped; N weeks not yet shipped), supplier lead time and the action card. Card (seeded thresholds), checked in order:

1. Mark down when on sale at least W weeks and sell-through is below M%; if the line also has an order that hasn't shipped, cancel the open order instead.
2. Reorder when cover including stock on order is below lead time + S weeks.
3. Otherwise hold.

Easy (½): three reorders (cover under 4 weeks), three markdowns, two holds, two cancels. Hard (1): lead time longer than cover (cover looks healthy at 4+ weeks but is below the lead time: reorder); sell-through exactly at the threshold (not below: hold); one week short of the markdown age (hold); a best seller with an order on the water that covers the gap (hold); a markdown line whose order has already shipped (mark down, can't cancel). Wrong options are the other three actions.

## Section 4: autumn POs vs. supplier confirmations (20)

Twelve POs in PO-number order: PO, supplier, line, product type, ordered, confirmed, carton, agreed cost, confirmed cost, delivery to DC, test certificate. Header: launch date, latest DC date ("delivery on that date is on time"), supplier terms §4 (cost must match; up to $0.01 a unit of currency rounding accepted), §5 (quantity must match; whole cartons), and the compliance card for the department's four product types.

| Finding (3 each) | Reason | Rule |
| --- | --- | --- |
| Confirmed cost differs (by 6 to 75 cents) | cost | Terms §4 |
| Confirmed quantity short by whole cartons | qty | Terms §5 |
| DC delivery 1 to 9 days after the latest date | late | Critical path |
| Ordered quantity not a multiple of the carton | carton | Terms §5 |
| Certificate not received for a type that needs a test | cert | Compliance card |
| The same order raised twice (all cells equal but the PO number) | duplicate | Either row is accepted; flagging both isn't a false flag |

Clean look-alikes on every seed: delivery exactly on the latest date; a one-cent cost difference; "Not received" on the type that needs no test; a certificate the supplier reports at minute 4 as now on file; and a split order (same line and supplier as another PO, different quantity and date). False flags cost 1, floored at 0.

Decision (2): query the supplier in writing on every flagged PO and send the buyer the lines that threaten launch. Wrong: approve and sort it out at the DC; cancel every PO with a problem; phone the suppliers and agree new terms on the call (outside the assistant's authority; the buyer's brief says not to agree changes).

## Rapid round C: pricing and promotions (10)

| Kind | Tier | Rule | Wrong options |
| --- | --- | --- | --- |
| Margin after a markdown | ½ | (marked-down price − cost) ÷ marked-down price | Old margin less the markdown points; divided by the old price; markup |
| Units to keep cash margin | ½ | units × (old price − cost) ÷ (new price − cost), rounded up | Revenue-based (units × old ÷ new); units × (1 + markdown); other slips |
| Multibuy vs. percent off | ½ | Compare the saving on three units ("3 for 2" or "3 for $Y" against X% off) | The other deal; "same"; "depends on cost" |
| Price ladder | ½ | Highest ladder price at or below the marked-down price | Next ladder price up; the raw marked-down price; the one below |
| Funded margin % | 1 | Net cost = cost − supplier's share × (ticket − promo) | No funding; shares swapped; supplier funds all; share taken of the promo price |
| Funded cash margin | 1 | promo − net cost per unit | No funding; swapped; full funding |
| Funded units to keep cash margin | 1 | units × (ticket − cost) ÷ (promo − net cost), rounded up | No funding; swapped; revenue-based; full funding |

Funding shares exclude 50% so "swapped" is always a different answer.

## Section 6: desk (30)

### Open-to-buy (12, 240 s)

Sep, Oct and Nov with planned sales, planned markdowns, planned closing stock, opening stock (each month opens at the previous month's planned closing) and on order, in whole dollars at retail. Card: open-to-buy = planned sales + planned markdowns + planned closing stock − opening stock − on order. The merchandiser's email says one month's on-order figure still includes an order cancelled on Friday. Inputs: each month's open-to-buy (3 each) and the quarter (3; the sum of the months). Negative means over-bought and does happen on some seeds. Leaving the cancelled order in costs 6.

### Critical path (8, 150 s)

Eight steps for the PO with the missing certificate, shown in a seeded order: approve the design sample → raise the PO at the agreed cost → approve the pre-production sample → bulk production → compliance test on production units (the card's test for that type) with the certificate on file → ship from the factory → delivered to the DC (latest date) → on shelf for launch. Pairwise 5, position 3. Swapping testing and shipping costs about 1; the reverse order costs all 8.

### Values calls (2 each, 66 s each)

Each has four options with ids a to d, order seeded. The wrong options are the helpful shortcut, the people-pleasing yes and the over-escalation.

| Step | Tag | Situation | Right option | Rule |
| --- | --- | --- | --- | --- |
| `values-integrity` | integrity | Account manager offers event tickets worth more than the gift limit the week before the range review; the buyer is invited too | Decline politely citing the policy, and log the offer | The quoted gifts and hospitality policy: nothing during a live negotiation or range review; limit seeded |
| `values-candor` | candor | The merchandiser finds a PO the candidate keyed with a zero too many (the keying log has their login) | Thank them, tell the buyer now, get the PO amended in writing before the supplier confirms | Own the mistake; fix it before it becomes a commitment |
| `values-client-care` | client-care | Another supplier asks what the current supplier quoted | Say quotes are confidential and ask for their own best price | The quoted supplier terms §9 |
| `values-in-lane` | in-lane | The supplier wants a cost increase agreed on a call today; the buyer is out | Don't agree; ask for it in writing and pass it to the buyer | The quoted supplier terms §4: cost changes only in writing, approved by the buyer |
| `values-quality` | quality | The buyer is flying; the supplier wants to ship the uncertified PO to make the DC date, quoting the buyer's "non-negotiable" launch | Hold the shipment until the certificate is on file; tell the supplier in writing and the buyer today | The compliance card: no shipment of a type that needs a test until its certificate is on file |

## Scoring table

| Step | Points |
| --- | --- |
| Rapid round A: retail maths | 10 |
| Trade report | 20 |
| Rapid round B: line actions | 10 |
| PO check | 20 |
| Rapid round C: pricing and promotions | 10 |
| Open-to-buy | 12 |
| Critical path | 8 |
| Five values calls | 10 |
| **Total** | **100** |

What the tests prove (200 seeds): every task is solved from the rendered material with the tests' own reading of the cards and compared with the server key; a perfect attempt scores 100 and a blank 0, with a maximum of 100 on every seed; each planted trap costs exactly its points (half for the right PO with the wrong reason; 1 per false flag on each look-alike); every rapid item has exactly one right option and each round totals 10, with the hard kinds on items 3, 6, 9, 12 and 15; another seed's perfect answers average under 40; no key note or computed spreadsheet number reaches the candidate's payload; sections validate and the desk's screens add up to 12 minutes; every message points at a real step; each values call has one right option whose position varies across seeds; the scenario is registered.

## Sources

- Retail maths (margin, markup, sell-through, weeks of supply/cover, markdown %, open-to-buy = planned sales + planned markdowns + planned end-of-month stock − beginning-of-month stock − on order): standard merchandising texts, e.g. Clodfelter, *Retail Buying: From Basics to Fashion* (Fairchild), and Levy & Weitz, *Retailing Management* (McGraw-Hill). Where practice varies (which average for cover, whether returns are netted, thresholds), the scenario states Wrenfield's own card.
- Toys: ASTM F963 is mandatory for children's toys (16 CFR part 1250); children's products need third-party testing at a CPSC-accepted lab (16 CFR part 1107) and a Children's Product Certificate (16 CFR part 1110).
- Children's upper outerwear drawstrings: 16 CFR 1120.3(b). Lead content and lead in paint for children's products: CPSIA §101 and 16 CFR part 1303.
- Clothing flammability: 16 CFR part 1610.
- Art materials: LHAMA, ASTM D4236 labeling (16 CFR 1500.14(b)(8)).
- Radio devices: FCC rules, 47 CFR part 15.
- Ceramicware: FDA Compliance Policy Guides on lead (Sec. 545.450) and cadmium (Sec. 545.400) in ceramicware.
- Electrical safety listing by a nationally recognized testing laboratory: OSHA's NRTL program; for consumer kettles and toasters it is a retailer requirement rather than a federal one, so it is Wrenfield's policy here.

What was simplified: each product type has one test on the card; certificates are "on file" or not; adult apparel under 16 CFR 1610 can be exempt by fabric, and kids' clothing also falls under 1610, but the card lists one requirement per type; testing is on production units by Wrenfield policy (practice varies between pre-production and production samples).

## Judgment calls for review

1. **Sales tax and VAT are left out**; margins are on tax-exclusive prices and the intro says so.
2. **"Weeks of cover" vs "weeks of supply".** US retailers often say weeks of supply; the card says weeks of cover. Worth a practitioner's word on which a US trainee expects.
3. **Average weekly units.** The trade report uses sold ÷ weeks on sale; rapid items with a weekly history use the card's "last 3 or 4 weeks". Both are stated on screen; a practitioner may prefer one rule.
4. **Returns netting.** The card says units sold are net of returns and that returns are already back in on hand. Some systems report sell-through on gross sales; this is Wrenfield's rule.
5. **Department margin uses net units at the prices charged**, including the promotion units, with cost of sales at unit cost. No markdown accounting, shrink or supplier funding in the trade report.
6. **Open-to-buy at retail value** with whole-dollar plans; the quarter is the sum of the months, which equals the quarter formula because each month opens at the previous month's planned close.
7. **The action card's order** (markdown check first, cancel only an unshipped order, reorder on cover including on order vs lead time + safety) is a plausible firm policy, not a standard; thresholds are seeded.
8. **Duplicate POs**: either row is accepted. A practitioner might expect the later PO only.
9. **The supplier's certificate update (minute 4)** turns one "Not received" row clean; a candidate who flagged it before reading must unflag it.
10. **Compliance card entries are simplified** (see Sources); the NRTL listing for small electricals is a retailer policy.
11. **Open product questions**: whether values points should count in the total, and whether companies can pick their own values.
12. **Next build**: whether a merchandise-planner sibling (allocation, size curves) should follow this one.
13. **US intake sizes** for retail trainee schemes weren't confirmed (`15-next-industries.md`); the evidence for the role is UK-heavy, and the scenario is US (dollars, CFR rules).
