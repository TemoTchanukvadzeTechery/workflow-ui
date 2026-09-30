# BRD: Ambassador Agreement Acceptance Reporting

Status: draft for Product Owner review. This document is a proposal, not an approval or a commitment.

## Business and Product Lead

Not yet provided. No source names a business stakeholder or the Product Manager leading this work. The sources identify Legal/Compliance as the consuming group [R1, R2 Description, R3 Description], and CP-50416 names Christopher Reid and Michael Ruppert as participants in earlier agreement scoping discussions [R13 Additional Information] — neither is stated to be the lead for this BRD. See Open Questions Q1.

## Problem to be Solved

Plexus now captures Brand Ambassador acceptance of the Brand Ambassador Agreement, Policies & Procedures, and Privacy Policy at login, and stores evidence of each acceptance event [R6 Purpose & Value, R5 Purpose & Value]. The record exists, but there is no place to see it. Legal and Compliance cannot view acceptance coverage on demand and today depend on a data pull request to Engineering or another team to get the numbers [R2 Acceptance Criteria, R3 Acceptance Criteria].

The PO frames the need as "a place for seeing reports for what customers have accepted" — latest agreements, how many have accepted, how many have not, and comparable overall analytics [N1 L1, N1 L2].

Customer tie-back: the direct consumers are internal (Legal/Compliance). The customer-facing chain stated in the sources is that the acceptance record exists to reduce litigation exposure for the ambassador base, and Legal needs the record to confirm an individual ambassador's status during a dispute or support escalation [R8 Description, R1 Purpose & Value, R3 Description]. Ambassadors are affected when their status cannot be confirmed quickly. The sources do not quantify how often this happens or what it costs — see Open Questions Q2.

## Proposed Solution

A reporting view that presents agreement acceptance analytics on demand, without a data pull request [N1 L1-L2, R2 Acceptance Criteria].

The view surfaces the current state of acceptance across the ambassador base: the latest agreements and versions in force, counts of ambassadors who have accepted and who have not, and the resulting coverage [N1 L2]. It reads the acceptance record already produced by the delivered agreement work [R5, R6, R7].

Hosting: the PO notes that existing web services could host it, and that an implementation in another parent epic can be checked as a reference [N1 L2]. The specific service, surface, and access model are deliberately not decided here — see Open Questions Q4 and Q5. Note the constraint that reports-service-v3 is being decommissioned and Virtual Office reports now run on reporting-service [R14 Goal], so any hosting decision should target reporting-service rather than the service being shut down.

Scope framing from the PO: this BRD is "purely seeing the numbers … just overall analytics" [N1 L2]. Individual ambassador lookup is treated as out of scope here — see Out of Scope and Open Questions Q3, because N1 also asks that CP-50908, the individual-lookup story, be reviewed [N1 L1].

## Requirements

1. Legal/Compliance can view aggregate agreement acceptance analytics on demand, without submitting a request to Engineering or another team [N1 L1-L2, R2 Acceptance Criteria].
2. The view shows the latest agreements and their current versions [N1 L2].
3. The view shows how many ambassadors have accepted and how many have not, for a given agreement and version [N1 L2, R2 Description].
4. Acceptance figures can be filtered or segmented by agreement and by version [R2 User Story].
5. Acceptance coverage is expressed so that progress toward the stated 100% acceptance goal can be read from it [R2 Description].
6. The data is available on an as-needed basis rather than only on a fixed recurring schedule [R2 Acceptance Criteria].
7. Access to the view is restricted to the intended internal audience. The audience named in the sources is Legal/Compliance [R1, R2, R3]; the control mechanism is an open question (Q5).

The following are candidate requirements the sources support but the PO's scope statement appears to exclude; confirm before including:

8. (Candidate) The list underlying the counts can be retrieved, including at minimum ambassador ID, name, acceptance status, and version accepted [R2 Acceptance Criteria]. This is record-level rather than "just numbers" [N1 L2] — see Q3.

