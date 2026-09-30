import "server-only";
/**
 * AGR implementation content. T-1, T-4 and T-5 are hand-written (T-4 must match brief F.5: 4/4
 * checks, +412 -18 in 7 files, 42 unit tests, p95 180 ms); the rest use the repo templates with
 * names that match the plan.
 */
import { WorkingTree, diffStats, totals, type FileSpec } from "@/server/mock/workflows/delivery-lib/diff";
import { stripScope } from "@/server/mock/workflows/delivery-lib/util";
import { gatewayImpl } from "./templates/gateway";
import { templateImpl } from "./templates";
import type { RunTask, TaskImpl } from "./types";

const PKG = "src/main/java/com/plexus/customer/agreements";
const TPKG = "src/test/java/com/plexus/customer/agreements";

// ---------------------------------------------------------------------------------------------
// T-1: the set-based coverage query
// ---------------------------------------------------------------------------------------------

const COVERAGE_SQL = `-- CP-52150: acceptance coverage per active agreement version.
-- Set-based: one pass over the requirement and acceptance tables, no per-customer fan-out.
-- D2A enrollment writes a second CustomerAgreementTypeID set for the same agreement, so
-- acceptances are counted once per ambassador and agreement version (pending Q7).
WITH population AS (
    SELECT r.CustomerAgreementTypeID, c.CustomerID
      FROM CustomerAgreementRequirement r
      JOIN Customers c
        ON c.CustomerTypeID = r.CustomerTypeID
       AND (r.HasActiveSubscription = 0 OR c.HasActiveSubscription = 1)
     WHERE r.IsActive = 1
),
accepted AS (
    SELECT t.CanonicalAgreementTypeID AS CustomerAgreementTypeID, a.CustomerID
      FROM CustomerAgreement a
      JOIN CustomerAgreementType t
        ON t.CustomerAgreementTypeID = a.CustomerAgreementTypeID
     GROUP BY t.CanonicalAgreementTypeID, a.CustomerID
)
SELECT t.CustomerAgreementTypeID AS agreement_type_id,
       t.Description             AS description,
       t.Version                 AS version,
       t.CountryCode             AS country_code,
       t.StateProvince           AS state_province,
       COUNT(DISTINCT p.CustomerID) AS required_count,
       COUNT(DISTINCT a.CustomerID) AS accepted_count
  FROM CustomerAgreementType t
  JOIN population p
    ON p.CustomerAgreementTypeID = t.CustomerAgreementTypeID
  LEFT JOIN accepted a
    ON a.CustomerAgreementTypeID = t.CustomerAgreementTypeID
   AND a.CustomerID = p.CustomerID
 WHERE t.IsActive = 1
   AND (:agreementTypeId IS NULL OR t.CustomerAgreementTypeID = :agreementTypeId)
   AND (:version IS NULL OR t.Version = :version)
 GROUP BY t.CustomerAgreementTypeID, t.Description, t.Version, t.CountryCode, t.StateProvince
 ORDER BY t.Description, t.Version DESC
`;

const COVERAGE_INDEX = `-- CP-52150: supports the coverage query's acceptance join (reviewed with Data Engineering).
CREATE NONCLUSTERED INDEX IX_CustomerAgreement_Type_Customer
    ON dbo.CustomerAgreement (CustomerAgreementTypeID, CustomerID)
    WITH (ONLINE = ON);
`;

const COVERAGE_SQL_JAVA = `package com.plexus.customer.agreements.coverage;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import org.springframework.core.io.ClassPathResource;

/** CP-52150: loads the coverage query once; the repository binds agreementTypeId and version. */
public final class CoverageSql {

    public static final String QUERY = load("db/queries/agreement-coverage.sql");

    private CoverageSql() {
    }

    private static String load(String path) {
        try {
            return new ClassPathResource(path).getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("missing " + path, e);
        }
    }
}
`;

