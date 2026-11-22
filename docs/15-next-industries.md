# 15 · Next industries to pitch

Which roles to take the simulations to after accounting, paralegal and pharma (accounting and paralegal are built, pharma is planned; none is covered here). Tech roles are out of scope. Research as of Nov 2026 from vendor sites, trade press, BLS and industry surveys. Many figures come from recruiters, vendors or test-prep sites; treat them as direction, not proof.

Authoring prompts: `16-simulation-prompts.md` (first wave, this ranking) and `17-simulation-prompts-shortage-markets.md` (second wave).

## How the picks are ranked

The priority is **roles hired in large numbers that draw far more applicants than anyone can read**. That is a different market from "can't find skilled people", and the pitch is different:

| | Applicant-overload roles (first wave) | Shortage roles (second wave) |
| --- | --- | --- |
| Buyer's pain | 300 applications per opening, many AI-written and identical; recruiters can't tell who can do the work | Few qualified applicants; a bad hire is costly |
| Pitch | "Cut the pile to the 20 who can do the job, with a test AI-written applications can't fake" | "Know before the offer whether they can do it" |
| What matters in the product | Seeded variants, fast server-timed rounds, proctoring, automatic scoring, a ranked results table | Depth and realism |
| Pricing pressure | Per-candidate pricing gets expensive at volume; a per-job or per-round price fits better | Per candidate is fine |

Ranking tests, in order: (1) openings per year, (2) applicants per opening, (3) whether a job simulation already owns the role, (4) whether the buyer is reachable, (5) fit to the engine's step types.

## The applicant flood, in numbers

| Measure | Figure | Source |
| --- | --- | --- |
| Applications per job, all roles | 244 average in 2025 | Greenhouse (6,000+ companies) |
| Applications per hire | 291, three times the level of five years ago | Ashby, 2026 |
| Entry-level and remote postings | 400 to 1,000+ reported | Secondary summaries |
| UK graduate roles | 140 applications per vacancy (86 in 2022/23); retail, FMCG and tourism up to 290 | Institute of Student Employers |
| Entry-level postings | Down about 35% since 2023 while applications rose | Secondary summary |
| Recruiter time | 34% of US recruiters spend up to half their week filtering junk applications | Greenhouse |
| Bank internships | JPMorgan about 630,000 applications for 4,100 places; Goldman over 360,000, under 1% accepted | Fortune and secondary reports; totals vary by source |
| Professional services | PwC about 304,000 applications for 7,400 places; McKinsey about 200,000 a year | One secondary compilation |
| Applicants per LinkedIn posting by function | Marketing 97, finance 71, accounting 43 | ResumeTarget analysis, 2025. Ashby's medians point the other way (marketing 15, finance 8); the two disagree |

US openings per year, 2024 to 2034 (BLS): management analysts 98,100; market research analysts and marketing specialists 87,200; human resources specialists 81,800; project management specialists 78,200; claims adjusters, examiners and investigators 21,600 (employment falling 5%). Not found in this pass: financial analysts, buyers and purchasing agents, loan officers.

## First wave, in lead order

| # | Role | Openings and applicants | Who tests it today | Reachable buyer | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | **Marketing coordinator / marketing analyst** | 87,200 openings a year; highest applicants per posting of any named function in the LinkedIn data; consumer-brand graduate roles up to 290 applications | Generic libraries only: Vervoe (10 to 12 questions), Testlify, TestGorilla, HireQuotient. No seeded simulation found | Every company with a marketing team; agencies; consumer brands. The hiring manager feels the pile directly | **Best lead.** Large, open, and the work (campaign numbers, launch QA, invoices) fits the engine |
| 2 | **Business / operations analyst, junior consultant** | 98,100 openings a year (management analysts) plus 78,200 project roles; the most extreme applicant ratios outside banking | Top firms run their own screens (McKinsey Solve, BCG Casey) and vendor aptitude tests (SHL, Cappfinity, SOVA, Pymetrics). Those are reasoning tests and games, not the job | Mid-size consultancies, Big Four-style advisory practices below the firm level, and corporate strategy and operations teams | **Open below the top tier.** Horizontal: nearly every pilot company hires this role |
| 3 | **HR / people operations coordinator** | 81,800 openings a year; "coordinator" and "assistant" titles are where the flood is worst | Generic admin simulations (eSkill, HR Avatar "Workplace Simulation: Administration") | The HR team is both buyer and user, so the sale is one conversation. Staffing agencies | **Open.** Smaller volume per company, easiest sale |
| 4 | **Bank analyst programme: commercial banking and credit** | The largest applicant pools anywhere (see table above) | Large banks are locked into SHL, HireVue and Pymetrics. Regional banks and credit unions: nothing found | Regional and community banks, credit unions, asset managers. Not the global banks at first | **Open in the middle of the market.** Reuses the accounting content skills |
| 5 | **Assistant buyer / merchandise planner (retail and consumer goods)** | Up to 290 applications per graduate role, the highest sector in the ISE data (UK) | Numerical and personality tests, some in-house retail maths exercises. No simulation vendor found | Retailers and consumer brands with trainee schemes; several run annual intakes | **Open.** Evidence is UK-heavy; check US intake sizes before pitching |
| 6 | **Insurance claims representative trainee** | 21,600 openings a year; carriers hire trainees in classes on "degree or three years' experience" terms, which draws a broad pool | HireVue Virtual Job Tryout and HR Avatar cover the contact-centre end | Regional carriers, third-party administrators, independent adjusting firms | **Partly open.** Hiring volume at the big carriers was not confirmed in this pass, and BLS projects decline |

