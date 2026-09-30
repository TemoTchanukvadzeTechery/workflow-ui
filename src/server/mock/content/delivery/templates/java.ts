import "server-only";
/**
 * customer-service-v2 (Spring Boot, layered controller/service/repository per the legacy-migration
 * AAD conventions): a read-only endpoint with its service, repository, row/response records, a
 * JUnit 5 test per acceptance criterion and an application.yml tweak.
 */
import { clip, featureName, plural, stripScope } from "@/server/mock/workflows/delivery-lib/util";
import type { Fault, RunTask, TaskImpl } from "../types";
import { domainFor, type Domain } from "./domain";
import { jstr, testName } from "./repos";

export interface JavaOpts {
  name?: string;
  pkg?: string;
  /** The vocabulary to write in; defaults to the agreements one (or a neutral one for another pkg). */
  domain?: Domain;
  path?: string;
  /** Which check the first implementation trips, if any. */
  fault?: Fault["check"];
  baseTests?: number;
}

const ROOT = "src/main/java/com/plexus/customer";
const TEST_ROOT = "src/test/java/com/plexus/customer";

export const APPLICATION_YML = `spring:
  application:
    name: customer-service-v2
  datasource:
    url: \${THAT_OTHER_GUY_JDBC_URL}
    hikari:
      maximum-pool-size: 20
      connection-timeout: 5000

management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  metrics:
    distribution:
      percentiles-histogram:
        http.server.requests: true

agreements:
  provisioning:
    contentful-webhook-enabled: true
  outstanding:
    cache-ttl: PT5M
`;

/** Varied but plausible test bodies, one per acceptance criterion. */
function testBody(i: number, n: string, d: Domain): string {
  const bodies = [
    `        when(repository.fetch(null, null)).thenReturn(List.of(row(101, "2026.2", 48212, 44903)));

        ${n}Response result = service.load(null, null);

        assertThat(result.items()).singleElement().satisfies(item -> {
            assertThat(item.${d.total}()).isEqualTo(48212);
            assertThat(item.${d.done}()).isEqualTo(44903);
            assertThat(item.${d.open}()).isEqualTo(3309);
        });`,
    `        when(repository.fetch(101, "2026.2")).thenReturn(List.of(row(101, "2026.2", 48212, 44903)));

        ${n}Response result = service.load(101, "2026.2");

        assertThat(result.items()).extracting(${n}Response.Item::${d.idParam}).containsExactly(101);
        verify(repository).fetch(101, "2026.2");`,
    `        when(repository.fetch(null, null)).thenReturn(List.of(row(103, "2026.3", 48212, 39118)));

        ${n}Response result = service.load(null, null);

        assertThat(result.items().get(0).${d.pct}()).isEqualTo(81.1);`,
    `        when(repository.fetch(null, null)).thenReturn(List.of(row(104, "2026.2", 0, 0)));

        ${n}Response result = service.load(null, null);

        assertThat(result.items().get(0).${d.pct}()).isZero();
        assertThat(result.asOf()).isEqualTo(NOW);`,
    `        when(repository.fetch(null, "1999.1")).thenReturn(List.of());

        ${n}Response result = service.load(null, "1999.1");

        assertThat(result.items()).isEmpty();
        assertThat(result.asOf()).isEqualTo(NOW);`,
  ];
  return bodies[i % bodies.length];
}

