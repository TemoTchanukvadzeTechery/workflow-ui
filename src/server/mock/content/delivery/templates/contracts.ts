import "server-only";
/**
 * api-contracts: an OpenAPI 3.1 path + schema published before the owning service deploys (AAD
 * delivery step 4), with an example that the contract tests validate.
 */
import { featureName, stripScope } from "@/server/mock/workflows/delivery-lib/util";
import type { RunTask, TaskImpl } from "../types";
import { domainFor, type Domain } from "./domain";

export interface ContractOpts {
  name?: string;
  path?: string;
  baseTests?: number;
  /** Folder, fields and wording; defaults to the agreements API. */
  domain?: Domain;
}

export const CONTRACTS_INDEX = `openapi: 3.1.0
info:
  title: Plexus agreements API
  version: 2.4.0
servers:
  - url: https://api-gateway.internal/
paths:
  /v1/sso/post-login-context:
    $ref: ./agreements/post-login-context.yaml
  /v1/agreements:
    $ref: ./agreements/accept.yaml
`;

export function contractImpl(task: RunTask, opts: ContractOpts = {}): TaskImpl {
  const d = opts.domain ?? domainFor();
  const dir = d.pkg === "privacy" || d.pkg === "terms" ? "agreements" : d.pkg;
  const n = opts.name ?? featureName(stripScope(task.title));
  const file = n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const path = opts.path ?? `/v1/${dir}/${file}`;
  const key = task.jiraKey ?? task.id;
  const agreements = d.open === "notAcceptedCount";
  const spec = `# ${key}: ${stripScope(task.title)}
get:
  operationId: get${n}
  summary: ${d.summary}
  description: >-
    ${agreements ? "Read-only aggregate figures for Legal/Compliance. Counts are distinct ambassadors; figures are" : "Read-only aggregate figures for internal users. Counts are distinct customers; figures are"}
    either current or the call fails, never partial.
  tags: [${dir}]
  security:
    - oktaJwt: []
  parameters:
    - name: ${d.idParam}
      in: query
      required: false
      schema: { type: integer, minimum: 1 }
    - name: version
      in: query
      required: false
      schema: { type: string, pattern: '^\\d{4}\\.\\d+$' }
  responses:
    '200':
      description: ${agreements ? "Coverage per active agreement version" : "Figures per active type and version"}
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/${n}Response'
          examples:
            default:
              $ref: './examples/${file}.json'
    '400':
      $ref: '../common/responses.yaml#/BadRequest'
    '401':
      $ref: '../common/responses.yaml#/Unauthorized'
    '403':
      $ref: '../common/responses.yaml#/Forbidden'
    '503':
      $ref: '../common/responses.yaml#/Unavailable'
components:
  schemas:
    ${n}Response:
      type: object
      required: [items, asOf]
      properties:
        asOf:
          type: string
          format: date-time
        items:
          type: array
          items:
            $ref: '#/components/schemas/${n}Item'
    ${n}Item:
      type: object
      required: [${d.idParam}, description, version, ${d.total}, ${d.done}, ${d.open}, ${d.pct}]
      properties:
        ${d.idParam}: { type: integer }
        description: { type: string }
        version: { type: string }
        countryCode: { type: [string, 'null'] }
        stateProvince: { type: [string, 'null'] }
        ${d.total}: { type: integer, minimum: 0 }
        ${d.done}: { type: integer, minimum: 0 }
        ${d.open}: { type: integer, minimum: 0 }
        ${d.pct}: { type: number, minimum: 0, maximum: 100 }
`;
  const example = `{
  "asOf": "2026-09-29T13:58:04Z",
  "items": [
    {
      "${d.idParam}": 101,
      "description": ${JSON.stringify(d.samples[0])},
      "version": "2026.2",
      "countryCode": "US",
      "stateProvince": null,
      "${d.total}": 48212,
      "${d.done}": 44903,
      "${d.open}": 3309,
      "${d.pct}": 93.1
    },
    {
      "${d.idParam}": 102,
      "description": ${JSON.stringify(d.samples[1])},
      "version": "2026.1",
      "countryCode": "US",
      "stateProvince": null,
      "${d.total}": 48212,
      "${d.done}": 45870,
      "${d.open}": 2342,
      "${d.pct}": 95.1
    }
  ]
}
`;
  const index = CONTRACTS_INDEX + `  ${path}:\n    $ref: ./${dir}/${file}.yaml\n`;
  const acs = task.acceptanceCriteria.length ? task.acceptanceCriteria : [{ id: "AC-1", text: "contract published" }];
  const coverage = Object.fromEntries(acs.map((a) => [a.id, `${dir}/${file}.yaml (redocly lint + example validation)`]));
  return {
    summary: `Published ${path} in api-contracts: operation get${n}, ${n}Response/${n}Item schemas with the AAD's proposed fields, error responses and a validated example.`,
    notes: ["Field names follow the AAD's proposed response shape; they are marked illustrative there, so a rename is a contract change."],
    files: [
      { path: `${dir}/${file}.yaml`, after: spec },
      { path: `${dir}/examples/${file}.json`, after: example },
      { path: "index.yaml", before: CONTRACTS_INDEX, after: index },
    ],
    primaryFile: `${dir}/${file}.yaml`,
    acCoverage: coverage,
    baseTests: opts.baseTests ?? 24,
    suites: 6,
  };
}
