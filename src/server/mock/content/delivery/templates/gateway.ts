import "server-only";
/**
 * api-gateway: declarative routes (authenticate + forward, no domain logic) with a route test.
 * The first version of a route may re-sign the caller's token; AGR T-5's review asks to forward
 * the Okta bearer token unchanged, which the bespoke rework applies.
 */
import { clip, featureName, plural, stripScope } from "@/server/mock/workflows/delivery-lib/util";
import type { RunTask, TaskImpl } from "../types";
import { domainFor, type Domain } from "./domain";
import { testName, tstr } from "./repos";

export interface GatewayOpts {
  name?: string;
  /** Public path, e.g. "/v1/agreements/coverage". */
  path?: string;
  upstream?: string;
  /** Start with a token re-signing policy (the thing a reviewer later asks to remove). */
  resign?: boolean;
  baseTests?: number;
  /** Route area and wording; defaults to the agreements routes. */
  domain?: Domain;
}

export const AGREEMENTS_ROUTES_YAML = `# Agreement routes. The gateway authenticates and forwards; domain SQL lives in the services.
routes:
  # Called by the Auth0 terms gate on every login.
  - id: post-login-context
    path: /v1/sso/post-login-context
    methods: [GET]
    upstream: customer-service-v2
    auth: basic
    timeout: 5s

  # Acceptances are published, not forwarded: customer-service-v2 consumes the topic.
  - id: agreements-accept
    path: /v1/agreements
    methods: [POST]
    auth: basic
    timeout: 5s
    publish:
      topic: customerflow.auth0.agreement.accepted.v1
      key: $.customerId
      respond: 202

  - id: contentful-webhook
    path: /api/v1/webhooks/contentful
    methods: [POST]
    upstream: customer-service-v2
    auth: contentful-signature
    allow-ips: contentful-webhooks
    timeout: 10s
`;

export function gatewayImpl(task: RunTask, opts: GatewayOpts = {}): TaskImpl {
  const d = opts.domain ?? domainFor();
  const n = opts.name ?? featureName(stripScope(task.title));
  const id = n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const path = opts.path ?? `/v1/${d.pkg}/${id}`;
  // The agreement routes exist already; another area gets its own routes file.
  const routesFile = `routes/${d.pkg}.yaml`;
  const base = d.pkg === "agreements" ? AGREEMENTS_ROUTES_YAML : undefined;
  const header = `# ${d.pkg.charAt(0).toUpperCase()}${d.pkg.slice(1)} routes. The gateway authenticates and forwards; domain logic lives in the services.\nroutes:\n`;
  const upstream = opts.upstream ?? "customer-service-v2";
  const key = task.jiraKey ?? task.id;
  const policy = opts.resign
    ? `    policies:
      - jwt-resign:
          issuer: api-gateway
          audience: ${upstream}
          ttl: 60s`
    : `    policies:
      - forward-headers: [authorization, x-request-id]`;
  const route = `
  # ${key}: ${stripScope(task.title)}
  - id: ${id}
    path: ${path}
    methods: [GET]
    upstream: ${upstream}
    auth: okta-jwt
    timeout: 30s
${policy}
    rate-limit:
      per-client: 30/min
`;
  const yaml = (base ?? header) + route;
  const acs = task.acceptanceCriteria.length ? task.acceptanceCriteria : [{ id: "AC-1", text: "forwards the request" }];
  const coverage: Record<string, string> = {};
  const bodies = [
    `    const res = await gateway.get('${path}').set('authorization', \`Bearer \${oktaToken('${d.role}')}\`);
    expect(res.status).toBe(200);
    expect(upstreamCalls('${upstream}')).toHaveLength(1);`,
    `    const res = await gateway.get('${path}');
    expect(res.status).toBe(401);
    expect(upstreamCalls('${upstream}')).toHaveLength(0);`,
    `    await gateway.get('${path}?${d.idParam}=101&version=2026.2').set('authorization', \`Bearer \${oktaToken('${d.role}')}\`);
    expect(upstreamCalls('${upstream}')[0].query).toEqual({ ${d.idParam}: '101', version: '2026.2' });`,
    `    stubUpstream('${upstream}', { delayMs: 31_000 });
    const res = await gateway.get('${path}').set('authorization', \`Bearer \${oktaToken('${d.role}')}\`);
    expect(res.status).toBe(504);`,
  ];
  const cases = acs
    .map((ac, i) => {
      coverage[ac.id] = `routes/${id} › ${testName(ac.text)}`;
      return `  it(${tstr(`${ac.id}: ${clip(ac.text, 80)}`)}, async () => {
${bodies[i % bodies.length]}
  });`;
    })
    .join("\n\n");
  const test = `import { describe, expect, it } from 'vitest';
import { gatewayTestClient, oktaToken, stubUpstream, upstreamCalls } from '../support/gateway-test-client';

const gateway = gatewayTestClient({ routes: ['${routesFile}'] });

describe('route ${id}', () => {
${cases}
});
`;
  return {
    summary: `Added the ${id} route to api-gateway (${path} -> ${upstream}, Okta JWT auth, 30 s timeout, per-client rate limit) with ${plural(acs.length, "route test")}.`,
    notes: ["The route only authenticates and forwards; no domain logic at the gateway (AAD integration convention)."],
    files: [
      { path: routesFile, ...(base ? { before: base } : {}), after: yaml },
      { path: `test/routes/${id}.test.ts`, after: test },
    ],
    primaryFile: routesFile,
    acCoverage: coverage,
    baseTests: opts.baseTests ?? 118,
    suites: 21,
  };
}

/** Generic gateway rework: a route test named after the feedback. */
export function gatewayReworkTest(path: string, cycle: number, feedback: string): string {
  return `
  it(${tstr(`review follow-up ${cycle}: ${clip(feedback, 70)}`)}, async () => {
    const res = await gateway.get('${path}').set('x-request-id', 'rework-${cycle}');
    expect(res.headers['x-request-id']).toBe('rework-${cycle}');
  });`;
}
