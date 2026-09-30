import "server-only";
/**
 * terraform-auth0: Auth0 Actions (Node 22, post-login trigger) and their terraform resources. The
 * terms gate (`terms-gate.js`, memory glossary) is the post-login action that shows outstanding
 * agreements and denies the session until they are accepted. TG built it for Brand Ambassadors;
 * PPR widens it to every customer type. Any other task in this repo gets a small action of its own.
 */
import { clip, kebabCase, stripScope } from "@/server/mock/workflows/delivery-lib/util";
import type { RunTask, TaskImpl } from "../types";
import { tstr } from "./repos";

export const TERMS_GATE_JS = "actions/post-login/terms-gate.js";
export const TERMS_GATE_TEST = "actions/post-login/terms-gate.test.js";
export const ACTIONS_TF = "actions.tf";
export const AGREEMENT_FORM_TF = "forms/agreement-acceptance.tf";

/** Jira keys of the TG tasks that built the gate (the seed syncs TG tasks from CP-51970). */
export const TG_KEYS = { tables: "CP-51970", context: "CP-51971", consumer: "CP-51972", routes: "CP-51973", gate: "CP-51974", e2e: "CP-51975" };

export type GateVariant = "ambassadors" | "all-customer-types";

/** The post-login action. `pprKey` is the PPR task that widened it (all-customer-types only). */
export function termsGateAction(variant: GateVariant, pprKey = "CP-52312"): string {
  const all = variant === "all-customer-types";
  const header = all
    ? ` * ${pprKey}: every customer type. customer-service-v2 decides what is outstanding for each type
 * (Brand Ambassadors: all agreements; Preferred and Retail: the Privacy Policy only).`
    : " * Brand Ambassadors only for now; other customer types are never gated.";
  const eligibility = all
    ? "  // Every customer type goes through the same post-login context call; no new call on the login path."
    : "  if (event.user.app_metadata?.customer_type_id !== BRAND_AMBASSADOR) return;";
  const constants = all ? "const PRIVACY_POLICY = 'privacy-policy';\nconst TIMEOUT_MS = 3000;" : "const BRAND_AMBASSADOR = 1;\nconst TIMEOUT_MS = 3000;";
  const vars = all
    ? `    vars: {
      locale: lang,
      heading: onlyPrivacyPolicy(context) ? 'privacy-update' : 'agreements',
      agreements: context.outstandingAgreements.map(function (a) {
        return { id: String(a.agreementTypeId), version: a.version, title: a.title[lang] || a.title.en };
      }),
    },`
    : `    vars: {
      locale: lang,
      agreements: context.outstandingAgreements.map(function (a) {
        return { id: String(a.agreementTypeId), version: a.version, title: a.title[lang] || a.title.en };
      }),
    },`;
  const deny = all
    ? `    const message = onlyPrivacyPolicy(context)
      ? 'Accept the updated Privacy Policy to keep using your account.'
      : 'Accept the updated agreements to continue.';
    api.access.deny('agreements_not_accepted', message);`
    : "    api.access.deny('agreements_not_accepted', 'Accept the updated agreements to continue.');";
  const helper = all
    ? `
function onlyPrivacyPolicy(context) {
  return context.outstandingAgreements.every(function (a) {
    return a.key === PRIVACY_POLICY;
  });
}
`
    : "";
  return `/**
 * Terms gate (${TG_KEYS.gate}): post-login action. Shows the agreements a customer still has to accept
 * and denies the session until all of them are accepted. customer-service-v2 decides what is
 * outstanding (GET /v1/sso/post-login-context); acceptances go to POST /v1/agreements, which
 * publishes customerflow.auth0.agreement.accepted.v1. Agreement text comes from Contentful.
${header}
 */
const FORM_ID = 'ap_agreement_acceptance';
${constants}

exports.onExecutePostLogin = async (event, api) => {
  if (event.transaction?.protocol === 'oauth2-refresh-token') return;
  // ARC logins act on an ambassador's behalf: never gate them and never record an acceptance.
  if (isArcSession(event)) {
    api.idToken.setCustomClaim('https://plexus.com/terms_gate', 'skipped:arc');
    return;
  }
${eligibility}

  let context;
  try {
    context = await postLoginContext(event);
  } catch (err) {
    // Fail open: an outage behind the gateway must not lock customers out; the next login prompts.
    console.log('terms-gate: post-login context unavailable (' + err.message + '); login continues');
    return;
  }
  if (!context.gateEnabled || context.outstandingAgreements.length === 0) return;

  const lang = locale(event);
  api.prompt.render(FORM_ID, {
${vars}
  });
};

exports.onContinuePostLogin = async (event, api) => {
  const context = await postLoginContext(event);
  const accepted = new Set(event.prompt?.fields?.accepted || []);
  const missing = context.outstandingAgreements.filter(function (a) {
    return !accepted.has(String(a.agreementTypeId));
  });
  if (event.prompt?.fields?.decision !== 'accept' || missing.length > 0) {
${deny}
    return;
  }
  await recordAcceptance(event, context.outstandingAgreements);
};

function isArcSession(event) {
  const scopes = event.transaction?.requested_scopes || [];
  return Boolean(event.user.app_metadata?.arc_session) || scopes.includes('arc:impersonate');
}

function locale(event) {
  return /^es\\b/i.test(event.request.language || '') ? 'es' : 'en';
}
${helper}
async function postLoginContext(event) {
  const customerId = event.user.app_metadata.customer_id;
  const url = event.secrets.API_GATEWAY_URL + '/v1/sso/post-login-context?customerId=' + encodeURIComponent(customerId);
  const res = await fetch(url, {
    headers: { authorization: 'Basic ' + event.secrets.GATEWAY_BASIC_AUTH },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('post-login-context ' + res.status);
  return res.json();
}

async function recordAcceptance(event, agreements) {
  const geo = event.request.geoip;
  const res = await fetch(event.secrets.API_GATEWAY_URL + '/v1/agreements', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + event.secrets.GATEWAY_BASIC_AUTH },
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      customerId: event.user.app_metadata.customer_id,
      acceptedAt: new Date().toISOString(),
      agreements: agreements.map(function (a) {
        return { agreementTypeId: a.agreementTypeId, version: a.version };
      }),
      evidence: {
        ipAddress: event.request.ip,
        userAgent: event.request.user_agent,
        geo: geo ? { country: geo.countryCode, region: geo.subdivisionCode } : null,
        nameSnapshot: event.user.name,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status !== 202) throw new Error('accept ' + res.status);
}
`;
}