## Success Metrics

Candidates only, tied to the stated goal of 100% acceptance coverage [R2 Description] and the programme aim of reducing litigation exposure [R8 Description]. No baseline, target, owner, or date is stated in any source; each candidate must be validated with BI (template contact: Thomas Hamilton) before use.

1. (Candidate) Number of manual data pull requests to Engineering or another team for agreement acceptance data, per period — expected to fall to zero after launch [R2 Acceptance Criteria, R3 Acceptance Criteria]. Baseline not provided.
2. (Candidate) Time to answer a Legal/Compliance acceptance question, from request to answer [R3 Description]. Baseline not provided.
3. (Candidate) Measured acceptance coverage across the ambassador base, by agreement and version, as reported by the view [R2 Description]. Note this measures the programme, not this reporting work.

The product line's core KPI is not stated in any supplied source and the BRD memory records no product KPI [M Product KPIs, empty]. See Open Questions Q6.

## Out of Scope

- Individual ambassador lookup by Customer ID or name, and per-ambassador acceptance history, as covered by CP-50908 [R3] — excluded by the PO's statement that the scope is "purely seeing the numbers … just overall analytics" [N1 L2]. Flagged as a conflict; see Q3.
- Capturing acceptance, the clickwrap experience, enforcement, and evidence/audit logging — delivered under CP-50889, CP-50890, CP-50891 [R6, R11, R5].
- Agreement versioning and re-acceptance triggering — delivered under CP-50893 [R7].
- Preventing ARC ghosted-in acceptance on an ambassador's behalf — delivered under CP-50892 [R10].
- Changes to agreement content, the gate copy, or the Help Center link [R12].
- Decommissioning reports-service-v3 and the related migration work — separate epic CP-51485 [R14], a constraint on this work, not part of it.
- Building or changing the technical solution design and ticket breakdown; this BRD stops at requirements.

Likely but unstated exclusions are recorded in Open Questions rather than asserted here (scheduled or emailed reports, export to file, non-US ambassadors, VIP and Retail customer types).

## Open Questions

| # | Question | Who can answer |
| --- | --- | --- |
| Q1 | Who is the business stakeholder owning this work, and who is the Product Manager leading it? No source names them. | PO |
| Q2 | How often does Legal/Compliance need these numbers today, and what does the current data-pull route cost in time or risk? Needed to state customer and business impact [R2, R3]. | PO / Legal & Compliance |
| Q3 | Conflict: N1 scopes this to aggregate numbers only [N1 L2] but also asks that CP-50908, the individual-lookup story, be reviewed [N1 L1]. Is individual lookup in scope for this BRD, or does it stay in CP-50908? | PO |
| Q4 | Overlap: CP-50909 [R2] and CP-50908 [R3] already exist in backlog under epic CP-50894 [R1] and cover this need. Does this BRD supersede, feed, or duplicate them? Which is the system of record? | PO |
| Q5 | Which existing web service and which surface should host the view, and what access control applies? N1 says existing services could host it and points to an implementation in another parent epic without naming it [N1 L2]. Note reports-service-v3 is being shut down; reporting-service is the live path [R14]. | PO / Engineering |
| Q6 | What is the product line's core KPI these metrics should tie to? No source states it. | PO / BI (Thomas Hamilton) |
| Q7 | Are the candidate success metrics measurable in the BI stack, and what are their baselines, targets, owners, and dates? | BI (Thomas Hamilton) |
| Q8 | Which population does the report cover — US Ambassadors only, as scoped for the acceptance project [R13 Additional Information], or also VIP and Retail customer types raised there but excluded then? | PO / Legal |
| Q9 | How should the report treat the 30-day written opt-out provision [R13 Additional Information]? Does an opted-out ambassador count as not accepted, or as a distinct state? | Legal (Michael Ruppert, per R13) |
| Q10 | Are scheduled/recurring delivery, email distribution, or export-to-file needed? R2 states as-needed rather than fixed-schedule [R2 Acceptance Criteria]; the sources do not address export. | PO / Legal & Compliance |
| Q11 | What data freshness is acceptable — live, or a periodic refresh? No source states it. | PO / Engineering |
| Q12 | Is the report gated by the LD flag ambassador-upgrade-agreements-enabled used for the phase 2 epic [R1]? | Engineering |
| Q13 | Assumption to confirm: the acceptance evidence stored under CP-50891 [R5] contains everything needed for these counts, including version accepted and timestamp. Not verified. | Engineering |
| Q14 | Is there an existing Confluence BRD for this area? The epics reference "BRD - Ambassador Data Tracking Improvements (Clickwrap)" [R5, R6, R7, R11]; it was not supplied and has not been compared against this draft. | PO |
| Q15 | Is a target date or release window expected? CP-50894 is In Progress under a Q3 misc-work project [R1, R9]; no date is stated for this work. | PO |