const COVERAGE_SQL_IT = `package com.plexus.customer.agreements.coverage;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.jdbc.Sql;
import org.testcontainers.junit.jupiter.Testcontainers;

@JdbcTest
@Testcontainers
@Sql("/fixtures/agreement-coverage.sql")
class CoverageSqlIT {

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    private MapSqlParameterSource params;

    @BeforeEach
    void noFilters() {
        params = new MapSqlParameterSource().addValue("agreementTypeId", null).addValue("version", null);
    }

    @Test
    @DisplayName("AC-1: required, accepted and not accepted per agreement type and version")
    void countsPerAgreementVersion() {
        List<Map<String, Object>> rows = jdbc.queryForList(CoverageSql.QUERY, params);

        assertThat(rows).extracting(r -> r.get("agreement_type_id")).containsExactly(101, 102);
        assertThat(rows.get(0)).containsEntry("required_count", 4L).containsEntry("accepted_count", 3L);
    }

    @Test
    @DisplayName("AC-2: inactive agreement types are not counted")
    void ignoresInactiveTypes() {
        List<Map<String, Object>> rows = jdbc.queryForList(CoverageSql.QUERY, params);

        assertThat(rows).noneMatch(r -> r.get("agreement_type_id").equals(199));
    }

    @Test
    @DisplayName("AC-3: a D2A ambassador with two acceptance sets counts once")
    void countsDuplicateAcceptanceSetsOnce() {
        List<Map<String, Object>> rows = jdbc.queryForList(CoverageSql.QUERY, params.addValue("agreementTypeId", 102));

        assertThat(rows).singleElement().satisfies(r -> assertThat(r.get("accepted_count")).isEqualTo(2L));
    }

    @Test
    void versionFilterNarrowsResult() {
        List<Map<String, Object>> rows = jdbc.queryForList(CoverageSql.QUERY, params.addValue("version", "2026.2"));

        assertThat(rows).extracting(r -> r.get("version")).containsOnly("2026.2");
    }
}
`;

const COVERAGE_FIXTURE = `-- Fixture for CoverageSqlIT: 4 ambassadors, 2 active agreement types, 1 inactive type,
-- and one D2A ambassador (1004) holding two acceptance sets for agreement 102.
INSERT INTO Customers (CustomerID, CustomerTypeID, HasActiveSubscription) VALUES
    (1001, 3, 1), (1002, 3, 1), (1003, 3, 0), (1004, 3, 1);
INSERT INTO CustomerAgreementType (CustomerAgreementTypeID, CanonicalAgreementTypeID, Description, Version, CountryCode, StateProvince, IsActive) VALUES
    (101, 101, 'Brand Ambassador Agreement', '2026.2', 'US', NULL, 1),
    (102, 102, 'Policies & Procedures', '2026.1', 'US', NULL, 1),
    (112, 102, 'Policies & Procedures (D2A)', '2026.1', 'US', NULL, 0),
    (199, 199, 'Retired agreement', '2024.1', 'US', NULL, 0);
INSERT INTO CustomerAgreementRequirement (CustomerAgreementTypeID, CustomerTypeID, AccountMode, HasActiveSubscription, IsActive) VALUES
    (101, 3, 'ANY', 0, 1), (102, 3, 'ANY', 0, 1), (199, 3, 'ANY', 0, 1);
INSERT INTO CustomerAgreement (CustomerID, CustomerAgreementTypeID, AcceptedAt) VALUES
    (1001, 101, '2026-09-01T10:00:00Z'), (1002, 101, '2026-09-02T11:00:00Z'), (1004, 101, '2026-09-03T12:00:00Z'),
    (1001, 102, '2026-09-01T10:00:05Z'), (1004, 102, '2026-09-03T12:00:04Z'), (1004, 112, '2026-09-03T12:02:31Z');
`;

