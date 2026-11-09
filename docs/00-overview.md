# 00 · Overview

## Problem

Roles like accounting and pharmacy internships get large applicant pools but are screened with resumes and behavioral interviews. There is no cheap, credible way to see whether an applicant can actually do the work before spending interview time on them.

## Product

An online assessment platform where candidates complete a **job simulation**: a timed, realistic slice of a day on the job (an inbox of requests, a spreadsheet that doesn't tie, a client asking a question). Companies get scored results with evidence and integrity labels, and decide who moves forward.

Simulations are the core approach. Multiple choice is supported as one simple step type, not the main format.

## First roles

1. Accounting intern (see `07-accounting-simulations.md`)
2. Pharmaceutical intern (scope still open, see `08-roadmap-and-open-questions.md`)

## Users

| User | Goal |
| --- | --- |
| Candidate | Show they can do the job; no account, no download |
| Company admin | Owns the account, billing, users, settings |
| Recruiter | Runs hiring rounds: invites, reviews, advances, rejects |
| Viewer | Hiring manager or interviewer who reads results and votes |

## Key decisions so far

| Decision | Choice |
| --- | --- |
| Hosting | Vercel + Supabase |
| Framework | Next.js full-stack, TypeScript |
| Candidate access | Single-use invite link + email code, no account |
| Test format | Job simulations built from pluggable step types |
| Integrity model | AI labels candidates as suspicious with evidence; the company decides |
| Proctoring | Camera snapshots + full-screen share in MVP; phone side camera later |
| Roles | Admin, recruiter, viewer (viewer may ship after MVP) |

## Doc index

| Doc | Covers |
| --- | --- |
| `01-architecture-and-hosting.md` | Stack, hosting options, scaling, competitors |
| `02-security-and-integrity.md` | Data protection, test protection, proctoring, compliance |
| `03-roles-and-permissions.md` | Admin, recruiter, viewer |
| `04-candidate-experience.md` | Candidate screens and flow |
| `05-company-experience.md` | Company screens and flow |
| `06-assessment-engine.md` | Scenarios, step types, scoring, variants, data model |
| `07-accounting-simulations.md` | Worked accounting simulation examples |
| `08-roadmap-and-open-questions.md` | Phases, gates, open questions |
| `09-go-to-market.md` | Accounting target firms, how they hire, pitch, outreach, contacts |
