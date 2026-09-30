# Shared memory

Facts shared by the po-brd and architect-aad workflows, and the register of accepted BRDs and AADs. A workflow proposes an update after a document is accepted; the person who accepted it (the PO for a BRD, the architect for an AAD) approves each one. Edit by hand when needed.

## Shared facts

### Stakeholders and teams

- Legal/Compliance is the consuming group for ambassador agreement acceptance reporting. No individual is named as its representative. [`brd/brd.md`]
- Christopher Reid and Michael Ruppert took part in earlier agreement scoping discussions (Jira CP-50416); neither is stated to be a BRD lead. Michael Ruppert is named in connection with the 30-day written opt-out provision. [`brd/brd.md`]
- Thomas Hamilton (BI) is the template's contact for validating success metrics. No BI validation has taken place. [`brd/brd.md`]
- No business stakeholder or Product Manager is named as lead for the Ambassador Agreement Acceptance Reporting BRD; this is an open question for the PO. [`brd/brd.md`]
- Legal/Compliance is the consuming department for ambassador agreement acceptance reporting. [`aad/aad.md`]
- Kraken Up owns the website-customer-portal repository, per the CP-51569 modernisation epic. [`aad/aad.md`]
- Data Engineering / the DATA team owns stored procedures and the ThatOtherGuy and PlexusSync databases. [`aad/aad.md`]
- Customer Guardians is the team whose competency boundary the CP-51264 spike describes for BI Platform work; the service-side owner for the reporting work is not stated in any source. [`aad/aad.md`]
- Michael Ruppert is named in CP-50416 as the Legal contact for the 30-day written opt-out question. [`aad/aad.md`]

### Product KPIs

- The product line's core KPI is not stated in any source seen so far; it remains an open question for the PO and BI. [`brd/brd.md`]
- Manual data pull requests to Engineering for acceptance data fall to zero. [`aad/aad.md`]
- Time to answer a Legal/Compliance acceptance question, from request to answer, is reduced. [`aad/aad.md`]
- Measured acceptance coverage by agreement and version is readable against the stated 100% acceptance goal. [`aad/aad.md`]

(All three are candidate metrics pending validation.)

### Systems and services

- **website-customer-portal** — internal customer-management web app, Node 22 + Angular 21, SSR disabled, Okta OIDC middleware, deployed to the `internal-apps-dev/test/stage` namespaces and PROD with autoscaling. Decided "Alive" under CP-51569. Existing downstreams: customer-service, order-service, order-service-v2, commissions-client. Carries 16 open critical Snyk findings being cleared under CP-51568 and a bespoke Express 5 SSR server. [`aad/aad.md`]
- **customer-service (Node)** — consumer of the `CustomerAgreementGet_v2` stored procedure; already integrated with customer-portal; `POST /getCustomerAgreements` handled ~190,200 calls in the measured window. Being migrated to Java Spring Boot under its own AAD. [`aad/aad.md`]
- **customer-service-v2 (Java)** — owns the agreement domain SQL written by the terms gate: provisioning, the outstanding-agreements query, and the acceptance consumer. Proposed owner of the new aggregate-acceptance query. [`aad/aad.md`]
- **api-gateway** — existing edge for agreement endpoints (`GET /v1/sso/post-login-context`, `POST /v1/agreements`, `POST /api/v1/webhooks/contentful`); authenticates and forwards, owns no domain SQL. [`aad/aad.md`]
- **ThatOtherGuy database** — holds `CustomerAgreement`, `CustomerAgreementType`, and `CustomerAgreementRequirement`: the acceptance record and the requirement definition. [`aad/aad.md`]
- **PlexusSync** — second data source for the ambassador population used as the coverage denominator (`PLEXUS_SYNC_DBNAME`). [`aad/aad.md`]
- **BI Platform** — replica-based, daily ingest, owned outside the Customer Guardians team; an alternative source for aggregate figures. [`aad/aad.md`]
- **Contentful (space NextJS `lmpc0ugisjrh`)** — source of truth for agreement definitions and versions; feeds `CustomerAgreementType` through the publish webhook. [`aad/aad.md`]
- **Okta** — authentication for customer-portal and the access-control point for the Legal/Compliance audience. [`aad/aad.md`]
- **reports-service-v3** — being decommissioned under CP-51485/CP-51441; reporting-service already serves all Virtual Office reports, and website-backoffice-v3 was its last v3 consumer. [`aad/aad.md`]

