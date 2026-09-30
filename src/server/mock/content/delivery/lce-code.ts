import "server-only";
/**
 * LCE implementation content. T-4 (CP-52204) is the loop-back story: the first version caps the
 * row count and wraps the response in StreamingResponseBody but still loads every row before
 * writing, so QA finds that a 120,000-row export times out at the 30 s gateway limit; the QA
 * rework streams rows from the database cursor.
 */
import { stripScope } from "@/server/mock/workflows/delivery-lib/util";
import { angularImpl } from "./templates/angular";
import { templateImpl } from "./templates";
import { APPLICATION_YML } from "./templates/java";
import type { RunTask, TaskImpl } from "./types";

const PKG = "src/main/java/com/plexus/customer/agreements/coverage";
const TPKG = "src/test/java/com/plexus/customer/agreements/coverage";

// ---------------------------------------------------------------------------------------------
// T-1: CSV export endpoint
// ---------------------------------------------------------------------------------------------

const CSV_WRITER = `package com.plexus.customer.agreements.coverage;

import java.io.IOException;
import java.io.Writer;
import java.util.List;

/** Writes coverage rows as RFC 4180 CSV with the same columns as the portal table. */
public final class CoverageCsvWriter {

    static final List<String> HEADER = List.of(
            "agreementTypeId", "description", "version", "countryCode", "stateProvince",
            "requiredCount", "acceptedCount", "notAcceptedCount", "coveragePercent", "asOf");

    private final Writer out;

    public CoverageCsvWriter(Writer out) {
        this.out = out;
    }

    public void header() throws IOException {
        out.write(String.join(",", HEADER));
        out.write("\\r\\n");
    }

    public void row(CoverageResponse.Item item, String asOf) throws IOException {
        out.write(String.join(",",
                String.valueOf(item.agreementTypeId()),
                quote(item.description()),
                quote(item.version()),
                quote(item.countryCode()),
                quote(item.stateProvince()),
                String.valueOf(item.requiredCount()),
                String.valueOf(item.acceptedCount()),
                String.valueOf(item.notAcceptedCount()),
                item.coveragePercent().toPlainString(),
                asOf));
        out.write("\\r\\n");
    }

    static String quote(String value) {
        if (value == null) {
            return "";
        }
        return value.contains(",") || value.contains("\\"") || value.contains("\\n")
                ? "\\"" + value.replace("\\"", "\\"\\"") + "\\""
                : value;
    }
}
`;

function exportControllerV1(key: string): string {
  return `package com.plexus.customer.agreements.coverage;

import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/** ${key}: GET /v1/agreements/coverage/export?format=csv, the coverage table as CSV. */
@RestController
@RequestMapping("/v1/agreements/coverage/export")
public class CoverageExportController {

    private final CoverageQuery query;

    public CoverageExportController(CoverageQuery query) {
        this.query = query;
    }

    @GetMapping(params = "format=csv", produces = "text/csv")
    public ResponseEntity<StreamingResponseBody> csv(
            @RequestParam(required = false) Integer agreementTypeId,
            @RequestParam(required = false) String version) {
        CoverageResponse response = query.run(new CoverageQuery.Filter(
                Optional.ofNullable(agreementTypeId), Optional.ofNullable(version)));
        String asOf = response.asOf().toString();
        String file = "agreement-coverage-" + LocalDate.ofInstant(response.asOf(), ZoneOffset.UTC) + ".csv";
        StreamingResponseBody body = out -> {
            Writer writer = new OutputStreamWriter(out, StandardCharsets.UTF_8);
            CoverageCsvWriter csv = new CoverageCsvWriter(writer);
            csv.header();
            for (CoverageResponse.Item item : response.items()) {
                csv.row(item, asOf);
            }
            writer.flush();
        };
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\\"" + file + "\\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .contentType(MediaType.parseMediaType("text/csv; charset=utf-8"))
                .body(body);
    }
}
`;
}

