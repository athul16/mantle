# 14 · Next industries to pitch

Which industries to take the simulations to after accounting, pharma and paralegal (those three are planned and not covered here). Research as of Nov 2026 from vendor sites, trade press and industry surveys. Most "shortage" figures come from recruiters, vendors or trade bodies with an interest in the story; treat them as direction, not proof. Authoring prompts for each pick: `15-simulation-prompts.md`.

## What makes an industry a fit

| Test | Why |
| --- | --- |
| The work is documents, numbers and messages | The engine has `inbox_reply`, `spreadsheet`, `document_review`, `numeric`, `multiple_choice`, `ordering`, `rapid_round`. No code execution, no CAD, no audio |
| A bad hire is expensive and shows up late | Same pitch as accounting: "know before the offer". Works where errors cost money, licences or clients |
| Employers say they can't find skilled people | The buyer wants proof of skill, not a filter for volume |
| Today's screening is resumes, interviews or multiple choice | Multiple choice is what AI answers easily; a seeded, timed simulation is the replacement |
| Buyers are reachable | Mid-size firms and staffing agencies with a named decision-maker, as in `09-go-to-market.md` |
| The rules are public and stable | Scenarios cite real rules; fast-changing ones (tariff rates, contribution limits) must be supplied inside the scenario |

## Competitor landscape

### Horizontal simulation platforms (the real threat)

None of these was found to own any industry below, but all could build into one. The defence is depth: per-candidate seeded variants whose answer keys always tie, server-timed rapid rounds, and traps a practitioner recognises.

| Vendor | What it does | Notes |
| --- | --- | --- |
| Skillfully | Custom AI-built simulations per employer (SkillsOS) | Vendor materials name Bloomberg, McKinsey and Athena as customers. Closest in concept |
| Vervoe | Work-sample tests with AI grading, 300+ templates | Standardised templates, limited customisation per one comparison |
| HireVue Virtual Job Tryout, Harver | Job tryouts, mostly high-volume roles (contact centre, retail, claims intake) | Enterprise sales; not aimed at skilled specialist roles |
| CodeSignal for Financial Services | Spreadsheet simulations and written tasks on top of its coding product | Watch for finance roles |
| Canditech | Job simulations, has a finance hiring page | Little public detail |
| MeritFirst | Assessments from "real work"; $6M seed (8VC, Slow Ventures); focus on finance and venture-backed startups | Sources disagree on the raise date (Oct 2025 or July 2026) |
| HeyMilo | AI interview agents plus an "AI scenario assessment"; $6M in June 2026 | Interview-first |

### Vertical simulation vendors (take these industries off the list)

| Vendor | Vertical | Notes |
| --- | --- | --- |
| HackerRank, CodeSignal, Codility and others | Software, data | Saturated |
| Colare | Hardware engineering (CAD, PCB, FEA); $2.5M pre-seed, launched Oct 2026 | Half its clients are aerospace and defence. Needs tooling we don't have |
| AmplifyME | Investment banking, markets, trading | Used by global banks for campus hiring and assessment |
| Take2 AI | Sales (role-play simulations); reported $14M Series A | Saturated |
| Attensi | Training simulators (underwriting for Hiscox, financial crime) | Training, not hiring. Shows the buyers accept simulations |

### Generic test libraries (present everywhere, weak)