### Integration conventions

- api-gateway authenticates and forwards; the domain service owns the SQL. [`aad/aad.md`]
- Service-to-service traffic uses Istio mTLS with a deny-by-default authorization policy; secrets live in AWS Secrets Manager. [`aad/aad.md`]
- New Java service work follows the Spring Boot conventions of the legacy-migration AAD: layered controller/service/DAO, DTOs, an api-contracts OpenAPI spec published before the service deploys, structured JSON logging, Micrometer to Dynatrace. [`aad/aad.md`]
- Dynatrace is the platform monitoring standard; an end-to-end request identifier is propagated across hops. [`aad/aad.md`]
- LaunchDarkly is the platform mechanism for gating a new surface so it can be disabled without a deploy. [`aad/aad.md`]
- Standing test stack: JUnit 5, Mockito, Testcontainers, JaCoCo, SonarCloud, Snyk, Cucumber, Swagger; API automation lives in the pww-automation repository. [`aad/aad.md`]
- Environment ladder: DEV → TEST → STAGE → PROD, database/stored-procedure changes promoted ahead of the consuming service. [`aad/aad.md`]

### Standing decisions and constraints

- reports-service-v3 is being decommissioned under Jira epic CP-51485; Virtual Office reports now run on reporting-service, so new reporting work should target reporting-service. [`brd/brd.md`]
- Agreement acceptance capture at login (Brand Ambassador Agreement, Policies & Procedures, Privacy Policy) and its evidence/audit logging are already delivered under Jira epics CP-50889, CP-50890, CP-50891; versioning and re-acceptance under CP-50893; ARC ghosted-in prevention under CP-50892. [`brd/brd.md`]
- The acceptance programme's stated goal is 100% acceptance coverage across the ambassador base, aimed at reducing litigation exposure. [`brd/brd.md`]
- The agreement acceptance project was scoped to US Ambassadors; VIP and Retail customer types were raised and excluded at that time. Whether reporting follows the same population is unresolved. [`brd/brd.md`]
- No new reporting path may depend on reports-service-v3, which is being decommissioned. [`aad/aad.md`]
- Acceptance records are immutable and append-only; the `CustomerAgreement` rows — not any report — are the authority in a dispute. [`aad/aad.md`]
- The Data team wants to avoid additional load on the PROD database; aggregate queries must be bounded, indexed, and set-based, never a per-customer fan-out. [`aad/aad.md`]
- Nothing on the reporting path may sit in the login path or degrade the Auth0 terms gate. [`aad/aad.md`]
- Known counting defects to design around: CP-51265 (D2A enrollment produces duplicate `CustomerAgreementTypeID` acceptance sets) and CP-51058 (Arizona-scoped agreements applied to non-AZ customers, so state scoping of the denominator is unreliable). [`aad/aad.md`]
- Acceptance-project population scope was set as all US Ambassadors; VIP and Retail were raised and excluded. [`aad/aad.md`]
- The Brand Ambassador Agreement allows a written opt-out within 30 days of publication, after which the previous version governs; the acceptance record does not model this third state. [`aad/aad.md`]

### Glossary

- Ambassador / Brand Ambassador — the customer type required to accept the Brand Ambassador Agreement, Policies & Procedures, and Privacy Policy at login. [`brd/brd.md`]
- ARC login — internal login on an ambassador's behalf; ghosted-in acceptance is prevented under CP-50892. [`brd/brd.md`]
- reporting-service — the live reporting backend replacing reports-service-v3 for Virtual Office reports. [`brd/brd.md`]
- **AAD** — Architecture Approach Document, reviewed by the architecture review board (ARB).
- **Terms gate** — the Auth0 post-login action (`terms-gate.js`) that presents outstanding agreements at login and records acceptance.
- **Acceptance record** — a `CustomerAgreement` row capturing customer, agreement type, version, timestamp, IP address, user agent, geolocation, and a name snapshot.
- **Coverage** — accepted count divided by the eligible (required) population, per agreement version.
- **Eligible population / denominator** — the ambassadors a `CustomerAgreementRequirement` row says must accept a given agreement.
- **D2A** — the enrollment path that produces a separate set of agreement type IDs for the same agreements (CP-51265).
- **ThatOtherGuy** — the database holding the agreement and acceptance tables.
- **PlexusSync** — the database holding the ambassador population data.