export function javaImpl(task: RunTask, opts: JavaOpts = {}): TaskImpl {
  const n = opts.name ?? featureName(stripScope(task.title));
  const d = opts.domain ?? domainFor(opts.pkg);
  const pkg = d.pkg;
  // Parameter names of percent(): "accepted"/"required" in the agreements vocabulary.
  const doneVar = d.done.replace(/Count$/, "");
  const totalVar = d.total.replace(/Count$/, "");
  const lower = n[0].toLowerCase() + n.slice(1);
  const path = opts.path ?? `/v1/${pkg}/${n.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;
  const key = task.jiraKey ?? task.id;
  const dir = `${ROOT}/${pkg}`;
  const tdir = `${TEST_ROOT}/${pkg}`;
  const metric = `${pkg}.${n.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}`;

  const controller = `package com.plexus.customer.${pkg};

import io.micrometer.core.annotation.Timed;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** ${key}: ${stripScope(task.title)}. Read-only; the gateway authenticates and forwards. */
@RestController
@RequestMapping("${path}")
public class ${n}Controller {

    private final ${n}Service service;

    public ${n}Controller(${n}Service service) {
        this.service = service;
    }

    @GetMapping
    @Timed(value = "${metric}", percentiles = {0.95})
    public ResponseEntity<${n}Response> get(
            @RequestParam(required = false) Integer ${d.idParam},
            @RequestParam(required = false) String version) {
        return ResponseEntity.ok(service.load(${d.idParam}, version));
    }
}
`;

  const service = `package com.plexus.customer.${pkg};

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * ${key}: ${clip(stripScope(task.title), 90)}.
 * Set-based reads only: no per-customer fan-out, bounded load on the PROD database.
 */
@Service
public class ${n}Service {

    private static final Logger log = LoggerFactory.getLogger(${n}Service.class);

    private final ${n}Repository repository;
    private final Clock clock;

    public ${n}Service(${n}Repository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    public ${n}Response load(Integer ${d.idParam}, String version) {
        List<${n}Row> rows = repository.fetch(${d.idParam}, version);
        long total = rows.stream().mapToLong(${n}Row::${d.total}).sum();
        log.info("${lower}.load ${d.idParam}={} version={} rows={} ${totalVar}={}",
                ${d.idParam}, version, rows.size(), total);
        List<${n}Response.Item> items = rows.stream()
                .map(r -> new ${n}Response.Item(
                        r.${d.idParam}(),
                        r.description(),
                        r.version(),
                        r.${d.total}(),
                        r.${d.done}(),
                        r.${d.total}() - r.${d.done}(),
                        percent(r.${d.done}(), r.${d.total}())))
                .toList();
        return new ${n}Response(items, Instant.now(clock));
    }

    static double percent(long ${doneVar}, long ${totalVar}) {
        if (${totalVar} == 0) {
            return 0.0;
        }
        return Math.round(${doneVar} * 1000.0 / ${totalVar}) / 10.0;
    }
}
`;

  const repository = `package com.plexus.customer.${pkg};

import java.util.List;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ${n}Repository {

    private static final String SQL = """
${d.sql(n)}
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public ${n}Repository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<${n}Row> fetch(Integer ${d.idParam}, String version) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("${d.idParam}", ${d.idParam})
                .addValue("version", version);
        return jdbc.query(SQL, params, (rs, i) -> new ${n}Row(
                rs.getInt("${d.idCol}"),
                rs.getString("description"),
                rs.getString("version"),
                rs.getLong("${d.totalCol}"),
                rs.getLong("${d.doneCol}")));
    }
}
`;

  const row = `package com.plexus.customer.${pkg};

record ${n}Row(int ${d.idParam}, String description, String version, long ${d.total}, long ${d.done}) {
}
`;

  const response = `package com.plexus.customer.${pkg};

import java.time.Instant;
import java.util.List;

public record ${n}Response(List<Item> items, Instant asOf) {

    public record Item(
            int ${d.idParam},
            String description,
            String version,
            long ${d.total},
            long ${d.done},
            long ${d.open},
            double ${d.pct}) {
    }
}
`;

  const acs = task.acceptanceCriteria.length ? task.acceptanceCriteria : [{ id: "AC-1", text: "returns the expected figures" }];
  const coverage: Record<string, string> = {};
  const tests = acs
    .map((ac, i) => {
      const m = testName(ac.text);
      coverage[ac.id] = `${n}ServiceTest.${m}`;
      return `    @Test
    @DisplayName(${jstr(`${ac.id}: ${clip(ac.text, 80)}`)})
    void ${m}() {
${testBody(i, n, d)}
    }`;
    })
    .join("\n\n");
  const test = `package com.plexus.customer.${pkg};

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ${n}ServiceTest {

    private static final Instant NOW = Instant.parse("2026-09-29T13:58:04Z");

    private final ${n}Repository repository = mock(${n}Repository.class);
    private final ${n}Service service = new ${n}Service(repository, Clock.fixed(NOW, ZoneOffset.UTC));

${tests}

    @Test
    void emptyResultIsNotAnError() {
${testBody(4, n, d)}
    }

    private static ${n}Row row(int typeId, String version, long ${totalVar}, long ${doneVar}) {
        return new ${n}Row(typeId, ${jstr(d.samples[0])}, version, ${totalVar}, ${doneVar});
    }
}
`;

  const settings = `  ${lower}:\n    query-timeout: PT10S\n    max-rows: 5000\n`;
  const yml = (
    d.yamlRoot === "agreements"
      ? APPLICATION_YML.replace("  outstanding:\n    cache-ttl: PT5M\n", `  outstanding:\n    cache-ttl: PT5M\n${settings}`)
      : `${APPLICATION_YML}\n${d.yamlRoot}:\n${settings}`
  ).replace("include: health,info,prometheus", "include: health,info,prometheus,metrics");

  const faults: Record<string, Fault> = {
    unit: {
      check: "unit",
      path: `${dir}/${n}Service.java`,
      correct: `        return Math.round(${doneVar} * 1000.0 / ${totalVar}) / 10.0;`,
      broken: `        return Math.round(${doneVar} * 100.0 / ${totalVar}) / 10.0;`,
      message: `${n}ServiceTest > ${d.pct.replace(/([A-Z])/g, " $1").toLowerCase()} expected 81.1 but was 8.1`,
      output: `> Task :test FAILED

${n}ServiceTest > ${coverage[acs[Math.min(2, acs.length - 1)].id]?.split(".")[1] ?? "coverage"}() FAILED
    org.opentest4j.AssertionFailedError:
    expected: 81.1
     but was: 8.1
        at ${n}Service.percent(${n}Service.java:{line})

Tests: 1 failed, ${acs.length} passed, ${acs.length + 1} total
BUILD FAILED in 34s`,
      fixSummary: `Fixed the ${d.pct.replace(/Percent$/, "")} percentage rounding in ${n}Service.percent (x1000 / 10, one decimal).`,
    },
    lint: {
      check: "lint",
      path: `${dir}/${n}Service.java`,
      correct: `        if (${totalVar} == 0) {`,
      broken: `        if(${totalVar} == 0) {`,
      message: `spotlessJavaCheck: ${n}Service.java has format violations`,
      output: `> Task :spotlessJavaCheck FAILED
The following files had format violations:
    ${dir}/${n}Service.java
        @@ -{line},1 +{line},1 @@
        -        if(${totalVar} == 0) {
        +        if (${totalVar} == 0) {
Run './gradlew :spotlessApply' to fix these violations.
BUILD FAILED in 9s`,
      fixSummary: `Applied spotless formatting to ${n}Service.java.`,
    },
    typecheck: {
      check: "typecheck",
      path: `${dir}/${n}Service.java`,
      correct: `        long total = rows.stream().mapToLong(${n}Row::requiredCount).sum();`,
      broken: `        int total = rows.stream().mapToLong(${n}Row::requiredCount).sum();`,
      message: `${n}Service.java:{line}: error: incompatible types: possible lossy conversion from long to int`,
      output: `> Task :compileJava FAILED
${dir}/${n}Service.java:{line}: error: incompatible types: possible lossy conversion from long to int
        int total = rows.stream().mapToLong(${n}Row::requiredCount).sum();
                                                                         ^
1 error
BUILD FAILED in 12s`,
      fixSummary: `Declared the population total in ${n}Service as long (sums of long counts).`,
    },
  };

  return {
    summary: `Added ${path} to ${task.repo || "customer-service-v2"}: ${n}Controller, ${n}Service and ${n}Repository with a set-based query, response records and ${plural(acs.length + 1, "unit test")}.`,
    notes: [
      "The query is set-based and filtered on IsActive = 1, per the AAD's PROD-load constraint.",
      `Query timeout and a row cap are configurable under ${d.yamlRoot}.${lower} in application.yml.`,
    ],
    files: [
      { path: `${dir}/${n}Controller.java`, after: controller },
      { path: `${dir}/${n}Service.java`, after: service },
      { path: `${dir}/${n}Repository.java`, after: repository },
      { path: `${dir}/${n}Row.java`, after: row },
      { path: `${dir}/${n}Response.java`, after: response },
      { path: `${tdir}/${n}ServiceTest.java`, after: test },
      { path: "src/main/resources/application.yml", before: APPLICATION_YML, after: yml },
    ],
    primaryFile: `${dir}/${n}Service.java`,
    acCoverage: coverage,
    fault: opts.fault ? faults[opts.fault] : undefined,
    baseTests: opts.baseTests ?? 36,
  };
}

/** Generic Java rework: a regression test named after the feedback plus a guard in the service. */
export function javaReworkTest(name: string, cycle: number, feedback: string, d: Domain = domainFor()): string {
  return `
    @Test
    @DisplayName(${jstr(`Review follow-up ${cycle}: ${clip(feedback, 70)}`)})
    void reviewFollowUp${cycle}() {
        when(repository.fetch(null, null)).thenReturn(List.of(row(101, "2026.2", 48212, 44903)));

        ${name}Response result = service.load(null, null);

        assertThat(result.items()).allSatisfy(item -> assertThat(item.${d.open}()).isNotNegative());
    }`;
}
