import "server-only";
/**
 * pww-automation (Kotlin + Playwright, the QA automation repo): a page object and a test class
 * with one scenario per acceptance criterion, registered in the suite file.
 */
import { clip, featureName, stripScope } from "@/server/mock/workflows/delivery-lib/util";
import type { RunTask, TaskImpl } from "../types";
import { testName } from "./repos";

export interface E2eOpts {
  name?: string;
  /** Portal path the page object opens. */
  url?: string;
  baseTests?: number;
}

export const SUITE_YAML = `# Suites run by the nightly job and by qa-verify.
suites:
  agreements:
    tags: [agreements, internal-apps]
    classes:
      - com.plexus.pww.agreements.CustomerAgreementsTest
      - com.plexus.pww.agreements.TermsGateTest
`;

function kstr(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$")}"`;
}

export function e2eImpl(task: RunTask, opts: E2eOpts = {}): TaskImpl {
  const n = opts.name ?? featureName(stripScope(task.title).replace(/^E2E:?\s*/i, ""));
  const url = opts.url ?? "/agreements/progress";
  const key = task.jiraKey ?? task.id;
  const page = `package com.plexus.pww.pages

import com.microsoft.playwright.Locator
import com.microsoft.playwright.Page
import com.microsoft.playwright.options.AriaRole

/** ${key}: page object for ${url}. */
class ${n}Page(private val page: Page) {
    val heading: Locator get() = page.getByRole(AriaRole.HEADING, Page.GetByRoleOptions().setLevel(1))
    val rows: Locator get() = page.locator("table[aria-label='Agreement coverage'] tbody tr")
    val errorState: Locator get() = page.getByTestId("error-state")
    val exportButton: Locator get() = page.getByRole(AriaRole.BUTTON, Page.GetByRoleOptions().setName("Export CSV"))

    fun open(baseUrl: String): ${n}Page {
        page.navigate("\$baseUrl${url}")
        page.waitForLoadState()
        return this
    }

    fun coverageOf(agreement: String): String =
        rows.filter(Locator.FilterOptions().setHasText(agreement)).locator("td").last().innerText()
}
`;
  const acs = task.acceptanceCriteria.length ? task.acceptanceCriteria : [{ id: "AC-1", text: "page renders" }];
  const coverage: Record<string, string> = {};
  const bodies = [
    `        val progress = ${n}Page(legalUser.page).open(env.portalUrl)
        assertThat(progress.heading).hasText("Agreement Progress")
        assertThat(progress.rows).not().hasCount(0)`,
    `        env.flags.set("agreement-progress-page", false)
        val progress = ${n}Page(legalUser.page).open(env.portalUrl)
        assertThat(progress.heading).not().isVisible()`,
    `        val progress = ${n}Page(legalUser.page).open(env.portalUrl)
        assertEquals("93.1%", progress.coverageOf("Brand Ambassador Agreement"))`,
    `        val progress = ${n}Page(supportUser.page).open(env.portalUrl)
        assertThat(progress.heading).not().isVisible()
        assertThat(supportUser.page).hasURL(Regex(".*/forbidden"))`,
  ];
  const cases = acs
    .map((ac, i) => {
      const m = testName(ac.text);
      coverage[ac.id] = `${n}Test.${m}`;
      return `    @Test
    @DisplayName(${kstr(`${ac.id}: ${clip(ac.text, 80)}`)})
    fun ${m}() {
${bodies[i % bodies.length]}
    }`;
    })
    .join("\n\n");
  const test = `package com.plexus.pww.agreements

import com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat
import com.plexus.pww.framework.BaseUiTest
import com.plexus.pww.framework.TestEnvironment
import com.plexus.pww.pages.${n}Page
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

/** ${key}: ${stripScope(task.title)}. */
@Tag("agreements")
class ${n}Test : BaseUiTest() {
    private val env = TestEnvironment.current()
    private val legalUser by lazy { env.login("qa-legal-01") }
    private val supportUser by lazy { env.login("qa-support-01") }

${cases}
}
`;
  const suite = SUITE_YAML.replace(
    "      - com.plexus.pww.agreements.TermsGateTest\n",
    `      - com.plexus.pww.agreements.TermsGateTest\n      - com.plexus.pww.agreements.${n}Test\n`,
  );
  return {
    summary: `Added ${n}Test to pww-automation (${acs.length} Playwright scenarios against ${url} with Legal and non-Legal accounts), a ${n}Page page object, and registered it in the agreements suite.`,
    notes: ["Test accounts qa-legal-01 and qa-support-01 exist on internal-apps-test; the flag is toggled through the test environment's LaunchDarkly client."],
    files: [
      { path: `src/test/kotlin/com/plexus/pww/pages/${n}Page.kt`, after: page },
      { path: `src/test/kotlin/com/plexus/pww/agreements/${n}Test.kt`, after: test },
      { path: "src/test/resources/suites/agreements.yaml", before: SUITE_YAML, after: suite },
    ],
    primaryFile: `src/test/kotlin/com/plexus/pww/agreements/${n}Test.kt`,
    acCoverage: coverage,
    baseTests: opts.baseTests ?? 212,
  };
}

export function e2eReworkTest(name: string, cycle: number, feedback: string): string {
  return `
    @Test
    @DisplayName(${kstr(`Review follow-up ${cycle}: ${clip(feedback, 70)}`)})
    fun reviewFollowUp${cycle}() {
        val progress = ${name}Page(legalUser.page).open(env.portalUrl)
        assertThat(progress.errorState).not().isVisible()
    }`;
}