/** One jest case: the AC id and label, and the body. */
export interface ActionCase {
  label: string;
  body: string;
}

function itBlock(c: ActionCase, indent: string): string {
  const body = c.body
    .split("\n")
    .map((l) => (l ? indent + l : l))
    .join("\n");
  return `${indent}  it(${tstr(c.label)}, async () => {\n${body}\n${indent}  });`;
}

/** The action's jest file; `group` nests a later change's cases in their own describe. */
export function actionTestFile(cases: readonly ActionCase[], fixtures = BAA_FIXTURES, group?: { title: string; cases: readonly ActionCase[] }): string {
  const nested = group
    ? `\n\n  describe(${tstr(group.title)}, () => {\n${group.cases.map((c) => itBlock(c, "  ")).join("\n\n")}\n  });`
    : "";
  return `const { onExecutePostLogin, onContinuePostLogin } = require('./terms-gate');
const { makeApi, makeEvent, mockGateway } = require('../../test/support/action-harness');

${fixtures}

describe('terms-gate post-login action', () => {
${cases.map((c) => itBlock(c, "")).join("\n\n")}${nested}
});
`;
}

const BAA_FIXTURES = `const BAA = { agreementTypeId: 101, key: 'brand-ambassador-agreement', version: '2026.2', title: { en: 'Brand Ambassador Agreement', es: 'Contrato de Embajador de Marca' } };
const PNP = { agreementTypeId: 102, key: 'policies-and-procedures', version: '2026.1', title: { en: 'Policies & Procedures', es: 'Políticas y Procedimientos' } };`;

