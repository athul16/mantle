# eDiscovery document reviewer: `ediscovery-larch-review` v1

**Status: draft: team self-review pending.** Not published (`pnpm scenarios:publish` has not been run for it).

Code: `src/lib/engine/scenarios/ediscovery-larch-review.ts`. Tests: `tests/engine/ediscovery-larch-review.test.ts` (solve every task from the rendered material over 200 seeds and compare with the server key).

## Setup

The candidate is a contract document reviewer at Hale & Corwin LLP, which represents Larchmont Polymers, Inc. in *Brightwater Mills, Inc. v. Larchmont Polymers, Inc.*, U.S. District Court for the District of Wexford. The review is "Project Larch". All people, companies, the court and the case are fictional.

Title "Project Larch review batch", role family `legal`, 50 minutes, 100 points, all scored automatically (no written replies, so nothing waits for a reviewer).

**The review protocol** is the first inbox message (`m1`). It arrives at minute 0 and stays in the inbox for the whole attempt; every answer follows from it. Seeded per candidate:

| Protocol item | Seeded |
| --- | --- |
| Review period | Start in 2023, 420 to 640 days long, both days included |
| Larchmont's lawyers | Two Hale & Corwin LLP lawyers and one in-house Associate General Counsel ("Larchmont Legal") |
| Issue tags | Four of six: "Resin quality and off-spec batches" always, plus three of pricing/surcharge, supply agreement termination, late deliveries, plant inspection, insurance coverage. Tag order shuffled |
| Key custodians | Four names with job titles |
| Review manager | Name (signs every message; the hot-document escalation contact) |
| Foreign-language queue | One of four queue names |

Fixed rules in the protocol: responsive = in the period **and** about a tag; not responsive gets "No tag"; privilege = attorney-client communication for legal advice with nobody outside Larchmont and its lawyers, or work product prepared at counsel's request for the litigation (even with no lawyer on it); a lawyer merely copied on a business email is not privilege; hot = deleting or not keeping documents, or knowing resin was off-spec before it shipped; foreign-language documents go to the queue uncoded; search strings must find every relevant sample document with the fewest hits; privilege log entry rules; redact partial privilege, withhold only when all of it is privileged.

People in documents are shown as "Name (Organisation)", so a lawyer is recognisable by organisation as well as by the protocol's list.

## Sections and timing

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | Protocol and QC review | 14 | `qc-review` (document_review, 20 rows) | 18 |
| 2 | Coding round 1 | 6 | `rapid-1` (rapid_round, 15 × 20 s) | 15 |
| 3 | Search terms and privilege log (one screen at a time) | 10 | `search-terms` (multiple_choice, 150 s), `review-estimate` (spreadsheet, 150 s), `priv-log` (document_review, 300 s) | 4 + 4 + 15 |
| 4 | Coding round 2 | 6 | `rapid-2` | 15 |
| 5 | Review inbox (one screen at a time) | 8 | `hot-doc` (150 s), `foreign-doc` (150 s), `partial-priv` (180 s), all multiple_choice | 5 + 4 + 5 |
| 6 | Coding round 3 | 6 | `rapid-3` | 15 |
| | **Total** | **50** | | **100** |

## Coding rounds (3 × 15 points)

Each item is one document: Date, From, To, Cc, Subject as the exhibit, the text as the prompt. Three choice fields, a third of the item each: Responsive / Not responsive; Privileged / Not privileged; issue tag (the four protocol tags in protocol order, then "No tag"). Option ids are fixed (`yes`/`no`, `t1`–`t4`/`none`), so an id says nothing about the answer.

Slots 3, 6, 9, 12, 15 are the traps (1.5 points each, one of each kind per round, shuffled among those slots); the other ten are worth 0.75 (four plain responsive, three not responsive, three privileged). 10 × 0.75 + 5 × 1.5 = 15.