## Implementation Plan

Status and dates only where the sources provide them. No source provides any; all items are unstarted and unscheduled.

1. Comms Plan (emails, social posts, Jewel communication, VO news bulletin) — Not yet provided.
2. Help Center Articles — Not yet provided.
3. Internal Training — Not yet provided.
4. Date of Pre Implementation Kick off Meeting — Not yet provided.
5. Schedule launch readiness Meeting — Not yet provided.

## Sources

| ID | Type | Origin / author | Date | Location |
| --- | --- | --- | --- | --- |
| N1 | PO notes | Product Owner | 2026-09-28 (supplied) | Inline in the drafting request |
| R1 | Jira issue (Epic) | Jira CP project | not stated | CP-50894 — Phase 2 Fast Follow: Legal & Compliance Reporting |
| R2 | Jira issue (Story) | Jira CP project | not stated | CP-50909 — Retrieve Acceptance Status Across the Full Ambassador Base |
| R3 | Jira issue (Story) | Jira CP project | not stated | CP-50908 — Phase 2: Look Up an Individual Ambassador's Acceptance Status |
| R4 | Jira issue (Spike) | Jira CP project | not stated | CP-51264 — SPIKE: Look Up an Individual Ambassador's Acceptance Status (Done) |
| R5 | Jira issue (Epic) | Jira CP project | not stated | CP-50891 — Acceptance Evidence & Audit Logging |
| R6 | Jira issue (Epic) | Jira CP project | not stated | CP-50889 — Mandatory Agreement Acceptance Experience |
| R7 | Jira issue (Epic) | Jira CP project | not stated | CP-50893 — Future Agreement Versioning & Re-Acceptance |
| R8 | Jira issue (Project) | Jira PLAN project | not stated | PLAN-818 — Ambassador Agreement Compliance |
| R9 | Jira issue (Project) | Jira PLAN project | not stated | PLAN-358 — Shopping Experience: Misc Tasks & Bug Fixes (2026 Q3) |
| R10 | Jira issue (Epic) | Jira CP project | not stated | CP-50892 — Prevent Arc Login Acceptance on Behalf of Ambassadors |
| R11 | Jira issue (Epic) | Jira CP project | not stated | CP-50890 — QA: Site Access Enforcement Until Acceptance |
| R12 | Jira issue (Epic) | Jira CP project | not stated | CP-51347 — Ambassador Agreement Minor Adjustments |
| R13 | Jira issue (Epic) | Jira CP project | consumer/scoping notes; enrollment links updated 2026-07-17 | CP-50416 — [Research] BA Agreement & P&P Consent Capture |
| R14 | Jira issue (Epic) | Jira CP project | consumer verification 2026-09-17 | CP-51485 — Decommission reports-service-v3 |
| M | BRD memory | memory/brd-memory.md | n/a | Empty: no stakeholders, KPIs, standing decisions, glossary, or register entries |

This appendix exists for traceability and can be removed before the BRD is circulated.