export const PRIVACY_FIXTURES = `${BAA_FIXTURES}
const PRIVACY = { agreementTypeId: 103, key: 'privacy-policy', version: '2026.3', title: { en: 'Privacy Policy', es: 'Política de Privacidad' } };`;

export const ACTIONS_TF_BEFORE = `resource "auth0_action" "mfa_policy" {
  name    = "mfa-policy"
  runtime = "node22"
  deploy  = true
  code    = file("\${path.module}/actions/post-login/mfa-policy.js")

  supported_triggers {
    id      = "post-login"
    version = "v3"
  }
}

resource "auth0_trigger_actions" "post_login" {
  trigger = "post-login"

  actions {
    id           = auth0_action.mfa_policy.id
    display_name = auth0_action.mfa_policy.name
  }
}
`;

/** actions.tf with an action appended after the MFA policy and bound to the post-login trigger. */
export function actionsTfWith(resource: string, name: string, file: string, secrets: readonly string[], base = ACTIONS_TF_BEFORE): string {
  const block = `resource "auth0_action" "${resource}" {
  name    = "${name}"
  runtime = "node22"
  deploy  = true
  code    = file("\${path.module}/${file}")

  supported_triggers {
    id      = "post-login"
    version = "v3"
  }
${secrets
  .map(
    (s) => `
  secrets {
    name  = "${s}"
    value = var.${s.toLowerCase()}
  }`,
  )
  .join("\n")}
}

`;
  const binding = `

  actions {
    id           = auth0_action.${resource}.id
    display_name = auth0_action.${resource}.name
  }
}
`;
  const idx = base.indexOf('resource "auth0_trigger_actions"');
  const withResource = base.slice(0, idx) + block + base.slice(idx);
  return withResource.replace(/\n}\n$/, binding);
}

export const ACTIONS_TF_WITH_GATE = actionsTfWith("terms_gate", "terms-gate", TERMS_GATE_JS, ["API_GATEWAY_URL", "GATEWAY_BASIC_AUTH"]);

/** The Auth0 Form the gate renders, with English and Spanish copy (TG), plus the PPR heading. */
export function agreementFormTf(variant: GateVariant): string {
  const privacy = variant === "all-customer-types";
  return `resource "auth0_form" "agreement_acceptance" {
  name = "Agreement acceptance"

  languages {
    primary = "en"
    default = "en"
  }

  messages {
    custom = jsonencode({
      en = {
        heading         = "Please accept your agreements"${privacy ? `\n        heading_privacy = "We updated our Privacy Policy"` : ""}
        checkbox        = "I have read and accept the updated documents"
        accept          = "Accept and continue"
        decline         = "Sign out"
      }
      es = {
        heading         = "Acepta tus acuerdos"${privacy ? `\n        heading_privacy = "Actualizamos nuestra Política de Privacidad"` : ""}
        checkbox        = "He leído y acepto los documentos actualizados"
        accept          = "Aceptar y continuar"
        decline         = "Cerrar sesión"
      }
    })
  }

  nodes = file("\${path.module}/forms/agreement-acceptance.nodes.json")

  ending {
    resume_flow = true
  }
}
`;
}

/** Output of `terraform plan` for the contract check. */
export function planOutput(lines: readonly string[], add: number, change: number): { output: string; summary: string } {
  return {
    output: `${lines.map((l) => `  # ${l}`).join("\n")}\n\nPlan: ${add} to add, ${change} to change, 0 to destroy.`,
    summary: `plan: ${add} to add, ${change} to change`,
  };
}