HR Avatar, eSkill, iMocha, Testlify, Xobin, TestGorilla, Mercer Mettl, HireQuotient, ProProfs, Criteria and Pmaps each list a test for almost every role below. They are 20 to 60 multiple-choice questions, sometimes with an animated situational clip (HR Avatar's claims adjuster test). Same position as the accounting vendors in `09-go-to-market.md`: they prove the buyer already pays for testing, and they are what we replace.

## Verdict by industry

"Open" means no simulation-based hiring product was found for the role. It does not mean no competition: the generic libraries are in every row.

| # | Industry and first role | Demand signal | Hiring simulations found | Engine fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | **Commercial insurance**: underwriting assistant / associate underwriter (then claims adjuster) | Sedgwick: nearly 25% of adjusters expected to retire by end of 2027. Pacific Life: about 70% of underwriting executives worried about long-term talent. Jacobson/Aon: over half of carriers plan to add staff | None for hiring. HR Avatar animated claims test; Attensi and the London market (LMA/IUA) use simulations for training and outreach | Very high: submissions, loss runs, rating math, authority rules | **Open. Pitch first** |
| 2 | **Construction**: project engineer, estimator | AGC/NCCER 2026 (1,830 respondents): 82% of firms have salaried openings; 87% of those say they are as hard or harder to fill than last year; half say candidates lack the skills | None. Civil engineering quizzes only | Very high: submittals, change orders, pay applications, takeoff math | **Open. Pitch first** |
| 3 | **Trade compliance and customs brokerage**: entry writer, classification analyst | DHL adding 200+ customs agents and entry writers in the US, FedEx hiring brokerage roles (FreightWaves). Broker exam pass rate reported at 15 to 20% (unverified). Official headcount data is too old to confirm a national shortage | None found at all, not even a generic test | Very high: invoice vs entry checks, valuation, classification by rule | **Wide open, small market** |
| 4 | **Financial crime compliance**: AML / KYC analyst | WorkFusion/Celent: four months or more to fill analyst roles. Barclay Simpson: 61% of employers say shortages hurt team performance, 60% plan to add headcount; overall market "stable" (UK-heavy data) | None for hiring. Multiple-choice tests (iMocha, Pmaps, Testlify); simulations only in training | High: alert triage, KYC files, transaction review | **Open**, slower buyers (banks); start with fintechs and staffing firms |
| 5 | **Commercial banking**: credit analyst | Weak. ABA and ICBA surveys show general talent pressure at community banks; nothing specific to credit analysts | None. AmplifyME covers investment banking, not commercial credit | Very high: spreading, ratios, borrowing base. Closest to the accounting sims already built | **Open, demand unproven.** Cheap to build; validate with two or three bank conversations first |
| 6 | **Wealth management**: paraplanner, client service associate at RIAs | Schwab: RIAs need about 70,000 new staff in five years. McKinsey: about 100,000 advisors short by 2034. RIAs dropping CFP requirements to widen the pool | None found (the search returned nothing on assessments for these roles, which is weak evidence of absence) | High: account paperwork, RMDs, rebalancing, wire-fraud judgment | **Open.** Buyers look like CPA firms: small, local, reachable |

### Second tier

| Industry | Why not yet |
| --- | --- |
| Commercial real estate analyst | Firms already run their own Excel take-home modelling tests. Our `spreadsheet` step checks values in keyed cells, not a free-form model, so we would test less than they already do |
| Medical coding and revenue cycle | Many multiple-choice vendors, AAPC credentials, and employers write in-house tests. Code sets change yearly (candidates complain vendor tests use old ones). Lower-wage, less "high talent" |
| Supply chain planner, procurement buyer | Generic tests exist; the buyer is spread across every industry, so there is no focused first market |
| Mortgage underwriter, processor | Cyclical hiring; multiple-choice tests exist (Erekrut, Xobin) |

### Rejected

| Industry | Reason |
| --- | --- |
| Software, data, cybersecurity | Saturated |
| Hardware engineering | Colare; needs CAD and PCB tooling |
| Investment banking, trading | AmplifyME, in-house modelling tests, MeritFirst and CodeSignal moving in |
| Sales, customer support | Take2, HireVue, Harver |
| Management consulting | Top firms have in-house tools (and Skillfully names McKinsey); boutiques rely on case interviews |
| Actuarial | The exam series is the credential employers trust |

## Recommended order

1. **Commercial insurance.** Clearest retirement-driven shortage, large employers and many regional carriers, agencies and third-party administrators, and buyers already accept simulations for training.
2. **Construction.** Strongest survey evidence, thousands of mid-size general contractors, and no vendor in sight. Triangle-area contractors make a local first list like the accounting one.
3. **Wealth management.** Same buyer shape as CPA firms, so the accounting playbook transfers.
4. **Trade compliance.** Nobody is there; the 2026 tariff changes make the pain current. Small market, so build one simulation and test demand.
5. **Commercial credit.** Reuses the accounting content skills; hold until a bank says it has the problem.
6. **Financial crime compliance.** Real need, but bank procurement and model-risk reviews are slow. Go through fintechs or compliance staffing firms.

## Pitch lines

| Industry | Line |
| --- | --- |
| Insurance | "See whether a trainee can read a loss run and stay inside authority before you spend a year training them." |
| Construction | "Find out before the offer whether a project engineer catches the overbilled pay application." |
| Wealth management | "Know your next associate will call the client back before sending the wire." |
| Trade compliance | "Test entry writers on a real entry packet, not on whether they can recite the GRIs." |
| Commercial credit | "Watch an analyst spread a real set of financials and find the covenant breach." |
| Financial crime | "Measure alert decisions and their reasons, not AML trivia." |

## Open questions

- Insurance: start with underwriting or claims? Underwriting fits the engine better; claims has the sharper retirement numbers.
- Is the staffing-agency channel as strong here as in accounting (insurance and construction both have specialist recruiters)?
- Values sections (see `15-simulation-prompts.md`): fixed library for v1; do pilot companies want their own values, and should values points count in the total?
- Each vertical needs a practitioner to review content, as with the accountant review pack.
- Legal review of situational-judgment content before it is used to rank candidates.

## Sources

- Simulation startups: [Colare launch (TNW)](https://thenextweb.com/news/colare-2-5m-hardware-engineer-hiring-tests), [MeritFirst (8VC)](https://8vc.com/resources/from-credentials-to-credibility-introducing-meritfirst), [Take2 AI](https://pulse2.com/take2-ai-sales-recruiting-platform-company-raises-3-million), [HeyMilo](https://pulse2.com/heymilo-ai-raises-6-million-to-expand-agentic-recruiting-platform-and-launch-new-ai-hiring-agents/amp/), [Skillfully](https://claude.com/customers/skillfully), [Vervoe comparison](https://vervoe.com/compare/testgorilla-alternative), [CodeSignal financial services](https://codesignal.com/solutions/financial-services/), [Canditech finance](https://www.canditech.io/use-cases/hiring-finance-employees/), [AmplifyME](https://finextra.com/pressarticle/100258/amplifyme-launches-banking-simulator)
- Insurance: [Jacobson 2026 outlook](https://www.jacobsononline.com/blog/study-reflects-a-steady-insurance-talent-outlook-for-2026/), [hiring optimism (Risk & Insurance)](https://riskandinsurance.com/insurance-industry-shows-strong-hiring-optimism-despite-persistent-talent-challenges/), [property claims talent loss](https://riskandinsurance.com/property-claims-face-mounting-pressure-from-talent-loss-ai-gaps-and-climate-volatility/), [adjuster shortage](https://www.insurancebusinessmag.com/us/news/workers-comp/claims-adjuster-shortage-puts-workers-comp-renewals-at-risk-596798.aspx), [HR Avatar claims test](https://www.hravatar.com/ta/tests/6228/claims-adjuster-examiner-investigator.html), [Attensi underwriter simulator](https://insurancenewsnet.com/oarticle/attensi-creates-worlds-first-underwriter-simulator-to-tackle-skills-gap-in-insurance-sector), [LMA/IUA simulations](https://www.insurancebusinessmag.com/uk/news/breaking-news/lma-and-iua-extend-job-simulations-to-underwriting-592373.aspx)
- Construction: [AGC 2026 workforce survey](https://www.agc.org/sites/default/files/users/user21902/2026%20Workforce%20Survey%20National%20Release%20(5).pdf), [skills employers can't find (Davron)](https://www.davron.net/construction-hiring-2026-skills-employers-struggling-to-find/), [HR Avatar civil engineer test](https://www.hravatar.com/ta/tests/5986/engineer-civil.html)
- Trade compliance: [DHL customs hiring (FreightWaves)](https://www.freightwaves.com/news/dhl-surges-customs-agent-hiring-as-tariffs-confuse-importers), [customs broker job market 2026](https://www.gaiadynamics.ai/blog/the-customs-broker-job-market-in-2026), [Buffalo cross-border talent](https://kitalent.com/articles/buffalo-cross-border-logistics-talent)
- Financial crime: [Barclay Simpson 2026 guide](https://www.barclaysimpson.com/salary-guides/2026-financial-crime-salary-guide/), [WorkFusion on staffing](https://www.workfusion.com/blog/the-unvirtuous-cycle-of-staffing-challenges-for-financial-crime-compliance-teams/), [Quantexa on AML talent](https://www.quantexa.com/blog/inside-the-aml-talent-market-trends-challenges-and-opportunities/), [iMocha compliance test](https://www.imocha.io/tests/banking-compliance-skills-test)
- Banking: [ABA community bank survey](https://bankingjournal.aba.com/2026/03/aba-survey-most-community-banks-see-growth-opportunities-in-2026/), [ICBA CEO outlook](https://www.icba.org/w/community-bank-ceo-outlook-2026-challenges-opportunities)
- Wealth management: [RIA staffing need](https://www.investmentnews.com/practice-management/how-career-changers-are-helping-to-fill-the-advice-industrys-talent-shortage/265974), [RIAs drop CFP requirements](https://www.wealthmanagement.com/recruiting/ria-firms-drop-cfp-requirements-in-84-of-hires), [junior advisors and AI](https://www.investmentnews.com/transformation/junior-advisors-still-in-demand-as-ai-reshapes-ria-training/268382)
- Second tier: [CRE technical interviews (A.CRE)](https://www.adventuresincre.com/how-to-prepare-for-a-real-estate-technical-interview/), [medical coding tests (eSkill)](https://eskill.com/blog/use-medical-coding-tests-to-make-better-hires/), [supply chain test (eSkill)](https://www.eskill.com/assessments/supply-chain-management), [mortgage underwriter test (Erekrut)](https://www.erekrut.com/skill-assessments/mortgage-underwriter-early-professional-skillproof-assessment)