function t1(): TaskImpl {
  return {
    summary:
      "Added the set-based coverage query (db/queries/agreement-coverage.sql) with CoverageSql, an online index on CustomerAgreement (CustomerAgreementTypeID, CustomerID), and Testcontainers coverage including a D2A ambassador with two acceptance sets.",
    notes: [
      "D2A duplicates collapse through CanonicalAgreementTypeID; this encodes the counting assumption pending Q7.",
      "The index migration is reviewed with Data Engineering, who own ThatOtherGuy.",
    ],
    files: [
      { path: "src/main/resources/db/queries/agreement-coverage.sql", after: COVERAGE_SQL },
      { path: "src/main/resources/db/migration/V2026_09_15_1__agreement_coverage_index.sql", after: COVERAGE_INDEX },
      { path: `${PKG}/coverage/CoverageSql.java`, after: COVERAGE_SQL_JAVA },
      { path: `${TPKG}/coverage/CoverageSqlIT.java`, after: COVERAGE_SQL_IT },
      { path: "src/test/resources/fixtures/agreement-coverage.sql", after: COVERAGE_FIXTURE },
    ],
    primaryFile: "src/main/resources/db/queries/agreement-coverage.sql",
    acCoverage: {
      "AC-1": "CoverageSqlIT.countsPerAgreementVersion",
      "AC-2": "CoverageSqlIT.ignoresInactiveTypes",
      "AC-3": "CoverageSqlIT.countsDuplicateAcceptanceSetsOnce",
    },
    fault: {
      check: "unit",
      path: "src/main/resources/db/queries/agreement-coverage.sql",
      correct: "     GROUP BY t.CanonicalAgreementTypeID, a.CustomerID",
      broken: "     GROUP BY a.CustomerAgreementTypeID, a.CustomerID",
      message: "CoverageSqlIT > countsDuplicateAcceptanceSetsOnce() expected accepted_count 2 but was 3",
      output: `> Task :test FAILED

CoverageSqlIT > countsDuplicateAcceptanceSetsOnce() FAILED
    org.opentest4j.AssertionFailedError:
    expected: 2L
     but was: 3L
        at CoverageSqlIT.java:57

Tests: 1 failed, 33 passed, 34 total
BUILD FAILED in 52s`,
      fixSummary: "Grouped acceptances by CanonicalAgreementTypeID so a D2A ambassador's second acceptance set counts once (AC-3).",
    },
    baseTests: 30,
    checks: {
      contract: { summary: "no endpoint change; query contract unchanged", output: "> Task :contractTest NO-SOURCE\nNo contract changes in this task.\nBUILD SUCCESSFUL in 6s" },
      unit: { command: "./gradlew test integrationTest --console=plain" },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// T-4: the coverage endpoint (+412 -18 in 7 files)
// ---------------------------------------------------------------------------------------------

const AGREEMENTS_CONTROLLER_BEFORE = `package com.plexus.customer.agreements;

import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Agreement reads used by customer-portal and the terms gate. */
@RestController
@RequestMapping("/v1/agreements")
public class AgreementsController {

    private static final Logger log = LoggerFactory.getLogger(AgreementsController.class);

    private final OutstandingAgreementsService outstanding;

    public AgreementsController(OutstandingAgreementsService outstanding) {
        this.outstanding = outstanding;
    }

    @GetMapping("/outstanding/{customerId}")
    public ResponseEntity<List<OutstandingAgreement>> outstanding(@PathVariable long customerId) {
        return ResponseEntity.ok(outstanding.forCustomer(customerId));
    }

    /**
     * Placeholder until the aggregate coverage endpoint lands (CP-52153); returns 501 meanwhile.
     */
    @GetMapping("/coverage")
    public ResponseEntity<Map<String, Object>> coverage(
            @RequestParam(required = false) Integer agreementTypeId,
            @RequestParam(required = false) String version) {
        log.warn("coverage requested before implementation: type={} version={}", agreementTypeId, version);
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED)
                .body(Map.of(
                        "error", "not_implemented",
                        "message", "Aggregate coverage is not available yet",
                        "ticket", "CP-52153"));
    }

    @GetMapping("/types")
    public ResponseEntity<List<AgreementType>> types() {
        return ResponseEntity.ok(outstanding.activeTypes());
    }
}
`;

const AGREEMENTS_CONTROLLER_AFTER = `package com.plexus.customer.agreements;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Agreement reads used by customer-portal and the terms gate. */
@RestController
@RequestMapping("/v1/agreements")
public class AgreementsController {

    private static final Logger log = LoggerFactory.getLogger(AgreementsController.class);

    private final OutstandingAgreementsService outstanding;

    public AgreementsController(OutstandingAgreementsService outstanding) {
        this.outstanding = outstanding;
    }

    @GetMapping("/outstanding/{customerId}")
    public ResponseEntity<List<OutstandingAgreement>> outstanding(@PathVariable long customerId) {
        return ResponseEntity.ok(outstanding.forCustomer(customerId));
    }

    @GetMapping("/types")
    public ResponseEntity<List<AgreementType>> types() {
        return ResponseEntity.ok(outstanding.activeTypes());
    }
}
`;

function coverageController(key: string): string {
  return `package com.plexus.customer.agreements.coverage;

import io.micrometer.core.annotation.Timed;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * ${key}: GET /v1/agreements/coverage, aggregate acceptance coverage per agreement version.
 * Read-only. The gateway authenticates and forwards; the Legal role is enforced on the portal
 * route and by the Istio authorization policy for this service.
 */
@Validated
@RestController
@RequestMapping("/v1/agreements/coverage")
public class CoverageController {

    private static final Logger log = LoggerFactory.getLogger(CoverageController.class);

    private final CoverageQuery query;

    public CoverageController(CoverageQuery query) {
        this.query = query;
    }

    @GetMapping
    @Timed(value = "agreements.coverage", percentiles = {0.95, 0.99})
    public ResponseEntity<CoverageResponse> coverage(
            @RequestParam(required = false) @Positive Integer agreementTypeId,
            @RequestParam(required = false) @Pattern(regexp = "^\\\\d{4}\\\\.\\\\d+$") String version) {
        CoverageResponse body = query.run(new CoverageQuery.Filter(
                Optional.ofNullable(agreementTypeId), Optional.ofNullable(version)));
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .body(body);
    }

    /** AAD failure behavior: no figures rather than partial or stale ones. */
    @ExceptionHandler(QueryTimeoutException.class)
    public ProblemDetail timeout(QueryTimeoutException e) {
        log.warn("agreements.coverage timed out after {} ms", CoverageRepository.TIMEOUT.toMillis(), e);
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.SERVICE_UNAVAILABLE, "Coverage figures are temporarily unavailable");
        problem.setProperty("retryable", true);
        return problem;
    }
}
`;
}

const COVERAGE_QUERY = `package com.plexus.customer.agreements.coverage;

import io.micrometer.core.instrument.MeterRegistry;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Builds the coverage response from the T-1 query: derives notAcceptedCount and coveragePercent
 * and stamps asOf, so a figure read during a dispute is either current or visibly absent.
 */
@Service
public class CoverageQuery {

    private static final Logger log = LoggerFactory.getLogger(CoverageQuery.class);

    public record Filter(Optional<Integer> agreementTypeId, Optional<String> version) {

        public static Filter none() {
            return new Filter(Optional.empty(), Optional.empty());
        }
    }

    private final CoverageRepository repository;
    private final Clock clock;
    private final MeterRegistry meters;

    public CoverageQuery(CoverageRepository repository, Clock clock, MeterRegistry meters) {
        this.repository = repository;
        this.clock = clock;
        this.meters = meters;
    }

    public CoverageResponse run(Filter filter) {
        Instant asOf = Instant.now(clock);
        List<CoverageRepository.Row> rows = repository.fetch(
                filter.agreementTypeId().orElse(null), filter.version().orElse(null));
        List<CoverageResponse.Item> items = rows.stream().map(CoverageQuery::toItem).toList();
        meters.counter("agreements.coverage.rows").increment(items.size());
        log.info("agreements.coverage filter={} rows={} asOf={}", filter, items.size(), asOf);
        return new CoverageResponse(items, asOf);
    }

    static CoverageResponse.Item toItem(CoverageRepository.Row row) {
        long notAccepted = Math.max(0, row.requiredCount() - row.acceptedCount());
        return new CoverageResponse.Item(
                row.agreementTypeId(),
                row.description(),
                row.version(),
                row.countryCode(),
                row.stateProvince(),
                row.requiredCount(),
                row.acceptedCount(),
                notAccepted,
                percent(row.acceptedCount(), row.requiredCount()));
    }

    /** acceptedCount / requiredCount to one decimal; 0 when nobody is required to accept. */
    static BigDecimal percent(long accepted, long required) {
        if (required <= 0) {
            return BigDecimal.ZERO.setScale(1);
        }
        return BigDecimal.valueOf(accepted)
                .multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(required), 1, RoundingMode.HALF_UP);
    }
}
`;

const COVERAGE_REPOSITORY = `package com.plexus.customer.agreements.coverage;

import java.time.Duration;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/** Runs CoverageSql against ThatOtherGuy with a hard timeout (bounded PROD load). */
@Repository
public class CoverageRepository {

    static final Duration TIMEOUT = Duration.ofSeconds(10);

    public record Row(
            int agreementTypeId,
            String description,
            String version,
            String countryCode,
            String stateProvince,
            long requiredCount,
            long acceptedCount) {
    }

    private static final RowMapper<Row> MAPPER = (rs, i) -> new Row(
            rs.getInt("agreement_type_id"),
            rs.getString("description"),
            rs.getString("version"),
            rs.getString("country_code"),
            rs.getString("state_province"),
            rs.getLong("required_count"),
            rs.getLong("accepted_count"));

    private final NamedParameterJdbcTemplate jdbc;

    public CoverageRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
        JdbcTemplate template = jdbc.getJdbcTemplate();
        template.setQueryTimeout((int) TIMEOUT.toSeconds());
    }

    public List<Row> fetch(Integer agreementTypeId, String version) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("agreementTypeId", agreementTypeId)
                .addValue("version", version);
        return jdbc.query(CoverageSql.QUERY, params, MAPPER);
    }
}
`;

const COVERAGE_RESPONSE = `package com.plexus.customer.agreements.coverage;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Response of GET /v1/agreements/coverage; fields follow the api-contracts spec (T-2). */
public record CoverageResponse(List<Item> items, Instant asOf) {

    public record Item(
            int agreementTypeId,
            String description,
            String version,
            String countryCode,
            String stateProvince,
            long requiredCount,
            long acceptedCount,
            long notAcceptedCount,
            BigDecimal coveragePercent) {
    }
}
`;

function coverageQueryTest(rows: number): string {
  const base = [
    "101, 2026.2, 48212, 44903, 93.1",
    "102, 2026.1, 48212, 45870, 95.1",
    "103, 2026.3, 48212, 39118, 81.1",
    "104, 2026.2, 1902, 1640, 86.2",
  ];
  const extra: string[] = [];
  for (let i = 0; extra.length < rows - base.length; i++) {
    const required = 1000 + ((i * 7919) % 49000);
    const accepted = Math.floor((required * (40 + ((i * 37) % 61))) / 100);
    const pct = Math.round((accepted * 1000) / required) / 10;
    extra.push(`${110 + i}, 2026.${1 + (i % 3)}, ${required}, ${accepted}, ${pct.toFixed(1)}`);
  }
  const csv = [...base, ...extra].slice(0, rows).map((r, i, a) => `            "${r}"${i < a.length - 1 ? "," : ""}`).join("\n");
  return `package com.plexus.customer.agreements.coverage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class CoverageQueryTest {

    private static final Instant NOW = Instant.parse("2026-09-29T13:58:04Z");

    private final CoverageRepository repository = mock(CoverageRepository.class);
    private final CoverageQuery query =
            new CoverageQuery(repository, Clock.fixed(NOW, ZoneOffset.UTC), new SimpleMeterRegistry());

    @Test
    @DisplayName("AC-1: returns the contract fields for every active agreement version")
    void returnsContractFields() {
        when(repository.fetch(isNull(), isNull())).thenReturn(List.of(
                row(101, "Brand Ambassador Agreement", "2026.2", 48212, 44903),
                row(102, "Policies & Procedures", "2026.1", 48212, 45870)));

        CoverageResponse response = query.run(CoverageQuery.Filter.none());

        assertThat(response.asOf()).isEqualTo(NOW);
        assertThat(response.items()).hasSize(2).first().satisfies(item -> {
            assertThat(item.agreementTypeId()).isEqualTo(101);
            assertThat(item.countryCode()).isEqualTo("US");
            assertThat(item.notAcceptedCount()).isEqualTo(3309);
            assertThat(item.coveragePercent()).isEqualByComparingTo("93.1");
        });
    }

    @ParameterizedTest(name = "type {0} v{1}: {3}/{2} = {4}%")
    @DisplayName("AC-2: coveragePercent is accepted / required to one decimal")
    @CsvSource({
${csv}
    })
    void coveragePercentToOneDecimal(int typeId, String version, long required, long accepted, String expected) {
        assertThat(CoverageQuery.percent(accepted, required)).isEqualByComparingTo(expected);
    }

    @Test
    @DisplayName("AC-2: coveragePercent is 0 when nobody is required to accept")
    void zeroRequiredIsZeroPercent() {
        assertThat(CoverageQuery.percent(0, 0)).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("AC-3: filters are passed to the repository")
    void filtersNarrowTheResult() {
        when(repository.fetch(101, "2026.2")).thenReturn(List.of(row(101, "Brand Ambassador Agreement", "2026.2", 48212, 44903)));

        CoverageResponse response = query.run(new CoverageQuery.Filter(Optional.of(101), Optional.of("2026.2")));

        assertThat(response.items()).extracting(CoverageResponse.Item::version).containsExactly("2026.2");
    }

    @Test
    @DisplayName("AC-3: unknown filter values return an empty list")
    void unknownFilterIsEmptyNotError() {
        when(repository.fetch(any(), any())).thenReturn(List.of());

        CoverageResponse response = query.run(new CoverageQuery.Filter(Optional.of(999), Optional.empty()));

        assertThat(response.items()).isEmpty();
        assertThat(response.asOf()).isEqualTo(NOW);
    }

    @Test
    void notAcceptedIsNeverNegative() {
        CoverageResponse.Item item = CoverageQuery.toItem(
                new CoverageRepository.Row(105, "Privacy Policy", "2026.3", "US", null, 10, 12));

        assertThat(item.notAcceptedCount()).isZero();
    }

    private static CoverageRepository.Row row(int id, String description, String version, long required, long accepted) {
        return new CoverageRepository.Row(id, description, version, "US", null, required, accepted);
    }
}
`;
}

const COVERAGE_CONTRACT = `# Vendored from api-contracts (T-2) for the contract tests; regenerate with ./gradlew syncContracts.
openapi: 3.1.0
info:
  title: Agreement coverage
  version: 1.0.0
paths:
  /v1/agreements/coverage:
    get:
      operationId: getAgreementCoverage
      parameters:
        - { name: agreementTypeId, in: query, required: false, schema: { type: integer, minimum: 1 } }
        - { name: version, in: query, required: false, schema: { type: string, pattern: '^\\d{4}\\.\\d+$' } }
      responses:
        '200':
          description: Coverage per active agreement version
          content:
            application/json:
              schema:
                type: object
                required: [items, asOf]
                properties:
                  asOf: { type: string, format: date-time }
                  items:
                    type: array
                    items:
                      type: object
                      required: [agreementTypeId, description, version, requiredCount, acceptedCount, notAcceptedCount, coveragePercent]
                      properties:
                        agreementTypeId: { type: integer }
                        description: { type: string }
                        version: { type: string }
                        countryCode: { type: [string, 'null'] }
                        stateProvince: { type: [string, 'null'] }
                        requiredCount: { type: integer, minimum: 0 }
                        acceptedCount: { type: integer, minimum: 0 }
                        notAcceptedCount: { type: integer, minimum: 0 }
                        coveragePercent: { type: number, minimum: 0, maximum: 100 }
        '400':
          description: Invalid filter value
        '401':
          description: Missing or invalid token
        '503':
          description: Figures temporarily unavailable; no partial data is returned
`;

/** Brief F.5: +412 -18 in 7 files. The parameterized-test table is sized to land exactly on it. */
const T4_ADDS = 412;

function t4(task: RunTask): TaskImpl {
  const key = task.jiraKey ?? task.id;
  const fixed: FileSpec[] = [
    { path: `${PKG}/coverage/CoverageController.java`, after: coverageController(key) },
    { path: `${PKG}/coverage/CoverageQuery.java`, after: COVERAGE_QUERY },
    { path: `${PKG}/coverage/CoverageRepository.java`, after: COVERAGE_REPOSITORY },
    { path: `${PKG}/coverage/CoverageResponse.java`, after: COVERAGE_RESPONSE },
    { path: "api-contracts/agreements/coverage.yaml", after: COVERAGE_CONTRACT },
    { path: `${PKG}/AgreementsController.java`, before: AGREEMENTS_CONTROLLER_BEFORE, after: AGREEMENTS_CONTROLLER_AFTER },
  ];
  const measure = (rows: number) => {
    const tree = new WorkingTree([...fixed, { path: `${TPKG}/coverage/CoverageQueryTest.java` }]);
    for (const f of fixed) if (f.after !== undefined) tree.write(f.path, f.after);
    tree.write(`${TPKG}/coverage/CoverageQueryTest.java`, coverageQueryTest(rows));
    return totals(diffStats(tree.diff())).adds;
  };
  const rows = 4 + (T4_ADDS - measure(4));
  const test = { path: `${TPKG}/coverage/CoverageQueryTest.java`, after: coverageQueryTest(Math.max(4, rows)) };
  const files = [fixed[0], fixed[1], fixed[2], fixed[3], test, fixed[4], fixed[5]];
  return {
    summary: `Implemented GET /v1/agreements/coverage in customer-service-v2: CoverageController with validated filters and a 503 problem response on timeout, CoverageQuery deriving notAcceptedCount, coveragePercent and asOf, CoverageRepository over the T-1 query with a 10 s timeout, and removed the 501 placeholder from AgreementsController.`,
    notes: [
      "coveragePercent uses BigDecimal HALF_UP to one decimal so the portal and the CSV export print the same figure.",
      "Cache-Control: no-store keeps intermediaries from serving yesterday's figures as current.",
      "The contract is vendored under api-contracts/ for the contract tests; T-2 remains the source of truth.",
    ],
    files,
    primaryFile: `${PKG}/coverage/CoverageController.java`,
    acCoverage: {
      "AC-1": "CoverageQueryTest.returnsContractFields + contract test getAgreementCoverage",
      "AC-2": "CoverageQueryTest.coveragePercentToOneDecimal, zeroRequiredIsZeroPercent",
      "AC-3": "CoverageQueryTest.filtersNarrowTheResult, unknownFilterIsEmptyNotError",
      "AC-4": "CoverageController.timeout (503 problem) + contractTest p95 latency",
    },
    // 42 tests in total after the change (brief F.5): 36 existing + 6 new (5 @Test, 1 parameterized).
    baseTests: 36,
    checks: {
      unit: {
        output: `> Task :compileTestJava
> Task :test

CoverageQueryTest > AC-1: returns the contract fields for every active agreement version PASSED
CoverageQueryTest > AC-2: coveragePercent is accepted / required to one decimal PASSED
CoverageQueryTest > AC-2: coveragePercent is 0 when nobody is required to accept PASSED
CoverageQueryTest > AC-3: filters are passed to the repository PASSED
CoverageQueryTest > AC-3: unknown filter values return an empty list PASSED
CoverageQueryTest > notAcceptedIsNeverNegative() PASSED

Tests: 42 passed, 42 total
BUILD SUCCESSFUL in 41s`,
        summary: "42 passed, 42 total",
      },
      contract: {
        output: `> Task :contractTest

ContractVerifierTest > validate_getAgreementCoverage_200() PASSED
ContractVerifierTest > validate_getAgreementCoverage_400_badVersion() PASSED
ContractVerifierTest > validate_getAgreementCoverage_503_timeout() PASSED
Latency (Testcontainers, 48,212 ambassadors x 4 agreements, 200 requests): p50 96 ms, p95 180 ms, p99 241 ms

BUILD SUCCESSFUL in 1m 12s`,
        summary: "3 contract cases passed; p95 180 ms (budget 500 ms)",
        metric: { name: "p95 latency", actual: 180, expected: 500, unit: "ms" },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// T-5: gateway route; the first version re-signs the token, review asks to forward it unchanged
// ---------------------------------------------------------------------------------------------

function t5(task: RunTask): TaskImpl {
  const impl = gatewayImpl(task, { name: "AgreementCoverage", path: "/v1/agreements/coverage", resign: true });
  return {
    ...impl,
    summary:
      "Added the agreement-coverage route to api-gateway: GET /v1/agreements/coverage -> customer-service-v2 with Okta JWT authentication, a 30 s timeout, a per-client rate limit and a jwt-resign policy issuing a short-lived gateway token for the upstream.",
    notes: [
      "The upstream call carries a gateway-issued token (jwt-resign, 60 s TTL) instead of the caller's Okta token.",
      "No domain logic at the gateway; filters are forwarded as query parameters.",
    ],
    rework: (tree, cycle, feedback) => {
      if (!/bearer|token|re-?sign/i.test(feedback)) return undefined;
      tree.replace(
        "routes/agreements.yaml",
        `    policies:
      - jwt-resign:
          issuer: api-gateway
          audience: customer-service-v2
          ttl: 60s`,
        `    policies:
      # Forward the caller's Okta bearer token unchanged; the service validates it (review ${cycle}).
      - forward-headers: [authorization, x-request-id]`,
      );
      tree.insertBeforeLast(
        "test/routes/agreement-coverage.test.ts",
        "});",
        `
  it('forwards the Okta bearer token unchanged', async () => {
    const token = oktaToken('Legal-Compliance');
    await gateway.get('/v1/agreements/coverage').set('authorization', \`Bearer \${token}\`);
    expect(upstreamCalls('customer-service-v2')[0].headers.authorization).toBe(\`Bearer \${token}\`);
  });

  it('does not mint a gateway token for this route', async () => {
    await gateway.get('/v1/agreements/coverage').set('authorization', \`Bearer \${oktaToken('Legal-Compliance')}\`);
    expect(upstreamCalls('customer-service-v2')[0].headers['x-gateway-issuer']).toBeUndefined();
  });`,
      );
      return { summary: "Removed the jwt-resign policy; the route now forwards the Okta bearer token unchanged, with two tests proving it", primaryFile: "routes/agreements.yaml" };
    },
  };
}

// ---------------------------------------------------------------------------------------------

export function agrImpl(task: RunTask): TaskImpl | undefined {
  const title = stripScope(task.title).toLowerCase();
  switch (task.id) {
    case "T-1":
      if (title.includes("coverage query")) return t1();
      break;
    case "T-2":
      return templateImpl(task, { name: "Coverage", path: "/v1/agreements/coverage", fault: null });
    case "T-3":
      return templateImpl(task, { kind: "flag", flag: "agreement-progress-page", fault: null });
    case "T-4":
      if (title.includes("coverage endpoint")) return t4(task);
      break;
    case "T-5":
      if (task.repo === "api-gateway") return t5(task);
      break;
    case "T-6":
      return templateImpl(task, { kind: "page", name: "AgreementProgress", api: "/v1/agreements/coverage", fault: "lint" });
    case "T-7":
      return templateImpl(task, { kind: "guard", name: "LegalRole", fault: null });
    case "T-8":
      return templateImpl(task, { kind: "page", name: "CoverageFilters", api: "/v1/agreements/coverage", fault: null });
    case "T-9":
      return templateImpl(task, { name: "AgreementProgress", url: "/agreements/progress", fault: null });
  }
  return undefined;
}