/**
 * Any other terraform-auth0 task: a small post-login action of its own (after the terms gate in
 * the trigger), a jest case per acceptance criterion, and its terraform resource.
 */
export function auth0Impl(task: RunTask): TaskImpl {
  const slug = kebabCase(stripScope(task.title)) || "post-login-step";
  const file = `actions/post-login/${slug}.js`;
  const testFile = `actions/post-login/${slug}.test.js`;
  const key = task.jiraKey ?? task.id;
  const claim = `https://plexus.com/${slug.replace(/-/g, "_")}`;
  const action = `/**
 * ${key}: ${stripScope(task.title)}. Post-login action; runs after terms-gate in the post-login
 * trigger and never blocks the login.
 */
exports.onExecutePostLogin = async (event, api) => {
  if (event.transaction?.protocol === 'oauth2-refresh-token') return;
  const customerId = event.user.app_metadata?.customer_id;
  if (!customerId) return;
  api.idToken.setCustomClaim('${claim}', {
    customerId: customerId,
    customerTypeId: event.user.app_metadata.customer_type_id,
    checkedAt: new Date().toISOString(),
  });
};
`;
  const acs = task.acceptanceCriteria.length ? task.acceptanceCriteria : [{ id: "AC-1", text: "adds the claim" }];
  const bodies = [
    `    const api = makeApi();
    await onExecutePostLogin(makeEvent({ customerId: 2081544 }), api);
    expect(api.idToken.setCustomClaim).toHaveBeenCalledWith('${claim}', expect.objectContaining({ customerId: 2081544 }));`,
    `    const api = makeApi();
    await onExecutePostLogin(makeEvent({ customerId: undefined }), api);
    expect(api.idToken.setCustomClaim).not.toHaveBeenCalled();`,
    `    const api = makeApi();
    await onExecutePostLogin(makeEvent({ protocol: 'oauth2-refresh-token' }), api);
    expect(api.access.deny).not.toHaveBeenCalled();`,
  ];
  const coverage: Record<string, string> = {};
  const cases = acs.map((ac, i) => {
    coverage[ac.id] = `${slug}.test.js › ${ac.id}`;
    return `  it(${tstr(`${ac.id}: ${clip(ac.text, 80)}`)}, async () => {\n${bodies[i % bodies.length]}\n  });`;
  });
  const test = `const { onExecutePostLogin } = require('./${slug}');
const { makeApi, makeEvent } = require('../../test/support/action-harness');

describe('${slug} post-login action', () => {
${cases.join("\n\n")}
});
`;
  const resource = slug.replace(/-/g, "_");
  return {
    summary: `Added the ${slug} post-login action to terraform-auth0 (after terms-gate in the post-login trigger) with ${acs.length} jest cases and its auth0_action resource.`,
    notes: ["The action only adds a claim; it never denies a login, so it cannot degrade the terms gate."],
    files: [
      { path: file, after: action },
      { path: testFile, after: test },
      { path: ACTIONS_TF, before: ACTIONS_TF_WITH_GATE, after: actionsTfWith(resource, slug, file, [], ACTIONS_TF_WITH_GATE) },
    ],
    primaryFile: file,
    acCoverage: coverage,
    baseTests: 31,
    suites: 6,
    checks: { contract: planOutput([`auth0_action.${resource} will be created`, "auth0_trigger_actions.post_login will be updated in-place"], 1, 1) },
  };
}

/** Generic rework for an action: a jest case named after the feedback (every test file imports these helpers). */
export function auth0ReworkTest(cycle: number, feedback: string): string {
  return `
  it(${tstr(`review follow-up ${cycle}: ${clip(feedback, 70)}`)}, async () => {
    const api = makeApi();
    await onExecutePostLogin(makeEvent({ protocol: 'oauth2-refresh-token' }), api);
    expect(api.access.deny).not.toHaveBeenCalled();
  });`;
}