### Why this order

1. Marketing and the analyst role are the two largest pools of openings, both flooded, and neither has a real simulation. Marketing goes first because no incumbent of any kind sits on the mid-market buyer; the analyst role has aptitude-test incumbents at the top firms.
2. HR is third on volume but first on ease: the person drowning in applications is the person who buys.
3. Banking has the biggest numbers but the biggest employers are the least reachable, the same reason the Big 4 are excluded in `09-go-to-market.md`.
4. Retail and claims are real but rest on thinner evidence.

## Second wave: shortage markets

Still good markets, but the opposite problem (few applicants), so they move behind the first wave. Prompts: `17-simulation-prompts-shortage-markets.md`.

| Role | Signal | Simulations found |
| --- | --- | --- |
| Commercial insurance associate underwriter | About 70% of underwriting executives worried about long-term talent (Pacific Life) | Training only (Attensi, LMA/IUA) |
| Construction project engineer, estimator | AGC 2026: 82% of firms have salaried openings; 87% of those say they are as hard or harder to fill | None |
| Wealth management client service associate | RIAs need about 70,000 new staff in five years (Schwab) | None found |
| Trade compliance entry analyst | DHL adding 200+ customs agents and entry writers | None found |
| AML / KYC analyst | Four months or more to fill analyst roles (WorkFusion/Celent) | Training only |

## Competitor landscape

### Horizontal simulation platforms (the real threat)

None was found owning a role above; all could build into one. The defence is per-candidate seeded variants whose keys always tie, server-timed rapid rounds, and traps a practitioner recognises.

| Vendor | What it does | Notes |
| --- | --- | --- |
| Skillfully | Custom AI-built simulations per employer | Names Bloomberg, McKinsey and Athena as customers. Closest in concept |
| Vervoe | Work-sample tests with AI grading, 300+ templates | Short standard templates |
| HireVue Virtual Job Tryout, Harver | Job tryouts for high-volume roles (contact centre, retail, claims intake) | Enterprise sales |
| CodeSignal for Financial Services | Spreadsheet simulations and written tasks | Watch for bank roles |
| MeritFirst | Assessments from "real work"; $6M seed (8VC, Slow Ventures); finance and startups | Raise date differs by source |
| Canditech, HeyMilo | Job simulations; AI interview agents with scenario assessments | Little public detail on roles |

### Aptitude and game incumbents (large employers)

SHL, Cappfinity, SOVA, Pymetrics, Arctic Shores, HireVue. They hold the global banks, the Big Four and the top consulting firms. They measure reasoning and traits, not the work, which is the argument against them; displacing them is an enterprise sale and not a first step.

### Vertical simulation vendors (out of scope or taken)

Software and data (HackerRank, CodeSignal, Codility), hardware engineering (Colare), investment banking and trading (AmplifyME), sales (Take2 AI).

### Generic test libraries

HR Avatar, eSkill, iMocha, Testlify, Xobin, TestGorilla, Mercer Mettl, HireQuotient, ProProfs, Criteria and Pmaps list a 10 to 60 question test for nearly every role here. They prove the buyer already pays for testing, and they are what we replace.

## Pitch lines

| Role | Line |
| --- | --- |
| Marketing | "300 applicants, one afternoon: see who catches the wrong promo code before launch." |
| Business analyst | "A reasoning test tells you they're clever. This tells you whether the number on the slide is right." |
| HR coordinator | "You read applications all day. Let the work sample read them for you." |
| Bank analyst | "Watch an analyst spread real financials and find the covenant breach." |
| Assistant buyer | "Retail maths under trade-meeting pressure, with a different sheet for every candidate." |
| Claims trainee | "Find out before the training class who verifies coverage before promising payment." |

## Open questions