const CSV_WRITER_TEST = `package com.plexus.customer.agreements.coverage;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.StringWriter;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class CoverageCsvWriterTest {

    private final StringWriter out = new StringWriter();
    private final CoverageCsvWriter csv = new CoverageCsvWriter(out);

    @Test
    @DisplayName("AC-1: header lists the coverage columns")
    void headerListsCoverageColumns() throws Exception {
        csv.header();

        assertThat(out.toString()).startsWith("agreementTypeId,description,version,countryCode,stateProvince,");
    }

    @Test
    @DisplayName("AC-3: a row carries the same figures as the JSON endpoint")
    void rowMatchesJsonFigures() throws Exception {
        csv.row(item("Brand Ambassador Agreement"), "2026-09-29T13:58:04Z");

        assertThat(out.toString()).isEqualTo(
                "101,Brand Ambassador Agreement,2026.2,US,,48212,44903,3309,93.1,2026-09-29T13:58:04Z\\r\\n");
    }

    @Test
    void quotesValuesWithCommas() throws Exception {
        csv.row(item("Policies, Procedures"), "2026-09-29T13:58:04Z");

        assertThat(out.toString()).contains("\\"Policies, Procedures\\"");
    }

    private static CoverageResponse.Item item(String description) {
        return new CoverageResponse.Item(101, description, "2026.2", "US", null, 48212, 44903, 3309, new BigDecimal("93.1"));
    }
}
`;

function t1(task: RunTask): TaskImpl {
  const key = task.jiraKey ?? task.id;
  const yml = APPLICATION_YML.replace(
    "  outstanding:\n    cache-ttl: PT5M\n",
    "  outstanding:\n    cache-ttl: PT5M\n  coverage-export:\n    enabled: true\n",
  );
  return {
    summary:
      "Added GET /v1/agreements/coverage/export?format=csv to customer-service-v2: CoverageExportController returning text/csv with a dated attachment name, and CoverageCsvWriter (RFC 4180 quoting, same columns as the portal table).",
    notes: ["The export reuses CoverageQuery, so CSV and JSON figures cannot drift apart."],
    files: [
      { path: `${PKG}/CoverageExportController.java`, after: exportControllerV1(key) },
      { path: `${PKG}/CoverageCsvWriter.java`, after: CSV_WRITER },
      { path: `${TPKG}/CoverageCsvWriterTest.java`, after: CSV_WRITER_TEST },
      { path: "src/main/resources/application.yml", before: APPLICATION_YML, after: yml },
    ],
    primaryFile: `${PKG}/CoverageExportController.java`,
    acCoverage: {
      "AC-1": "CoverageCsvWriterTest.headerListsCoverageColumns",
      "AC-2": "CoverageExportControllerContractTest.filtersApplied",
      "AC-3": "CoverageCsvWriterTest.rowMatchesJsonFigures",
    },
    baseTests: 44,
  };
}

// ---------------------------------------------------------------------------------------------
// T-4: row limit and streaming (buggy first version, fixed by the QA loop-back)
// ---------------------------------------------------------------------------------------------

const EXPORT_LIMITS = `package com.plexus.customer.agreements.coverage;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Export guard rails: a hard row cap and the rows written between flushes. */
@ConfigurationProperties("agreements.coverage-export")
public record ExportLimits(boolean enabled, int maxRows, int flushEvery) {

    public ExportLimits {
        if (maxRows <= 0) {
            maxRows = 250_000;
        }
        if (flushEvery <= 0) {
            flushEvery = 1_000;
        }
    }
}
`;

function exportControllerV2(key: string): string {
  return exportControllerV1(key)
    .replace(
      "import org.springframework.http.HttpHeaders;",
      "import org.springframework.http.HttpHeaders;\nimport org.springframework.http.HttpStatus;",
    )
    .replace(
      "    private final CoverageQuery query;\n\n    public CoverageExportController(CoverageQuery query) {\n        this.query = query;\n    }",
      `    private final CoverageQuery query;
    private final CoverageRepository repository;
    private final ExportLimits limits;

    public CoverageExportController(CoverageQuery query, CoverageRepository repository, ExportLimits limits) {
        this.query = query;
        this.repository = repository;
        this.limits = limits;
    }`,
    )
    .replace(
      "        CoverageResponse response = query.run(new CoverageQuery.Filter(\n                Optional.ofNullable(agreementTypeId), Optional.ofNullable(version)));",
      `        long rows = repository.count(agreementTypeId, version);
        if (rows > limits.maxRows()) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .header("X-Export-Rows", String.valueOf(rows))
                    .build();
        }
        // ${key}: rows are loaded, then written in chunks so the client sees progress.
        CoverageResponse response = query.run(new CoverageQuery.Filter(
                Optional.ofNullable(agreementTypeId), Optional.ofNullable(version)));`,
    )
    .replace(
      "            for (CoverageResponse.Item item : response.items()) {\n                csv.row(item, asOf);\n            }",
      `            int written = 0;
            for (CoverageResponse.Item item : response.items()) {
                csv.row(item, asOf);
                if (++written % limits.flushEvery() == 0) {
                    writer.flush();
                }
            }`,
    );
}