| Item kind | Expected coding | Rule | Naive answer costs |
| --- | --- | --- | --- |
| Responsive (easy) | R, not P, its tag | In period, about a tag, no lawyer | |
| Not responsive (easy) | Not R, not P, No tag | Office chatter, or a business topic that isn't one of this candidate's four tags | |
| Privileged (easy) | R, P, its tag | Larchmont person ↔ listed lawyer, asking for or giving advice, nobody else | |
| **Out of period** (trap) | Not R, not P, No tag | Dated 2–25 days before the start or after the end; on topic | Coded on content (R + tag): 1.0 |
| **Boundary date** (trap) | R, not P, its tag | Dated exactly on the first or last day: both days included | Coded not responsive: 1.0 |
| **Third party copied** (trap) | R, **not P**, its tag | Request for legal advice with a consultant/vendor on Cc: not privileged | Coded privileged: 0.5 |
| **Lawyer only copied** (trap) | R, **not P**, its tag | Business email with a lawyer on Cc, no advice asked: not privileged | Coded privileged: 0.5 |
| **Work product** (trap) | R, **P**, its tag | Memo "prepared at the request of [lawyer] for the Brightwater litigation", no lawyer on it | Coded not privileged: 0.5 |

## QC review (18 points)

A teammate's first-pass coding of 20 documents (same document generator as the rounds; extra column "Hot"). Six miscodes, 3 points each (full for the right row and reason, 1.5 for the right row with another reason); 1 point off per false flag (capped so the step never goes below 0). Rows shuffled per seed.

| Miscode | Teammate coded | Expected flag (reason) |
| --- | --- | --- |
| Out-of-period document | Responsive, with its topic tag | "Dated outside the review period" |
| Document on a topic that isn't a tag this time | Responsive, with some tag | "Not about a protocol issue" |
| Request for advice with a third party copied | Privileged | "Wrong privilege call" |
| Request for / giving of advice, lawyer and Larchmont only | Not privileged | "Wrong privilege call" |
| Hot document (deleting test sheets / knew it was off-spec) | Hot = No | "Hot document not marked Hot" |
| Responsive document | Another tag | "Wrong issue tag" |

Correctly coded decoys (flagging one costs 1): a boundary-date document coded responsive, an out-of-period document coded not responsive, a lawyer-only-copied email coded not privileged, a work-product memo coded privileged, a second hot document coded Hot, a third-party-copied request coded not privileged, plus plain responsive, privileged and non-responsive rows.

## Search string (4 points)

Single choice among four strings for one of the candidate's tags, each with its hits in the validation sample and how many of the sample's relevant documents it finds. Seeded: the topic, sample size, relevant count (40–90) and every hit count. Kinds (shuffled into options a–d):

- **Right:** `(term* OR "phrase") w/15 context`: every relevant document, a few extra hits.
- Too broad: adds a broad wildcard: every relevant document, 3–6× the hits.
- Too narrow: the phrase alone near the context: fewest-but-one hits, misses 6–15.
- Wrong connector: `term* AND "phrase"`: misses 16–30.

Rule (protocol 8): every relevant document, then fewest hits. The trap is the narrow strings, which have fewer hits than the right one.

## Review estimate (4 points)

A two-input sheet: validation sample, hits for the agreed string (another of the candidate's tags), full collection, review rate (40–60 docs/hour). Inputs: projected documents to review = hits ÷ sample × collection (whole number; the collection is a whole multiple of the sample, so it's exact; tolerance 0.5), 2 points; reviewer hours = projected ÷ rate to one decimal (tolerance 0.05), 2 points. A candidate who divides the sample hits by the rate loses the hours points.

## Privilege log (15 points)

Eight draft entries (Entry, Doc ID, Date, Type, Author, Recipients, Basis, Description; lawyers marked `*`, footnote explains). Five flawed, 3 points each; 1 point off per false flag. Order shuffled.

| Flaw | Expected reason | Rule |
| --- | --- | --- |
| Author or recipients blank ("—") | "Author or recipients missing" | Each entry needs the author and every recipient |
| Description "Email." / "Correspondence." / "Document." / "Email re: legal matters." | "Description too vague to support the claim" | Must say what the document is about |
| "Email from counsel advising that …" | "Description reveals the legal advice" | Say what it's about without revealing the advice |
| Attorney-client claimed, no lawyer as author or recipient, business description | "No lawyer on it: the basis doesn't fit" | |
| Recipients include a consultant/vendor | "Third party on it: not privileged, produce it" | A document with a third party isn't privileged: produce, don't log |

