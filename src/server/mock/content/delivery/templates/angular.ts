import "server-only";
/**
 * website-customer-portal (Angular 21, standalone components + signals, Okta OIDC, LaunchDarkly):
 * a page (component, template, data service, spec, route), a route guard, or a feature flag.
 * Other website-* repos reuse the same shapes.
 */
import { clip, featureName, stripScope } from "@/server/mock/workflows/delivery-lib/util";
import type { Fault, RunTask, TaskImpl } from "../types";
import { testName, tstr } from "./repos";

export type AngularKind = "page" | "guard" | "flag";

export interface AngularOpts {
  kind?: AngularKind;
  name?: string;
  /** Route path segment under the feature area, e.g. "progress". */
  route?: string;
  area?: string;
  /** API path the page reads. */
  api?: string;
  flag?: string;
  fault?: Fault["check"];
  baseTests?: number;
  suites?: number;
}

export function kebab(pascal: string): string {
  return pascal.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export const AGREEMENTS_ROUTES = `import { Routes } from '@angular/router';
import { oktaAuthGuard } from '../core/auth/okta-auth.guard';

export const AGREEMENTS_ROUTES: Routes = [
  {
    path: '',
    canActivate: [oktaAuthGuard],
    loadComponent: () =>
      import('./agreement-list/agreement-list.component').then((m) => m.AgreementListComponent),
  },
  {
    path: ':customerId',
    canActivate: [oktaAuthGuard],
    loadComponent: () =>
      import('./customer-agreements/customer-agreements.component').then((m) => m.CustomerAgreementsComponent),
  },
];
`;

export const FEATURE_FLAGS = `/**
 * LaunchDarkly flag keys used by the portal, with the value used when LaunchDarkly is unreachable.
 * New surfaces default to off so they can be disabled without a deploy.
 */
export const FEATURE_FLAGS = {
  customerNotesV2: { key: 'customer-notes-v2', fallback: false },
  orderRequeueDialog: { key: 'order-requeue-dialog', fallback: true },
  commissionUploads: { key: 'commission-uploads', fallback: true },
} as const;

export type FeatureFlagName = keyof typeof FEATURE_FLAGS;
`;

export const NAV_CONFIG = `import { NavItem } from './nav-item';

export const NAV_ITEMS: NavItem[] = [
  { label: 'Customers', icon: 'people', link: '/customers' },
  { label: 'Orders', icon: 'receipt_long', link: '/orders' },
  { label: 'Agreements', icon: 'gavel', link: '/agreements' },
  { label: 'Reports', icon: 'bar_chart', link: '/reports' },
  { label: 'Settings', icon: 'settings', link: '/settings' },
];
`;

function specCases(task: RunTask, subject: string, variant: AngularKind): { cases: string; coverage: Record<string, string> } {
  const acs = task.acceptanceCriteria.length ? task.acceptanceCriteria : [{ id: "AC-1", text: "renders" }];
  const coverage: Record<string, string> = {};
  const bodies: Record<AngularKind, string[]> = {
    page: [
      `    http.expectOne((r) => r.url.endsWith(API)).flush(COVERAGE);
    fixture.detectChanges();
    expect(rows()).toHaveLength(2);`,
      `    http.expectOne((r) => r.url.endsWith(API)).flush(COVERAGE);
    fixture.detectChanges();
    expect(text()).toContain('93.1%');`,
      `    http.expectOne((r) => r.url.endsWith(API)).flush('boom', { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(text()).toContain('Coverage figures are unavailable');
    expect(rows()).toHaveLength(0);`,
      `    http.expectOne((r) => r.url.endsWith(API)).flush(COVERAGE);
    fixture.detectChanges();
    expect(text()).toContain('as of');`,
    ],
    guard: [
      `    auth.groups.set(['Legal-Compliance']);
    expect(await run()).toBe(true);`,
      `    auth.groups.set(['Customer-Support']);
    expect(await run()).toEqual(router.parseUrl('/forbidden'));`,
      `    auth.groups.set([]);
    expect(await run()).toEqual(router.parseUrl('/forbidden'));`,
    ],
    flag: [
      `    flags.set(FLAG, false);
    expect(visibleLinks()).not.toContain('Agreement Progress');`,
      `    flags.set(FLAG, true);
    expect(visibleLinks()).toContain('Agreement Progress');`,
      `    flags.offline();
    expect(visibleLinks()).not.toContain('Agreement Progress');`,
    ],
  };
  const cases = acs
    .map((ac, i) => {
      const name = `${ac.id}: ${clip(ac.text, 80)}`;
      coverage[ac.id] = `${subject} › ${testName(ac.text)}`;
      return `  it(${tstr(name)}, async () => {
${bodies[variant][i % bodies[variant].length]}
  });`;
    })
    .join("\n\n");
  return { cases, coverage };
}

export function angularImpl(task: RunTask, opts: AngularOpts = {}): TaskImpl {
  const kind = opts.kind ?? "page";
  const n = opts.name ?? featureName(stripScope(task.title));
  const k = kebab(n);
  const area = opts.area ?? "agreements";
  const key = task.jiraKey ?? task.id;
  const app = "src/app";
  if (kind === "guard") return guardImpl(task, n, k, key, opts);
  if (kind === "flag") return flagImpl(task, n, key, opts);

  const route = opts.route ?? k;
  const api = opts.api ?? `/v1/${area}/${k}`;
  const dir = `${app}/${area}/${k}`;
  const flag = opts.flag ?? "agreement-progress-page";

  const component = `import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ${n}Service, ${n}State } from './${k}.service';

/** ${key}: ${stripScope(task.title)}. Figures are either correct or visibly absent. */
@Component({
  selector: 'app-${k}',
  standalone: true,
  imports: [DatePipe, DecimalPipe, PercentPipe],
  templateUrl: './${k}.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ${n}Component {
  private readonly data = inject(${n}Service);

  readonly state = toSignal(this.data.load(), { initialValue: { status: 'loading' } as ${n}State });
  readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.items : [];
  });
  readonly overall = computed(() => {
    const rows = this.rows();
    const required = rows.reduce((n, r) => n + r.requiredCount, 0);
    const accepted = rows.reduce((n, r) => n + r.acceptedCount, 0);
    return required === 0 ? 0 : accepted / required;
  });
}
`;

  const template = `<section class="page">
  <header class="page-header">
    <h1>${stripScope(task.title).replace(/"/g, "&quot;")}</h1>
    @if (state().status === 'ready') {
      <p class="muted">Acceptance coverage per agreement and version · as of {{ state().asOf | date: 'medium' }}</p>
    }
  </header>

  @switch (state().status) {
    @case ('loading') {
      <app-skeleton-table [rows]="4" />
    }
    @case ('error') {
      <app-error-state title="Coverage figures are unavailable"
        detail="No figures are shown rather than partial or stale ones. Try again in a minute." />
    }
    @case ('ready') {
      <div class="kpis">
        <app-kpi label="Overall coverage" [value]="overall() | percent: '1.1-1'" />
        <app-kpi label="Agreements" [value]="rows().length" />
      </div>
      <table class="data-table" aria-label="Agreement coverage">
        <thead>
          <tr>
            <th>Agreement</th><th>Version</th><th class="num">Required</th>
            <th class="num">Accepted</th><th class="num">Not accepted</th><th class="num">Coverage</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.agreementTypeId + row.version) {
            <tr>
              <td>{{ row.description }}</td>
              <td class="mono">{{ row.version }}</td>
              <td class="num">{{ row.requiredCount | number }}</td>
              <td class="num">{{ row.acceptedCount | number }}</td>
              <td class="num">{{ row.notAcceptedCount | number }}</td>
              <td class="num">{{ row.coveragePercent }}%</td>
            </tr>
          }
        </tbody>
      </table>
    }
  }
</section>
`;

  const service = `import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, startWith } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ${n}Item {
  agreementTypeId: number;
  description: string;
  version: string;
  requiredCount: number;
  acceptedCount: number;
  notAcceptedCount: number;
  coveragePercent: number;
}

export type ${n}State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: ${n}Item[]; asOf: string };

@Injectable({ providedIn: 'root' })
export class ${n}Service {
  private readonly http = inject(HttpClient);

  load(filters: { agreementTypeId?: number; version?: string } = {}): Observable<${n}State> {
    const params: Record<string, string> = {};
    if (filters.agreementTypeId) params['agreementTypeId'] = String(filters.agreementTypeId);
    if (filters.version) params['version'] = filters.version;
    return this.http
      .get<{ items: ${n}Item[]; asOf: string }>(\`\${environment.gatewayUrl}${api}\`, { params })
      .pipe(
        map((body): ${n}State => ({ status: 'ready', items: body.items, asOf: body.asOf })),
        catchError(() => of<${n}State>({ status: 'error' })),
        startWith<${n}State>({ status: 'loading' }),
      );
  }
}
`;

  const { cases, coverage } = specCases(task, `${n}Component`, "page");
  const spec = `import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ${n}Component } from './${k}.component';

const API = '${api}';
const COVERAGE = {
  asOf: '2026-09-29T13:58:04Z',
  items: [
    { agreementTypeId: 101, description: 'Brand Ambassador Agreement', version: '2026.2', requiredCount: 48212, acceptedCount: 44903, notAcceptedCount: 3309, coveragePercent: 93.1 },
    { agreementTypeId: 103, description: 'Privacy Policy', version: '2026.3', requiredCount: 48212, acceptedCount: 39118, notAcceptedCount: 9094, coveragePercent: 81.1 },
  ],
};

describe('${n}Component', () => {
  let fixture: ComponentFixture<${n}Component>;
  let http: HttpTestingController;
  const rows = () => fixture.nativeElement.querySelectorAll('tbody tr');
  const text = () => fixture.nativeElement.textContent as string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [${n}Component],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(${n}Component);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

${cases}
});
`;

  const routes = AGREEMENTS_ROUTES.replace(
    "  {\n    path: ':customerId',",
    `  {
    path: '${route}',
    canActivate: [oktaAuthGuard, featureFlagGuard('${flag}')],
    loadComponent: () => import('./${k}/${k}.component').then((m) => m.${n}Component),
  },
  {
    path: ':customerId',`,
  ).replace(
    "import { oktaAuthGuard } from '../core/auth/okta-auth.guard';",
    "import { oktaAuthGuard } from '../core/auth/okta-auth.guard';\nimport { featureFlagGuard } from '../core/flags/feature-flag.guard';",
  );

  const faults: Record<string, Fault> = {
    lint: {
      check: "lint",
      path: `${dir}/${k}.component.ts`,
      correct: "    const rows = this.rows();",
      broken: "    let rows = this.rows();",
      message: `${k}.component.ts:{line}:5 'rows' is never reassigned. Use 'const' instead (prefer-const)`,
      output: `Linting "${task.repo}"...

${dir}/${k}.component.ts
  {line}:5  error  'rows' is never reassigned. Use 'const' instead  prefer-const

✖ 1 problem (1 error, 0 warnings)
  1 error and 0 warnings potentially fixable with the \`--fix\` option.

Lint errors found in the listed files.`,
      fixSummary: `Declared rows as const in ${n}Component (prefer-const).`,
    },
    typecheck: {
      check: "typecheck",
      path: `${dir}/${k}.service.ts`,
      correct: "  coveragePercent: number;",
      broken: "  coveragePercent: string;",
      message: `${k}.component.html: error TS2365: Operator '+' cannot be applied to types 'number' and 'string'`,
      output: `> nx run ${task.repo}:typecheck

${dir}/${k}.component.ts:{line}:5 - error TS2365: Operator '+' cannot be applied to types 'number' and 'string'.

Found 1 error.

 NX   Running target typecheck for project ${task.repo} failed`,
      fixSummary: `Typed coveragePercent as number in ${n}Item to match the API contract.`,
    },
    unit: {
      check: "unit",
      path: `${dir}/${k}.component.ts`,
      correct: "    return required === 0 ? 0 : accepted / required;",
      broken: "    return required === 0 ? 0 : required / accepted;",
      message: `${n}Component › overall coverage expected 0.874 received 1.144`,
      output: ` FAIL  ${dir}/${k}.component.spec.ts
  ● ${n}Component › overall coverage

    expect(received).toBeCloseTo(expected)
    Expected: 0.874
    Received: 1.144

Test Suites: 1 failed, {suites} passed, {suitesTotal} total
Tests:       1 failed, {passed} passed, {total} total`,
      fixSummary: `Fixed the overall coverage ratio in ${n}Component (accepted / required).`,
    },
  };

  return {
    summary: `Added the ${stripScope(task.title)} page to ${task.repo}: ${n}Component (signals, loading/error/ready states), ${n}Service over ${api}, a lazy route behind ${flag} and ${Object.keys(coverage).length} specs.`,
    notes: [
      "The error state shows no figures at all, never partial or stale ones (AAD failure behavior).",
      `The route is guarded by Okta and the ${flag} flag, so it can be turned off without a deploy.`,
    ],
    files: [
      { path: `${dir}/${k}.component.ts`, after: component },
      { path: `${dir}/${k}.component.html`, after: template },
      { path: `${dir}/${k}.service.ts`, after: service },
      { path: `${dir}/${k}.component.spec.ts`, after: spec },
      { path: `${app}/${area}/agreements.routes.ts`, before: AGREEMENTS_ROUTES, after: routes },
    ],
    primaryFile: `${dir}/${k}.component.ts`,
    acCoverage: coverage,
    fault: opts.fault ? faults[opts.fault] : undefined,
    baseTests: opts.baseTests ?? 58,
    suites: opts.suites ?? 14,
  };
}

function guardImpl(task: RunTask, n: string, k: string, key: string, opts: AngularOpts): TaskImpl {
  const dir = "src/app/core/auth";
  const group = "Legal-Compliance";
  const guard = `import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OktaAuthStateService } from './okta-auth-state.service';

/**
 * ${key}: ${stripScope(task.title)}.
 * Route-level check on the Okta groups claim; the page is never rendered for other roles.
 */
export const ${n[0].toLowerCase() + n.slice(1)}Guard: CanActivateFn = async () => {
  const auth = inject(OktaAuthStateService);
  const router = inject(Router);
  const groups = await auth.groups();
  return groups.includes(REQUIRED_GROUP) ? true : router.parseUrl('/forbidden');
};

/** Okta group allowed to open agreement reporting (Q4 decides the final name). */
export const REQUIRED_GROUP = '${group}';
`;
  const { cases, coverage } = specCases(task, `${n}Guard`, "guard");
  const spec = `import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ${n[0].toLowerCase() + n.slice(1)}Guard } from './${k}.guard';
import { OktaAuthStateService } from './okta-auth-state.service';
import { FakeOktaAuthState } from '../../testing/fake-okta-auth-state';

describe('${n}Guard', () => {
  let auth: FakeOktaAuthState;
  let router: Router;
  const run = () => TestBed.runInInjectionContext(() => ${n[0].toLowerCase() + n.slice(1)}Guard({} as never, {} as never));

  beforeEach(() => {
    auth = new FakeOktaAuthState();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: OktaAuthStateService, useValue: auth }],
    });
    router = TestBed.inject(Router);
  });

${cases}
});
`;
  const routes = AGREEMENTS_ROUTES.replace(
    "import { oktaAuthGuard } from '../core/auth/okta-auth.guard';",
    `import { oktaAuthGuard } from '../core/auth/okta-auth.guard';\nimport { ${n[0].toLowerCase() + n.slice(1)}Guard } from '../core/auth/${k}.guard';`,
  ).replace(
    "    path: '',\n    canActivate: [oktaAuthGuard],",
    `    path: '',\n    canActivate: [oktaAuthGuard, ${n[0].toLowerCase() + n.slice(1)}Guard],`,
  );
  return {
    summary: `Added ${n[0].toLowerCase() + n.slice(1)}Guard to ${task.repo}: a route-level Okta group check (${group}) on the agreements routes, with ${Object.keys(coverage).length} specs.`,
    notes: [`The required group is a single constant (REQUIRED_GROUP = '${group}') until Q4 names the final Okta group.`],
    files: [
      { path: `${dir}/${k}.guard.ts`, after: guard },
      { path: `${dir}/${k}.guard.spec.ts`, after: spec },
      { path: "src/app/agreements/agreements.routes.ts", before: AGREEMENTS_ROUTES, after: routes },
    ],
    primaryFile: `${dir}/${k}.guard.ts`,
    acCoverage: coverage,
    fault: undefined,
    baseTests: opts.baseTests ?? 61,
    suites: opts.suites ?? 15,
  };
}

function flagImpl(task: RunTask, n: string, key: string, opts: AngularOpts): TaskImpl {
  const flag = opts.flag ?? "agreement-progress-page";
  const prop = flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const flags = FEATURE_FLAGS.replace(
    "  commissionUploads: { key: 'commission-uploads', fallback: true },\n",
    `  commissionUploads: { key: 'commission-uploads', fallback: true },\n  /** ${key}: Agreement Progress page; off until Legal/Compliance enablement. */\n  ${prop}: { key: '${flag}', fallback: false },\n`,
  );
  const nav = NAV_CONFIG.replace(
    "  { label: 'Agreements', icon: 'gavel', link: '/agreements' },\n",
    `  { label: 'Agreements', icon: 'gavel', link: '/agreements' },\n  { label: 'Agreement Progress', icon: 'monitoring', link: '/agreements/progress', flag: '${prop}' },\n`,
  );
  const { cases, coverage } = specCases(task, "NavComponent", "flag");
  const spec = `import { TestBed } from '@angular/core/testing';
import { NavComponent } from './nav.component';
import { FeatureFlagService } from '../core/flags/feature-flag.service';
import { FakeFeatureFlags } from '../testing/fake-feature-flags';

const FLAG = '${flag}';

describe('NavComponent (${flag})', () => {
  let flags: FakeFeatureFlags;
  const visibleLinks = () => {
    const fixture = TestBed.createComponent(NavComponent);
    fixture.detectChanges();
    return [...fixture.nativeElement.querySelectorAll('a')].map((a: HTMLElement) => a.textContent?.trim());
  };

  beforeEach(() => {
    flags = new FakeFeatureFlags();
    TestBed.configureTestingModule({
      imports: [NavComponent],
      providers: [{ provide: FeatureFlagService, useValue: flags }],
    });
  });

${cases}
});
`;
  return {
    summary: `Registered the LaunchDarkly flag ${flag} (fallback off) in ${task.repo} and hid the Agreement Progress nav entry behind it, with ${Object.keys(coverage).length} specs.`,
    notes: [
      `The flag falls back to off when LaunchDarkly is unreachable, so the page never appears by accident.`,
      "Creating the flag in LaunchDarkly (all environments, default off) is a manual step listed in the handoff note.",
    ],
    files: [
      { path: "src/app/core/flags/feature-flags.ts", before: FEATURE_FLAGS, after: flags },
      { path: "src/app/layout/nav.config.ts", before: NAV_CONFIG, after: nav },
      { path: "src/app/layout/nav.component.flags.spec.ts", after: spec },
    ],
    primaryFile: "src/app/core/flags/feature-flags.ts",
    acCoverage: coverage,
    fault: undefined,
    baseTests: opts.baseTests ?? 55,
    suites: opts.suites ?? 13,
  };
}

/** Generic Angular rework: an extra spec named after the feedback, shaped for the spec it joins. */
export function angularReworkSpec(cycle: number, feedback: string, specPath: string): string {
  const body = specPath.endsWith(".guard.spec.ts")
    ? `    auth.groups.set(['Legal-Compliance']);
    expect(await run()).toBe(true);`
    : specPath.includes("flags.spec")
      ? `    flags.set(FLAG, true);
    expect(visibleLinks()).toContain('Agreement Progress');`
      : `    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="error-state"]')).toBeNull();`;
  return `
  it(${tstr(`review follow-up ${cycle}: ${clip(feedback, 70)}`)}, async () => {
${body}
  });`;
}