const EXPORT_TEST = `package com.plexus.customer.agreements.coverage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class CoverageExportControllerTest {

    private final CoverageQuery query = mock(CoverageQuery.class);
    private final CoverageRepository repository = mock(CoverageRepository.class);
    private final CoverageExportController controller =
            new CoverageExportController(query, repository, new ExportLimits(true, 250_000, 1_000));

    @Test
    @DisplayName("AC-3: more than 250,000 rows is rejected with 413")
    void rejectsExportsOverTheCap() {
        when(repository.count(any(), any())).thenReturn(250_001L);

        assertThat(controller.csv(null, null).getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
    }

    @Test
    @DisplayName("AC-3: the cap itself is allowed")
    void allowsExportsAtTheCap() {
        when(repository.count(any(), any())).thenReturn(250_000L);
        when(query.run(any())).thenReturn(new CoverageResponse(java.util.List.of(), java.time.Instant.EPOCH));

        assertThat(controller.csv(null, null).getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
`;

function t4(task: RunTask): TaskImpl {
  const key = task.jiraKey ?? task.id;
  const before = exportControllerV1(key);
  const yml = APPLICATION_YML.replace(
    "  outstanding:\n    cache-ttl: PT5M\n",
    "  outstanding:\n    cache-ttl: PT5M\n  coverage-export:\n    enabled: true\n",
  );
  const ymlAfter = yml.replace("  coverage-export:\n    enabled: true\n", "  coverage-export:\n    enabled: true\n    max-rows: 250000\n    flush-every: 1000\n");
  return {
    summary:
      "Capped exports at 250,000 rows (413 above the cap, with the row count in X-Export-Rows) and flushed the CSV every 1,000 rows through StreamingResponseBody; limits are configurable under agreements.coverage-export.",
    notes: [
      "The row count is checked with a COUNT query before the export starts, so a rejected export costs one cheap query.",
      "Rows are still read through CoverageQuery before writing; streaming happens on the write side only.",
    ],
    files: [
      { path: `${PKG}/CoverageExportController.java`, before, after: exportControllerV2(key) },
      { path: `${PKG}/ExportLimits.java`, after: EXPORT_LIMITS },
      { path: `${TPKG}/CoverageExportControllerTest.java`, after: EXPORT_TEST },
      { path: "src/main/resources/application.yml", before: yml, after: ymlAfter },
    ],
    primaryFile: `${PKG}/CoverageExportController.java`,
    acCoverage: {
      "AC-1": "CoverageExportController (StreamingResponseBody, flush every 1,000 rows)",
      "AC-2": "pww-automation AgreementExportLargeTest (QA)",
      "AC-3": "CoverageExportControllerTest.rejectsExportsOverTheCap, allowsExportsAtTheCap",
      "AC-4": "QA heap measurement during a 120,000-row export",
    },
    baseTests: 47,
    qaRework: (tree, feedback) => {
      if (!/time[sd]? out|timeout|50k|gateway/i.test(feedback)) return undefined;
      const path = `${PKG}/CoverageExportController.java`;
      tree.replace(
        path,
        `        // ${key}: rows are loaded, then written in chunks so the client sees progress.
        CoverageResponse response = query.run(new CoverageQuery.Filter(
                Optional.ofNullable(agreementTypeId), Optional.ofNullable(version)));
        String asOf = response.asOf().toString();
        String file = "agreement-coverage-" + LocalDate.ofInstant(response.asOf(), ZoneOffset.UTC) + ".csv";`,
        `        // ${key} (QA loop-back): stream straight from the database cursor. Loading every row
        // first held the first byte back past the 30 s gateway limit on large exports.
        java.time.Instant asOfInstant = java.time.Instant.now();
        String asOf = asOfInstant.toString();
        String file = "agreement-coverage-" + LocalDate.ofInstant(asOfInstant, ZoneOffset.UTC) + ".csv";`,
      );
      tree.replace(
        path,
        `            int written = 0;
            for (CoverageResponse.Item item : response.items()) {
                csv.row(item, asOf);
                if (++written % limits.flushEvery() == 0) {
                    writer.flush();
                }
            }`,
        `            csv.header();
            writer.flush();
            int[] written = {0};
            repository.stream(agreementTypeId, version, limits.fetchSize(), row -> {
                csv.row(CoverageQuery.toItem(row), asOf);
                if (++written[0] % limits.flushEvery() == 0) {
                    writer.flush();
                }
            });`,
      );
      tree.replace(path, "            CoverageCsvWriter csv = new CoverageCsvWriter(writer);\n            csv.header();\n", "            CoverageCsvWriter csv = new CoverageCsvWriter(writer);\n");
      tree.replace(
        `${PKG}/ExportLimits.java`,
        "public record ExportLimits(boolean enabled, int maxRows, int flushEvery) {",
        "public record ExportLimits(boolean enabled, int maxRows, int flushEvery, int fetchSize) {",
      );
      tree.replace(
        `${PKG}/ExportLimits.java`,
        "        if (flushEvery <= 0) {\n            flushEvery = 1_000;\n        }",
        "        if (flushEvery <= 0) {\n            flushEvery = 1_000;\n        }\n        if (fetchSize <= 0) {\n            fetchSize = 5_000;\n        }",
      );
      tree.write(
        `${PKG}/CoverageRowStreamer.java`,
        `package com.plexus.customer.agreements.coverage;

import java.io.IOException;
import java.io.UncheckedIOException;

/** Receives rows from the database cursor one at a time (no full-result buffering). */
@FunctionalInterface
public interface CoverageRowStreamer {

    void accept(CoverageRepository.Row row) throws IOException;

    static java.sql.SQLException unwrap(UncheckedIOException e) {
        return new java.sql.SQLException("export client disconnected", e.getCause());
    }
}
`,
      );
      tree.replace(
        `${TPKG}/CoverageExportControllerTest.java`,
        "            new CoverageExportController(query, repository, new ExportLimits(true, 250_000, 1_000));",
        "            new CoverageExportController(query, repository, new ExportLimits(true, 250_000, 1_000, 5_000));",
      );
      tree.insertBeforeLast(
        `${TPKG}/CoverageExportControllerTest.java`,
        "}",
        `
    @Test
    @DisplayName("AC-1: rows are written from the cursor without loading the result")
    void streamsFromTheCursor() throws Exception {
        when(repository.count(any(), any())).thenReturn(120_000L);

        var body = controller.csv(null, null).getBody();
        body.writeTo(java.io.OutputStream.nullOutputStream());

        org.mockito.Mockito.verify(repository).stream(any(), any(), org.mockito.ArgumentMatchers.eq(5_000), any());
        org.mockito.Mockito.verifyNoInteractions(query);
    }`,
      );
      tree.replace(
        "src/main/resources/application.yml",
        "    flush-every: 1000\n",
        "    flush-every: 1000\n    fetch-size: 5000\n",
      );
      return {
        summary: "Streamed export rows from the database cursor (fetch size 5,000, flush every 1,000 rows) instead of loading the full result first, so the first byte leaves within a second and 120,000 rows finish in about 18 s",
        primaryFile: path,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// T-2: "Export CSV" button on the AGR Agreement Progress page
// ---------------------------------------------------------------------------------------------

function progressPage(task: RunTask): TaskImpl {
  // The page as AGR T-6 built it: the branch point for the button.
  return angularImpl({ ...task, id: "T-6", jiraKey: "CP-52155", title: "[website-customer-portal] Agreement Progress page", acceptanceCriteria: [
    { id: "AC-1", text: "Lists the latest agreements and versions with required, accepted and not-accepted counts" },
    { id: "AC-2", text: "Shows coverage toward the 100% goal per agreement version" },
    { id: "AC-3", text: "When the endpoint fails the page shows an error state and no figures" },
    { id: "AC-4", text: "Shows the as-of timestamp of the figures" },
  ] }, { kind: "page", name: "AgreementProgress", api: "/v1/agreements/coverage" });
}

function t2(task: RunTask): TaskImpl {
  const key = task.jiraKey ?? task.id;
  const base = progressPage(task);
  const dir = "src/app/agreements/agreement-progress";
  const get = (p: string) => base.files.find((f) => f.path === `${dir}/${p}`)?.after ?? "";
  const component = get("agreement-progress.component.ts");
  const template = get("agreement-progress.component.html");
  const service = get("agreement-progress.service.ts");

  const componentAfter = component
    .replace(
      "import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';",
      "import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';",
    )
    .replace(
      "import { AgreementProgressService, AgreementProgressState } from './agreement-progress.service';",
      "import { AgreementProgressService, AgreementProgressState } from './agreement-progress.service';\nimport { OktaAuthStateService } from '../../core/auth/okta-auth-state.service';\nimport { LocaleService } from '../../core/i18n/locale.service';",
    )
    .replace(
      "  private readonly data = inject(AgreementProgressService);\n",
      `  private readonly data = inject(AgreementProgressService);
  private readonly auth = inject(OktaAuthStateService);
  private readonly locale = inject(LocaleService);

  /** ${key}: only Legal/Compliance may export (the page itself is guarded separately). */
  readonly canExport = toSignal(this.auth.hasGroup('Legal-Compliance'), { initialValue: false });
  readonly exporting = signal(false);
`,
    )
    .replace(
      "    return required === 0 ? 0 : accepted / required;\n  });\n}",
      `    return required === 0 ? 0 : accepted / required;
  });

  async exportCsv(filters: { agreementTypeId?: number; version?: string } = {}): Promise<void> {
    this.exporting.set(true);
    try {
      const file = await this.data.exportCsv(filters, this.locale.current());
      const link = document.createElement('a');
      link.href = URL.createObjectURL(file.blob);
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      this.exporting.set(false);
    }
  }
}`,
    );

  const templateAfter = template.replace(
    "  </header>\n",
    `    @if (canExport() && state().status === 'ready') {
      <button type="button" class="btn btn-primary" data-testid="export-csv"
        [disabled]="exporting()" (click)="exportCsv()">
        <app-icon name="download" /> Export CSV
      </button>
    }
  </header>
`,
  );

  const serviceAfter = service
    .replace(
      "import { Observable, catchError, map, of, startWith } from 'rxjs';",
      "import { Observable, catchError, firstValueFrom, map, of, startWith } from 'rxjs';",
    )
    .replace(
      /\n}\n$/,
      `

  /** ${key}: the current view as CSV; the service names the file agreement-coverage-<date>.csv. */
  async exportCsv(filters: { agreementTypeId?: number; version?: string }, locale: string): Promise<{ blob: Blob; name: string }> {
    const params: Record<string, string> = { format: 'csv', locale };
    if (filters.agreementTypeId) params['agreementTypeId'] = String(filters.agreementTypeId);
    if (filters.version) params['version'] = filters.version;
    const res = await firstValueFrom(
      this.http.get(\`\${environment.gatewayUrl}/v1/agreements/coverage/export\`, { params, observe: 'response', responseType: 'blob' }),
    );
    const disposition = res.headers.get('content-disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'agreement-coverage.csv';
    return { blob: res.body ?? new Blob(), name };
  }
}
`,
    );

  const spec = `import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AgreementProgressComponent } from './agreement-progress.component';
import { OktaAuthStateService } from '../../core/auth/okta-auth-state.service';
import { LocaleService } from '../../core/i18n/locale.service';

const COVERAGE = {
  asOf: '2026-09-29T13:58:04Z',
  items: [{ agreementTypeId: 101, description: 'Brand Ambassador Agreement', version: '2026.2', requiredCount: 48212, acceptedCount: 44903, notAcceptedCount: 3309, coveragePercent: 93.1 }],
};

describe('AgreementProgressComponent export (${key})', () => {
  let fixture: ComponentFixture<AgreementProgressComponent>;
  let http: HttpTestingController;
  const setup = (groups: string[], locale = 'en-US') => {
    TestBed.configureTestingModule({
      imports: [AgreementProgressComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OktaAuthStateService, useValue: { hasGroup: (g: string) => of(groups.includes(g)) } },
        { provide: LocaleService, useValue: { current: () => locale } },
      ],
    });
    fixture = TestBed.createComponent(AgreementProgressComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/v1/agreements/coverage')).flush(COVERAGE);
    fixture.detectChanges();
  };
  const button = () => fixture.nativeElement.querySelector('[data-testid="export-csv"]');

  it('AC-1: shows Export CSV to Legal users', () => {
    setup(['Legal-Compliance']);
    expect(button()?.textContent).toContain('Export CSV');
  });

  it('AC-2: downloads the current view with its filters', async () => {
    setup(['Legal-Compliance']);
    const done = fixture.componentInstance.exportCsv({ agreementTypeId: 101, version: '2026.2' });
    const req = http.expectOne((r) => r.url.endsWith('/v1/agreements/coverage/export'));
    expect(req.request.params.get('format')).toBe('csv');
    expect(req.request.params.get('agreementTypeId')).toBe('101');
    expect(req.request.params.get('version')).toBe('2026.2');
    req.flush(new Blob(['agreementTypeId,description\\r\\n']), {
      headers: { 'content-disposition': 'attachment; filename="agreement-coverage-2026-09-29.csv"' },
    });
    await done;
  });

  it('AC-4: hides Export CSV from users outside Legal/Compliance', () => {
    setup(['Customer-Support']);
    expect(button()).toBeNull();
  });

  it('AC-5: sends the user locale for localized headers', async () => {
    setup(['Legal-Compliance'], 'es-US');
    const done = fixture.componentInstance.exportCsv();
    const req = http.expectOne((r) => r.url.endsWith('/v1/agreements/coverage/export'));
    expect(req.request.params.get('locale')).toBe('es-US');
    req.flush(new Blob(['']));
    await done;
  });

  afterEach(() => http.verify());
});
`;

  return {
    summary:
      "Added the Export CSV button to Agreement Progress for Legal/Compliance users: AgreementProgressComponent.exportCsv() downloads the current view (filters and locale included) through AgreementProgressService.exportCsv(), which names the file from Content-Disposition.",
    notes: [
      "Button visibility checks the Legal-Compliance group; the route guard from AGR T-7 still protects the page itself.",
      "The locale is sent as a query parameter; whether es-US headers are required at launch is BRD Q5.",
    ],
    files: [
      { path: `${dir}/agreement-progress.component.ts`, before: component, after: componentAfter },
      { path: `${dir}/agreement-progress.component.html`, before: template, after: templateAfter },
      { path: `${dir}/agreement-progress.service.ts`, before: service, after: serviceAfter },
      { path: `${dir}/agreement-progress.export.spec.ts`, after: spec },
    ],
    primaryFile: `${dir}/agreement-progress.component.ts`,
    acCoverage: {
      "AC-1": "AgreementProgressComponent export › shows Export CSV to Legal users",
      "AC-2": "AgreementProgressComponent export › downloads the current view with its filters",
      "AC-3": "customer-service-v2 CoverageCsvWriterTest (column order shared with the table)",
      "AC-4": "AgreementProgressComponent export › hides Export CSV from users outside Legal/Compliance",
      "AC-5": "AgreementProgressComponent export › sends the user locale for localized headers",
    },
    baseTests: 14,
    suites: 3,
    checks: {
      unit: { command: "pnpm nx test website-customer-portal --testFile=agreement-export.spec.ts" },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// T-3: audit entry per export
// ---------------------------------------------------------------------------------------------

const AUDIT_SERVICE = `import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface AuditEntry {
  action: string;
  target: string;
  detail?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private readonly http = inject(HttpClient);

  record(entry: AuditEntry): void {
    this.http.post(\`\${environment.gatewayUrl}/v1/audit/entries\`, entry).subscribe({ error: () => undefined });
  }
}
`;

function t3(task: RunTask): TaskImpl {
  const key = task.jiraKey ?? task.id;
  const after = AUDIT_SERVICE.replace(
    "    this.http.post(\`\${environment.gatewayUrl}/v1/audit/entries\`, entry).subscribe({ error: () => undefined });\n  }\n}",
    `    this.http.post(\`\${environment.gatewayUrl}/v1/audit/entries\`, entry).subscribe({ error: () => undefined });
  }

  /** ${key}: one entry per coverage export, including failed ones. */
  recordExport(e: { filters: Record<string, string | number | undefined>; rows?: number; failure?: string }): void {
    this.record({
      action: 'agreement.coverage.export',
      target: 'agreement-coverage',
      detail: { filters: e.filters, rows: e.rows ?? null, outcome: e.failure ? 'failed' : 'ok', failure: e.failure ?? null },
    });
  }
}`,
  );
  const interceptor = `import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { AuditLogService } from './audit-log.service';

/** ${key}: audits every call to the coverage export, successful or not. */
export const exportAuditInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.endsWith('/v1/agreements/coverage/export')) return next(req);
  const audit = inject(AuditLogService);
  const filters = Object.fromEntries(req.params.keys().map((k) => [k, req.params.get(k) ?? undefined]));
  return next(req).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) {
          audit.recordExport({ filters, rows: Number(event.headers.get('x-export-rows') ?? NaN) || undefined });
        }
      },
      error: (err: { status?: number; message?: string }) =>
        audit.recordExport({ filters, failure: \`\${err.status ?? 0} \${err.message ?? 'export failed'}\` }),
    }),
  );
};
`;
  const spec = `import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { exportAuditInterceptor } from './export-audit.interceptor';
import { AuditLogService } from './audit-log.service';

describe('exportAuditInterceptor', () => {
  const recordExport = jest.fn();
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    recordExport.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([exportAuditInterceptor])),
        provideHttpClientTesting(),
        { provide: AuditLogService, useValue: { recordExport } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  it('AC-1: records actor-scoped filters and the row count', () => {
    http.get('/v1/agreements/coverage/export', { params: { format: 'csv', version: '2026.2' } }).subscribe();
    backend.expectOne(() => true).flush('', { headers: { 'x-export-rows': '4' } });
    expect(recordExport).toHaveBeenCalledWith({ filters: { format: 'csv', version: '2026.2' }, rows: 4 });
  });

  it('AC-3: records a failed export with the reason', () => {
    http.get('/v1/agreements/coverage/export', { params: { format: 'csv' } }).subscribe({ error: () => undefined });
    backend.expectOne(() => true).flush('', { status: 504, statusText: 'Gateway Timeout' });
    expect(recordExport).toHaveBeenCalledWith(expect.objectContaining({ failure: expect.stringContaining('504') }));
  });

  it('ignores other requests', () => {
    http.get('/v1/agreements/coverage').subscribe();
    backend.expectOne(() => true).flush({});
    expect(recordExport).not.toHaveBeenCalled();
  });
});
`;
  return {
    summary: "Added exportAuditInterceptor and AuditLogService.recordExport to the portal: every coverage export, including failed ones, writes an agreement.coverage.export audit entry with filters, row count and outcome.",
    notes: ["Exports made by calling the API directly are not audited by the portal; noted as a plan risk."],
    files: [
      { path: "src/app/core/audit/audit-log.service.ts", before: AUDIT_SERVICE, after },
      { path: "src/app/core/audit/export-audit.interceptor.ts", after: interceptor },
      { path: "src/app/core/audit/export-audit.interceptor.spec.ts", after: spec },
    ],
    primaryFile: "src/app/core/audit/export-audit.interceptor.ts",
    acCoverage: {
      "AC-1": "exportAuditInterceptor › records actor-scoped filters and the row count",
      "AC-2": "Settings > Audit log (existing view, filter by action)",
      "AC-3": "exportAuditInterceptor › records a failed export with the reason",
    },
    baseTests: 71,
    suites: 17,
  };
}

export function lceImpl(task: RunTask): TaskImpl | undefined {
  const title = stripScope(task.title).toLowerCase();
  switch (task.id) {
    case "T-1":
      if (title.includes("csv export")) return t1(task);
      break;
    case "T-2":
      if (title.includes("export csv")) return t2(task);
      break;
    case "T-3":
      if (title.includes("audit")) return t3(task);
      break;
    case "T-4":
      if (title.includes("streaming")) return t4(task);
      break;
    case "T-5":
      return templateImpl(task, { name: "AgreementExport", url: "/agreements/progress", fault: null });
  }
  return undefined;
}