## Document register

### Ambassador Agreement Acceptance Reporting

- Type: BRD
- Path: `brd/brd.md`
- Accepted sha256: `2130019c44bf87748a66d2c64ced80fab40cfbc493e958b9f39fedfe042df6ad`
- Run: `0035d37f`
- Status: accepted by the PO; first accepted version, no prior committed version.
- Leads: none named. Business and Product Lead is unresolved (Q1).

Scope: an on-demand reporting view of Brand Ambassador agreement acceptance analytics for Legal/Compliance, removing the current dependency on a data-pull request to Engineering. Requirements cover viewing aggregate acceptance analytics on demand; showing the latest agreements and their current versions; showing accepted and not-accepted counts per agreement and version; filtering or segmenting by agreement and version; expressing coverage against the 100% acceptance goal; availability as-needed rather than only on a fixed schedule; and restricting access to the intended internal audience. One candidate requirement — retrieving the record-level list behind the counts (ambassador ID, name, status, version accepted) — is unconfirmed pending the scope decision in Q3.

Key decisions: scope is aggregate numbers only ("purely seeing the numbers … just overall analytics"); the view reads the acceptance record already produced by the delivered agreement work; hosting service, surface, and access model are deliberately left undecided, with the constraint that reporting-service, not the decommissioning reports-service-v3, is the live path; success metrics are candidates only, with no baseline, target, owner, or date invented.

Out of scope: individual ambassador lookup and per-ambassador history (CP-50908); acceptance capture, clickwrap experience, enforcement, and evidence/audit logging (CP-50889, CP-50890, CP-50891); agreement versioning and re-acceptance (CP-50893); preventing ARC ghosted-in acceptance (CP-50892); changes to agreement content, gate copy, or Help Center link (CP-51347); the reports-service-v3 decommission (CP-51485); technical solution design and ticket breakdown. Scheduled or emailed reports, export to file, non-US ambassadors, and VIP/Retail customer types are unstated exclusions held as open questions rather than asserted.

Blocking questions: Q1 who owns the work and leads it; Q3 whether individual lookup is in scope, given N1 both excludes it and asks that CP-50908 be reviewed; Q4 whether this BRD supersedes, feeds, or duplicates existing backlog stories CP-50909 and CP-50908 under epic CP-50894, and which is the system of record; Q5 hosting service, surface, and access control; Q6 the product line's core KPI. Further open questions cover impact quantification (Q2), BI measurability and baselines (Q7), population coverage (Q8), treatment of the 30-day opt-out (Q9), scheduled delivery and export (Q10), data freshness (Q11), the ambassador-upgrade-agreements-enabled LD flag (Q12), the unverified assumption that CP-50891 evidence carries version and timestamp (Q13), an uncompared Confluence page "BRD - Ambassador Data Tracking Improvements (Clickwrap)" (Q14), and whether a target date is expected (Q15).

Dependencies: Jira CP-50894 (parent epic, In Progress), CP-50909 and CP-50908 (overlapping backlog stories), CP-51264 (done spike), CP-50891 (source of the acceptance evidence), CP-51485 (reports-service-v3 decommission constraint), PLAN-818 and PLAN-358 (programme and quarterly project context), and the unseen Confluence clickwrap BRD.

Implementation plan: all five template items (comms plan, Help Center articles, internal training, pre-implementation kick-off date, launch readiness meeting) are unstarted and unscheduled; no source provides status or dates.

### Ambassador Agreement Acceptance Reporting

