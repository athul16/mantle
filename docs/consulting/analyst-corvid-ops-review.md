# Business / operations analyst: Corvid Lane cost review

Status: **draft: practitioner review pending.** Version 1. Not on the publish allowlist (`src/lib/scenarios/publishable.ts`); it goes on after a practitioner review.

| | |
| --- | --- |
| Slug | `analyst-corvid-ops-review` v1 |
| Role family | `consulting` |
| Title | Corvid Lane: operations review analyst |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/analyst-corvid-ops-review.ts` |
| Tests | `tests/engine/analyst-corvid-ops-review.test.ts` |

## Setup

The candidate is a first-year analyst at Corvid Lane Advisory (fictional) on a cost review for a regional distributor. The steering committee meets at 4. Cast, all seeded names with fixed role lines: the engagement manager (sets the stakes in the first message), a senior consultant (owns the deck), the client's operations director and the client's finance analyst. A friend at another firm turns up once.

Seeded per attempt: the client and industry (grocery wholesale, auto parts, medical supplies, building materials; the volume unit follows: cases, cartons, units), the region, the client's fiscal year end (Jan, Mar, Jun or Sep), every person, site name and code, every number; which site carries which data trap; which slide carries which deck issue and in what order the slides sit; the overclaim version; the summary lines and their order; and where the right option sits in every choice. All companies and people are fictional.

Cards the candidate gets:

- **Engagement brief** (manager's first message): scope (one site closed mid-year and is out), benchmark = median cost per unit of in-scope sites, the saving rule, annualising part-year sites (× 12 ÷ months), and three one-time costs used again at the desk.
- **Data notes** (finance analyst, in the sheet): units of each column, the site that reports cost in $000s, the part-year and closed sites' months of data.
- **Corvid Lane standards**: every number on a slide has a source; titles state only what the data shows; periods and units labelled; client data stays in the engagement folder. These are Corvid Lane's own written policy, not an external rule.

## Sections and timing

| # | Section id | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- | --- |
| 1 | `s-rapid-a` | Rapid round: the numbers | 6 | `rapid-numbers` (15 × 20 s) | 10 |
| 2 | `s-work-1` | Site benchmark | 10 | `site-analysis` (`spreadsheet`) | 20 |
| 3 | `s-rapid-b` | Rapid round: does the data say that? | 6 | `rapid-evidence` (15 × 20 s) | 10 |
| 4 | `s-work-2` | Steering deck check | 10 | `deck-check` (`document_review`) | 20 |
| 5 | `s-rapid-c` | Rapid round: sense checks | 6 | `rapid-sense` (15 × 20 s) | 10 |
| 6 | `s-desk` | Steering pack desk (one screen at a time) | 12 | `summary-order` 150 s, `payback` 90 s, `net-saving` 90 s, five `values-*` 78 s each | 8 + 6 + 6 + 10 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds, worth 1; the other ten ½. Each section's brief arrives when it opens; the site correction and the pulled slide arrive at minute 4 of their sections.

## Rapid round A: the numbers (10)

| Kind | Tier | Rule | Wrong options |
| --- | --- | --- | --- |
| Percent change | ½ | (new − old) ÷ old | base swapped (÷ new), sign flipped, new ÷ old |
| Gross margin | ½ | (revenue − COGS) ÷ revenue | markup (÷ COGS), operating margin, COGS ÷ revenue |
| Share of total | ½ | part ÷ total | ÷ the rest, another site's share, ÷ the largest other |
| Unit cost | ½ | fixed ÷ volume + variable | fixed only, variable only, fixed spread over a year |
| Break-even volume | ½ | one-time cost ÷ (saving − running cost) per unit | ÷ saving, ÷ running cost, ÷ (saving + running) |
| Percent of a percent | 1 | a% × b% | b% alone, a% × (1 − b%), decimal slip |
| Weighted average of two sites | 1 | Σ cost × volume ÷ Σ volume | simple average, swapped weights, the bigger site's figure |
| Mix effect | 1 | this year's revenue-weighted margin (both segments rise, total falls) | last year's total, simple average, last year's mix |
| Compound growth, 3 years | 1 | V × (1 + g)³ | 1 + 3g, two years, four years |

## Section 2: site benchmark (20)

Nine rows from the client's extract (eight sites, one listed twice), seeded order: code, site, months of data, volume, labour hours, operating cost. For each in-scope site, on its first row: cost per unit to the cent and units per labour hour to two decimals (1 point each, 14 cells, tolerance 0.01); the benchmark (2, tolerance 0.01); the annual saving (4, tolerance $500). Cost per unit is a whole number of cents on every seed, so there is no rounding argument.

| Trap | Expected handling | What it costs if missed |
| --- | --- | --- |
| Part-year site (5–9 months) | annualise its volume for the saving | saving (4) |
| Site reporting cost in $000s | × 1,000 before dividing | its cost cell, benchmark, saving (7) |
| Duplicated row | count once | benchmark and saving (6) |
| Closed site (4–8 months, out of scope) | exclude | benchmark and saving (6) |
| Mid-task correction (minute 4): one site's labour hours double-counted agency hours | use the corrected hours | its units per labour hour (1) |

The generator guarantees each trap bites: the part-year, $000s and duplicated sites sit above the benchmark, and each wrong handling moves the benchmark by at least 1.5 cents and the saving by at least five times the tolerance. The duplicate's second row and the closed site's row are not keyed (their inputs are scratch).

## Rapid round B: does the data say that? (10)

A draft slide line and a small exhibit; three options (Supported / Not supported: the data can't show it / Contradicted: the data shows otherwise), seeded order. Corvid Lane's evidence card is in the round intro.

Easy: who has the highest cost per unit; a quarter's total; a year-on-year rise; a claim about something the exhibit doesn't show (cost from a volume table, next year from this year's); all sites met a fill-rate target. Each of these (except not-shown) is supported or contradicted on the seed. Hard: correlation shown as cause (vs the plain correlation claim), error rates from counts with different bases (more errors but a lower rate), a trend from two points (vs the plain two-point change), a subgroup result that reverses the total (Simpson's paradox).

## Section 4: steering deck check (20)

Twelve slides (agenda first, the rest in seeded order): slide, title, figure cited, period, unit, source. The header holds the data appendix A1–A8, the client's fiscal year and the Corvid Lane standard.

| Finding | Points | Expected flag |
| --- | --- | --- |
| Figure doesn't match the appendix ($M off by 0.3–0.9 beyond the rounding rule, on the cost or the saving slide) | 3 | That slide, "Figure doesn't match the appendix" |
| Title claims more than the data shows (overtime "drives" cost from a correlation, or cost "falls every year" from two years) | 3 | "Title claims more than the data shows" |
| Shares that total 106–110 or 91–94 (one share mis-copied) | 3 | "Shares don't add to 100" (the mismatch reason also accepted) |
| A fiscal-year figure labelled as a calendar year in a comparison (CY vs FY) | 3 | "Fiscal and calendar years mixed" |
| Overtime in $000s labelled $M | 3 | "Wrong unit" |
| A figure with no source | 3 | "Figure has no source" |
| Decision: send the list to the senior before the deck goes anywhere | 2 | |

Clean look-alikes on every seed: the other $M slide, rounded correctly; the other shares slide, whose rounded shares total 99 or 101 (allowed by the standard); agency labour correctly in $000s; the agenda slide with no figure and no source; the plain correlation slide. Mid-task (minute 4) the senior pulls the closed site's slide, which has no source: flagging it is a false flag. Wrong decisions: fix the numbers quietly; send the deck to the client contact who asked for a preview; leave it for the manager's review. False flags cost 1 each, floored at 0.

## Rapid round C: sense checks (10)

Pick the figure the inputs give, to two significant figures. Easy (the wrong options are 10× or 100× off): annual labour cost from FTE × loaded cost, rent from area × rate, cost per unit, annual saving, damage rate. Hard (the wrong options are the specific slips): per day from annual volume over stated operating days (vs 365, 52, 12); per year from a daily cost (vs 365 days, × trucks, × 52); storage per unit from per pallet (vs per pallet, × units, ÷ 12); a $000s report (vs read as dollars, as millions, × 100); FTE from hours at 2,080 (vs ÷ 40, ÷ 8, ÷ 365).

## Section 6: steering pack desk (30)

| Step | Points | Expected answer |
| --- | --- | --- |
| `summary-order` (ordering) | 8 (position 3, pairwise 5) | answer, the three findings from largest saving to smallest, risk, ask, next steps (the standard is in the prompt and the manager's message). The findings sum to the headline |
| `payback` (numeric, months) | 6 | one-time costs (sum of the three in the morning's brief) ÷ (run-rate ÷ 12), one decimal; full within 0.05, half within 0.3 |
| `net-saving` (numeric, $) | 6 | 0.5 S + S + S − one-time costs (half the run-rate in year one); tolerance $1,000. Ignoring the ramp costs all 6 |

The one-time costs come only from the engagement brief in section 2: the continuity fact. The run-rate is appendix A4 in dollars.

### Values calls (2 each)

| Step | Tag | Situation | Right | Wrong options (shortcut / people-pleasing / over-escalation) |
| --- | --- | --- | --- | --- |
| `values-integrity` | integrity | The manager wants "about $5M" on the title; the model says $4.3M (both seeded). Pressure from a superior | Keep the model's figure; offer the upside as a separate, labelled case (standard: titles state only what the data shows) | "Up to $5M" hedge / put $5M as asked / report the manager to the partner first |
| `values-candor` | candor | The client's analyst finds two swapped digits in the table the candidate sent yesterday | Check the source, send a corrected table today saying what changed, tell the manager | Fix your copy quietly / blame the client's extract / stop everything for a full re-check |
| `values-client-care` | client-care | A friend at another firm asks which sites the client is closing | Decline (client data stays in the engagement) and tell the manager someone asked | Share only the rumours / hint at the region / forward it to the client |
| `values-in-lane` | in-lane | The client's operations director asks whether the team will recommend layoffs | Recommendations come from the manager at steering; pass the question on today | Share the model's headcount / reassure "no layoffs" / ask the manager to stop the director contacting you |
| `values-teamwork` | teamwork | The senior's slide overstates a saving; they present in thirty minutes | Tell the senior now, privately, with the corrected figure | Fix the shared file silently / leave it / reply-all pointing out the error |

## Scoring table

| Step | Points |
| --- | --- |
| Rapid round A: the numbers | 10 |
| Site benchmark | 20 |
| Rapid round B: does the data say that? | 10 |
| Steering deck check | 20 |
| Rapid round C: sense checks | 10 |
| Executive summary order | 8 |
| Payback | 6 |
| Three-year net saving | 6 |
| Five values calls | 10 |
| **Total** | **100** |

## What the tests prove

Over 200 seeds: every task is solved from the rendered material with the tests' own reading of the rules (spreadsheet traps, deck checks, rapid exhibits, summary order, payback) and compared with the server key; a perfect attempt scores 100, a blank 0, the maximum is 100 on every seed; each deck issue costs exactly 3 (1.5 with the wrong reason), each look-alike or the pulled slide 1 as a false flag, a wrong decision 2; each site trap costs exactly its points (1, 4, 6, 6, 7); ignoring the ramp or computing payback in years costs all 6; each tempting values option costs 2; each rapid item has exactly one right option and the harder kinds sit in the 1-point slots; another seed's perfect answers average under 40; no key note or computed number appears in the candidate payload or in any rapid item; sections validate, desk screens sum to 720 s, every message points at a real step.

## Sources for the definitions used

No statute applies. Definitions are the standard textbook ones: percent change, gross margin vs markup, weighted (volume-weighted) average, compound growth V(1 + g)ⁿ, simple payback period = one-time investment ÷ periodic saving, break-even volume = fixed cost ÷ contribution per unit, and the median. 2,080 hours a year (40 × 52) is the common US full-time-equivalent convention and is stated on the exhibit. The slide standards, rounding rule and confidentiality rule are Corvid Lane's written policy, shown to the candidate.

## Judgment calls for review

1. **A calculator is assumed** (the intro says so). Without one, the weighted average, mix effect and compound growth items are not doable in 20 seconds; the sense-check round stays fair by design. Decide whether to keep it.
2. **Consulting frame vs in-house.** Corporate strategy-and-operations buyers might prefer an in-house sibling (internal ops analyst, no client); the tasks would carry over with the client cast renamed.
3. **Should values points count in the total, and can companies choose their own values?** Open product questions; here they count (10 of 100).
4. **The duplicated row and the closed row are unkeyed.** The prompt says to fill each site once on its first row; a candidate who fills only the duplicate's second row loses that site's two cells.
5. **Annualising a part-year site by × 12 ÷ months** is the firm's simple brief rule; a practitioner might want seasonality or ramp-up considered. It is stated on the brief, so it's not judged as knowledge.
6. **Mismatched shares accept two reasons** (shares, figure mismatch) because the mis-copied share is both.
7. **Evidence round has three options**, not four: Supported / Not supported / Contradicted. "Not supported" for a two-point trend and for correlation-as-cause follows the evidence card in the intro.
8. **Payback partial credit** (half within 0.3 months) covers using the rounded $M run-rate; confirm the width.
9. **Leak guard.** The shared DOM leak test reads key numbers in several forms; a cost per unit or payback can collide with a figure elsewhere by chance, and the generator redraws the whole variant deterministically from the same seed when it would. The ordering view's drag-handle SVG renders 5.5 and 10.5 on every screen, so those count as shown text too.
10. Message senders are role lines because message `from` fields aren't template-filled; bodies sign with the seeded names.