- Pricing for volume: per job or per round instead of per candidate?
- Load: a 500-candidate round in one week has not been tested (see `01-architecture-and-hosting.md` on caching).
- Completion rates: a 50-minute test sent to 300 applicants needs a drop-off check in the first pilot; a 20-minute first-stage cut may be needed.
- Values sections: fixed library for v1; should values points count in the total, and can companies choose their own?
- HR and claims content cites US federal rules; legal review before use outside that.
- US intake sizes for retail trainee schemes and claims trainee classes were not confirmed.

## Sources

- Volume: [Greenhouse CEO on the application flood (Fortune)](https://fortune.com/2026/07/27/greenhouse-ceo-daniel-chait-ai-doom-loop-job-seekers-spam-interview-applications-unemployment/), [application volume summary (Metaview)](https://content.metaview.ai/application-volume-recruiting-agentic-ai/), [LinkedIn posting analysis (ResumeTarget)](https://www.resumetarget.com/job-market/usa), [BambooHR state of hiring 2026](https://www.bamboohr.com/resources/data-at-work/data-stories/state-of-hiring-2026), [ISE: how employers manage record applications](https://ise.org.uk/knowledge/insights/543/how_employers_are_actually_managing_record_applications), [ISE via Times Higher Education](https://www.timeshighereducation.com/news/employers-cut-student-work-experience-roles-demand-rises), [entry-level flood](https://polandinsight.com/entry-level-jobs-flooded-with-applicants-as-ai-reshapes-the-labour-market-81741/)
- Banking and professional services: [Goldman internship applications (Fortune)](https://fortune.com/2025/06/16/goldman-sachs-internship-summer-analysts-wall-street-tpg-olaplex-red-lobster), [acceptance rates compilation](https://whali.co.uk/blog/internship-acceptance-rates-2026), [bank online assessments](https://www.preplounge.com/en/blog/finance/investment-banking/interview/online-assessments), [consulting screens by firm](https://managementconsulted.com/consulting-tests-assessments/)
- BLS: [management analysts](https://www.bls.gov/ooh/business-and-financial/management-analysts.htm), [market research analysts](https://www.bls.gov/ooh/business-and-financial/market-research-analysts.htm), [openings in bachelor's-level occupations](https://www.bls.gov/opub/ted/2026/projected-job-openings-in-occupations-typically-requiring-a-bachelors-degree-2024-34.htm), [project management specialists](https://www.bls.gov/ooh/business-and-financial/project-management-specialists.htm), [claims adjusters](https://www.bls.gov/ooh/Business-and-Financial/Claims-adjusters-appraisers-examiners-and-investigators.htm)
- Role tests today: [Vervoe library](https://vervoe.com/assessment-library/?page=19), [Testlify marketing coordinator](https://testlify.com/test-library/marketing-coordinator/), [eSkill job simulations](https://eskill.com/job-task-simulations), [HR Avatar administration simulation](https://hravatar.com/ta/tests/6208/workplace-simulation-administration.html), [Asda buying programme](https://www.brightnetwork.co.uk/graduate-jobs/asda/buying-graduate-programme-2027), [HR Avatar claims test](https://www.hravatar.com/ta/tests/6228/claims-adjuster-examiner-investigator.html)
- Simulation startups: [Colare (TNW)](https://thenextweb.com/news/colare-2-5m-hardware-engineer-hiring-tests), [MeritFirst (8VC)](https://8vc.com/resources/from-credentials-to-credibility-introducing-meritfirst), [Take2 AI](https://pulse2.com/take2-ai-sales-recruiting-platform-company-raises-3-million), [HeyMilo](https://pulse2.com/heymilo-ai-raises-6-million-to-expand-agentic-recruiting-platform-and-launch-new-ai-hiring-agents/amp/), [Skillfully](https://claude.com/customers/skillfully), [CodeSignal financial services](https://codesignal.com/solutions/financial-services/), [AmplifyME](https://finextra.com/pressarticle/100258/amplifyme-launches-banking-simulator)
- Second wave: [AGC 2026 workforce survey](https://www.agc.org/sites/default/files/users/user21902/2026%20Workforce%20Survey%20National%20Release%20(5).pdf), [insurance hiring outlook](https://riskandinsurance.com/insurance-industry-shows-strong-hiring-optimism-despite-persistent-talent-challenges/), [DHL customs hiring](https://www.freightwaves.com/news/dhl-surges-customs-agent-hiring-as-tariffs-confuse-importers), [RIA staffing need](https://www.investmentnews.com/practice-management/how-career-changers-are-helping-to-fill-the-advice-industrys-talent-shortage/265974), [financial crime staffing](https://www.workfusion.com/blog/the-unvirtuous-cycle-of-staffing-challenges-for-financial-crime-compliance-teams/)