- Type: AAD
- Path: `aad/aad.md`
- Accepted sha256: `1a6f74314547abc6921130d42e43f9c4425bde26f76dbea32442f6ede4ae4920`
- Run: `f442e3a3`

Gives Legal/Compliance on-demand visibility into Brand Ambassador agreement acceptance coverage without a data pull request to Engineering, reading the acceptance record delivered under PLAN-818.

**Systems touched.** website-customer-portal (proposed host for a new Agreement Progress page and a per-customer agreements section, based on the existing PoC in pull request 275); customer-service-v2 (proposed owner of a new read-only aggregate coverage endpoint); api-gateway (proposed new route, needed only if the portal cannot reach customer-service-v2 internally); ThatOtherGuy (read-only, possible new stored procedures and indexes owned by Data Engineering); PlexusSync (read-only population source); customer-service, Contentful, and Okta unchanged beyond group or role assignment; LaunchDarkly flag proposed; BI Platform only if that data-source option is chosen; reports-service-v3 explicitly not used.

**Interfaces and events introduced.** One proposed read-only aggregate coverage endpoint (filters by agreement and version), published in api-contracts, returning per agreement version: `agreementTypeId`, `description`, `version`, `countryCode`, `stateProvince`, `requiredCount`, `acceptedCount`, `notAcceptedCount`, `coveragePercent`, `asOf` — all field names proposed and not yet agreed. No new event, topic, queue, datastore, or write path; no schema change identified.

**Key decisions.** Reuse an existing internal website rather than build one, and place the aggregate report beside the per-customer agreement view — pointing at website-customer-portal. Do not build on reports-service-v3. Keep the aggregate query as a separately addressable endpoint, off the login-path `post-login-context` endpoint. Render an explicit error state rather than partial or stale figures, and always show an as-of timestamp. Gate the surface behind a feature flag, defaulted off, and reconcile against a manual data pull before wider enablement. The data source (direct retrieval vs BI Platform vs a materialized summary) and the owning service are recorded as tradeoffs and left to the architect and ARB; the recorded conventions imply customer-service-v2.

**Conventions adopted.** api-gateway authenticates and forwards while the domain service owns the SQL; Spring Boot layered service structure with an api-contracts OpenAPI spec; Istio mTLS with deny-by-default authorization; least-privilege read-only database credentials; secrets in AWS Secrets Manager; structured JSON logging with no record-level data in report access logs; Dynatrace dashboards, metrics, and alerting; LaunchDarkly gating; DEV → TEST → STAGE → PROD promotion with database changes ahead of the service.

**Open questions (18, Q1–Q18).** Blocking: Q1 whether the per-customer view is in scope here or stays under CP-50908; Q2 the data source; Q3 whether the record-level list (BRD requirement 8) is in scope, which changes the data classification of the whole feature; Q4 the access-control role and its administrator; Q7 the counting rule given the D2A and Arizona defects. Also open: filter set (Q5), owning service (Q6), gateway routing (Q8), feature flag (Q9), test-data environment (Q10), DAST coverage (Q11), treatment of the 30-day opt-out (Q12), population scope (Q13), production ownership (Q14), freshness expectation (Q15), reconciliation with the Confluence clickwrap BRD (Q16), delivery epic and relationship to CP-50909 (Q17), alert thresholds and query-cost budget (Q18).

**Dependencies.** Accepted BRD `brd/brd.md`; CP-51264 spike and its Confluence page 5454659585; the terms-gate AAD (page 5302779911) and decision records (pages 5329387522, 5289967628 and proposals 5318967303, 5289672706, 5289443332, 5289836547); PLAN-818 release plan (page 5433360403) and the Contentful authoring spec (page 5432049666); reports-service-v3 decommission CP-51485 / CP-51441; website-customer-portal Alive plan (page 5490999297), its decision records (pages 4834295809, 4772069402, 4834066514), and the CP-51568 Snyk remediation; the legacy Node→Java migration AAD (page 5193105409); epics CP-51709 and CP-50894 and stories CP-50909 and CP-50908; defects CP-51265 and CP-51058.

**Status.** Accepted by the architect as an AAD draft. Not ARB-approved and not department signed-off; no approval is recorded in the Document Acceptance table.