Right entries: a request for advice to a lawyer (attorney-client), advice from a lawyer (attorney-client), and a memo prepared at counsel's request for the litigation logged as work product with a non-lawyer author.

## Review inbox (14 points)

- **Hot document (5):** a custodian email that meets the hot rule (deleting test sheets, throwing out retain samples and the lab log, or "we knew batch N was off-spec before it shipped"; whichever of the three the QC rows didn't use). Right: "Code it Hot and email [review manager] the doc ID right away; don't discuss it with anyone else". Wrong: email the custodian who wrote it to ask what they meant; carry on and leave it to the weekly QC report; forward it to the whole review team. Options shuffled per seed.
- **Foreign-language document (4):** a short Spanish, German, French or Portuguese email. Right: tag it Foreign language and route it to the protocol's queue without coding it. Wrong: the same with another queue's name; code it Not responsive because nobody can read it; paste it into a free online translator (confidentiality) and code from that.
- **Partial privilege (5):** a two-message chain, the older message being a lawyer's advice to a custodian. Seeded case, one of three:
  - the custodian forwards the advice to a colleague with a business note → **produce with the privileged message redacted and log the redaction**;
  - the custodian replies to the lawyer asking for more advice → **withhold the whole document and log it**;
  - the custodian forwards the advice to a consultant/vendor → **produce it in full** (privilege waived).

## Scoring summary

| Step | Points |
| --- | --- |
| `qc-review` | 18 (6 × 3) |
| `rapid-1`, `rapid-2`, `rapid-3` | 15 each (10 × 0.75 + 5 × 1.5) |
| `search-terms` | 4 |
| `review-estimate` | 4 (2 + 2) |
| `priv-log` | 15 (5 × 3) |
| `hot-doc` | 5 |
| `foreign-doc` | 4 |
| `partial-priv` | 5 |
| **Total** | **100** |

Blank scores 0 and a perfect attempt 100 for every tested seed; each planted trap costs exactly its points (tested).

## Judgment calls (for review)

1. **QC first, not a coding round first.** The plan lists R1 first, but rounds start their first item the moment the section opens, so a candidate would code at 20 s an item before reading the protocol. The 14-minute QC section comes first and doubles as the protocol read. Rapid rounds are sections 2, 4 and 6.
2. **Rounds are worth 15, not 10.** Three fields per item don't split 0.5-point items evenly; 0.75 / 1.5 split into exact quarters. Coding is the core of the job, so 45 of 100 points are coding rounds.
3. **The protocol is an inbox message, not repeated on each item.** Real review platforms keep it in a side panel; here the inbox is always open. Lawyers are identifiable by organisation in every From/To/Cc line, so a 20-second item needs only the period and the four tags from memory.
4. **A review estimate step was added** (spreadsheet, 4 points) to the search section. Besides being real work (projecting review volume from a sample), it gives the scenario numeric key values, which the shared `no-key-in-dom` test requires (it expects derived key numbers to check). Paid for by trimming the search string to 4 and the inbox items to 5/4/5.
5. **"No tag" for non-responsive documents.** The protocol says only responsive documents are tagged, so the out-of-period trap costs two fields (responsiveness and tag). That's deliberate: tagging an out-of-period document is the downstream error teams actually see.
6. **Hot documents are coded in the QC and inbox only,** not as a fourth rapid field, to keep rapid items to the three fields the plan names. Hot documents are always about resin quality, which is always a tag, so a hot document is always responsive.
7. **Privilege rule simplified for testability:** "legal advice" is recognisable from the text (asks counsel to advise, or "my advice"). No document mixes business and legal content in one message; mixed content appears only as the partial-privilege chain.
8. **Work-product memo has no recipient** in the rounds ("To: —") but is addressed to outside counsel in the privilege log, where an entry without recipients is the "incomplete" flaw.
9. **Real court and rules are not used.** The district is fictional; no Federal Rules timing appears in this simulation.
