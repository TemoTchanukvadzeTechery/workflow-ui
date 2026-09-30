import "server-only";
/**
 * Code for the two seeded projects built on the Auth0 terms gate. TG (Agreement Acceptance at
 * Login) creates the agreement tables, the post-login context, the acceptance consumer, the
 * gateway routes, the post-login action and its E2E suite; PPR (Privacy Policy Re-acceptance)
 * widens them to Preferred and Retail customers and to scheduled versions. PPR's branch-point
 * files are TG's final files, so its diffs are small, reviewable changes on top.
 */
import type { Fault, RunTask, TaskImpl } from "./types";
import {
  ACTIONS_TF,
  ACTIONS_TF_BEFORE,
  ACTIONS_TF_WITH_GATE,
  AGREEMENT_FORM_TF,
  PRIVACY_FIXTURES,
  TERMS_GATE_JS,
  TERMS_GATE_TEST,
  TG_KEYS,
  actionTestFile,
  agreementFormTf,
  planOutput,
  termsGateAction,
  type ActionCase,
} from "./templates/auth0";
import { SUITE_YAML } from "./templates/e2e";
import { AGREEMENTS_ROUTES_YAML } from "./templates/gateway";
import { APPLICATION_YML } from "./templates/java";

const PKG = "src/main/java/com/plexus/customer/terms";
const TPKG = "src/test/java/com/plexus/customer/terms";
const MIGRATIONS = "src/main/resources/db/migration";
const PWW = "src/test/kotlin/com/plexus/pww";

function keyOf(task: RunTask): string {
  return task.jiraKey ?? task.id;
}

/** AC ids of a task in order, so coverage maps follow whatever the developer kept in the plan. */
function acIds(task: RunTask): string[] {
  return task.acceptanceCriteria.map((a) => a.id);
}

function coverageFor(task: RunTask, tests: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  acIds(task).forEach((id, i) => {
    if (tests[i]) out[id] = tests[i];
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// customer-service-v2: tables and Contentful provisioning (TG T-1, PPR T-2)
// ---------------------------------------------------------------------------------------------

function tablesSql(key: string): string {
  return `-- ${key}: agreement definitions (from Contentful), who must accept them, and the append-only
-- acceptance record. CustomerAgreement rows are the authority in a dispute; nothing updates them.
CREATE TABLE CustomerAgreementType (
    CustomerAgreementTypeID INT IDENTITY(1, 1) PRIMARY KEY,
    ContentfulEntryID       NVARCHAR(64)  NOT NULL,
    AgreementKey            NVARCHAR(64)  NOT NULL,
    Description             NVARCHAR(200) NOT NULL,
    DescriptionEs           NVARCHAR(200) NULL,
    Version                 NVARCHAR(16)  NOT NULL,
    IsActive                BIT           NOT NULL DEFAULT 1,
    PublishedAt             DATETIME2     NOT NULL,
    EffectiveDate           DATETIME2     NULL,
    CONSTRAINT UQ_CustomerAgreementType_Entry_Version UNIQUE (ContentfulEntryID, Version)
);

CREATE TABLE CustomerAgreementRequirement (
    CustomerAgreementRequirementID INT IDENTITY(1, 1) PRIMARY KEY,
    AgreementKey   NVARCHAR(64) NOT NULL,
    CustomerTypeID INT          NOT NULL,
    CountryCode    CHAR(2)      NOT NULL DEFAULT 'US',
    IsActive       BIT          NOT NULL DEFAULT 1
);

CREATE TABLE CustomerAgreement (
    CustomerAgreementID     BIGINT IDENTITY(1, 1) PRIMARY KEY,
    EventID                 UNIQUEIDENTIFIER NOT NULL,
    CustomerID              INT           NOT NULL,
    CustomerAgreementTypeID INT           NOT NULL REFERENCES CustomerAgreementType (CustomerAgreementTypeID),
    Version                 NVARCHAR(16)  NOT NULL,
    AcceptedAt              DATETIME2     NOT NULL,
    IpAddress               NVARCHAR(45)  NOT NULL,
    UserAgent               NVARCHAR(512) NOT NULL,
    GeoCountry              CHAR(2)       NULL,
    GeoRegion               NVARCHAR(8)   NULL,
    NameSnapshot            NVARCHAR(200) NOT NULL,
    CONSTRAINT UQ_CustomerAgreement_Event_Type UNIQUE (EventID, CustomerAgreementTypeID)
);

CREATE INDEX IX_CustomerAgreement_Customer ON CustomerAgreement (CustomerID, CustomerAgreementTypeID);

-- Brand Ambassadors (CustomerTypeID 1) accept all three documents.
INSERT INTO CustomerAgreementRequirement (AgreementKey, CustomerTypeID) VALUES
    ('brand-ambassador-agreement', 1),
    ('policies-and-procedures', 1),
    ('privacy-policy', 1);
`;
}

function webhookController(key: string): string {
  return `package com.plexus.customer.terms;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * ${key}: POST /api/v1/webhooks/contentful. api-gateway checks the Contentful signature and the IP
 * allow-list before forwarding; this controller only provisions published agreement versions.
 */
@RestController
@RequestMapping("/api/v1/webhooks/contentful")
public class ContentfulWebhookController {

    static final String PUBLISH = "ContentManagement.Entry.publish";

    private final AgreementProvisioningService provisioning;

    public ContentfulWebhookController(AgreementProvisioningService provisioning) {
        this.provisioning = provisioning;
    }

    @PostMapping
    public ResponseEntity<Void> onPublish(
            @RequestHeader("X-Contentful-Topic") String topic,
            @RequestBody ContentfulEntry entry) {
        if (!PUBLISH.equals(topic) || !entry.isAgreement()) {
            return ResponseEntity.accepted().build();
        }
        provisioning.provision(entry);
        return ResponseEntity.noContent().build();
    }
}
`;
}

function contentfulEntry(key: string, effective: boolean): string {
  return `package com.plexus.customer.terms;

import java.time.Instant;
import java.util.Map;

/** ${key}: the fields of a published "Login Agreement Consent Form" entry the service needs. */
public record ContentfulEntry(Sys sys, Fields fields) {

    public record Sys(String id, String contentTypeId, Instant publishedAt) {
    }

    public record Fields(String agreementKey, Map<String, String> title, String version${effective ? ", Instant effectiveDate" : ""}) {
    }

    boolean isAgreement() {
        return "loginAgreementConsentForm".equals(sys.contentTypeId()) && fields.agreementKey() != null;
    }
}
`;
}

const PROVISIONING_BEFORE_DEACTIVATE = `        // A new version replaces the previous one at once, so every customer is prompted again.
        jdbc.update(DEACTIVATE_OLDER, params);`;
const PROVISIONING_AFTER_DEACTIVATE = `        // A scheduled version (Legal publishes ahead of the effective date) leaves the current one
        // active; the outstanding query switches over on the effective date (PPR_KEY).
        if (entry.fields().effectiveDate() == null || !entry.fields().effectiveDate().isAfter(clock.instant())) {
            jdbc.update(DEACTIVATE_OLDER, params);
        }`;

function provisioningService(key: string, effective: boolean, pprKey = ""): string {
  const deactivate = effective ? PROVISIONING_AFTER_DEACTIVATE.replace("PPR_KEY", pprKey) : PROVISIONING_BEFORE_DEACTIVATE;
  return `package com.plexus.customer.terms;

import java.sql.Timestamp;
import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** ${key}: one CustomerAgreementType row per published agreement version. */
@Service
public class AgreementProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(AgreementProvisioningService.class);

    static final String INSERT_IF_ABSENT = """
            INSERT INTO CustomerAgreementType
                   (ContentfulEntryID, AgreementKey, Description, DescriptionEs, Version, PublishedAt, EffectiveDate)
            SELECT :entryId, :agreementKey, :title, :titleEs, :version, :publishedAt, :effectiveDate
             WHERE NOT EXISTS (SELECT 1 FROM CustomerAgreementType
                                WHERE ContentfulEntryID = :entryId AND Version = :version)
            """;

    static final String DEACTIVATE_OLDER = """
            UPDATE CustomerAgreementType
               SET IsActive = 0
             WHERE AgreementKey = :agreementKey AND Version <> :version AND IsActive = 1
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final Clock clock;

    public AgreementProvisioningService(NamedParameterJdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** Returns false when the version was already provisioned (Contentful re-delivers webhooks). */
    @Transactional
    public boolean provision(ContentfulEntry entry) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("entryId", entry.sys().id())
                .addValue("agreementKey", entry.fields().agreementKey())
                .addValue("title", entry.fields().title().get("en-US"))
                .addValue("titleEs", entry.fields().title().get("es-US"))
                .addValue("version", entry.fields().version())
                .addValue("publishedAt", Timestamp.from(entry.sys().publishedAt()))
                .addValue("effectiveDate", ${effective ? "entry.fields().effectiveDate() == null ? null : Timestamp.from(entry.fields().effectiveDate())" : "null"});
        if (jdbc.update(INSERT_IF_ABSENT, params) == 0) {
            log.info("agreements.provision skipped key={} version={} (already provisioned)",
                    entry.fields().agreementKey(), entry.fields().version());
            return false;
        }
${deactivate}
        log.info("agreements.provision key={} version={}", entry.fields().agreementKey(), entry.fields().version());
        return true;
    }
}
`;
}

const PROVISIONING_TEST_CASES = [
  `    @Test
    @DisplayName("AC-1: a published version becomes one active CustomerAgreementType row")
    void publishedVersionIsProvisioned() {
        when(jdbc.update(eq(AgreementProvisioningService.INSERT_IF_ABSENT), any(MapSqlParameterSource.class))).thenReturn(1);

        assertThat(service.provision(entry("2026.2", null))).isTrue();
        verify(jdbc).update(eq(AgreementProvisioningService.INSERT_IF_ABSENT), any(MapSqlParameterSource.class));
    }`,
  `    @Test
    @DisplayName("AC-2: a re-delivered webhook does not create a duplicate version")
    void redeliveredWebhookIsIgnored() {
        when(jdbc.update(eq(AgreementProvisioningService.INSERT_IF_ABSENT), any(MapSqlParameterSource.class))).thenReturn(0);

        assertThat(service.provision(entry("2026.2", null))).isFalse();
        verify(jdbc, never()).update(eq(AgreementProvisioningService.DEACTIVATE_OLDER), any(MapSqlParameterSource.class));
    }`,
  `    @Test
    @DisplayName("AC-3: a new version deactivates the previous one so customers are prompted again")
    void newVersionDeactivatesThePreviousOne() {
        when(jdbc.update(eq(AgreementProvisioningService.INSERT_IF_ABSENT), any(MapSqlParameterSource.class))).thenReturn(1);

        service.provision(entry("2026.3", null));

        verify(jdbc).update(eq(AgreementProvisioningService.DEACTIVATE_OLDER), any(MapSqlParameterSource.class));
    }`,
];

const PROVISIONING_SCHEDULED_CASES = [
  `    @Test
    @DisplayName("AC-1: a version published ahead of its effective date keeps the current one active")
    void scheduledVersionKeepsTheCurrentOneActive() {
        when(jdbc.update(eq(AgreementProvisioningService.INSERT_IF_ABSENT), any(MapSqlParameterSource.class))).thenReturn(1);

        service.provision(entry("2026.3", Instant.parse("2026-11-01T05:00:00Z")));

        verify(jdbc, never()).update(eq(AgreementProvisioningService.DEACTIVATE_OLDER), any(MapSqlParameterSource.class));
    }`,
  `    @Test
    @DisplayName("AC-2: a version whose effective date has passed replaces the current one")
    void effectiveVersionReplacesTheCurrentOne() {
        when(jdbc.update(eq(AgreementProvisioningService.INSERT_IF_ABSENT), any(MapSqlParameterSource.class))).thenReturn(1);

        service.provision(entry("2026.3", Instant.parse("2026-09-01T05:00:00Z")));

        verify(jdbc).update(eq(AgreementProvisioningService.DEACTIVATE_OLDER), any(MapSqlParameterSource.class));
    }`,
];

function provisioningTest(effective: boolean, extra: readonly string[] = []): string {
  const entry = effective
    ? `new ContentfulEntry.Fields("privacy-policy", Map.of("en-US", "Privacy Policy", "es-US", "Política de Privacidad"), version, effectiveDate)`
    : `new ContentfulEntry.Fields("privacy-policy", Map.of("en-US", "Privacy Policy", "es-US", "Política de Privacidad"), version)`;
  return `package com.plexus.customer.terms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

class AgreementProvisioningServiceTest {

    private static final Instant NOW = Instant.parse("2026-09-29T13:58:04Z");

    private final NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
    private final AgreementProvisioningService service =
            new AgreementProvisioningService(jdbc, Clock.fixed(NOW, ZoneOffset.UTC));

${[...PROVISIONING_TEST_CASES, ...extra].join("\n\n")}

    private static ContentfulEntry entry(String version, Instant effectiveDate) {
        return new ContentfulEntry(
                new ContentfulEntry.Sys("5KsDBWseXY6QegucYAoacS", "loginAgreementConsentForm", NOW),
                ${entry});
    }
}
`;
}

// ---------------------------------------------------------------------------------------------
// customer-service-v2: post-login context (TG T-2, PPR T-1 and T-2)
// ---------------------------------------------------------------------------------------------

function outstandingQuery(key: string, effective: boolean, pprKey = ""): string {
  const versionFilter = effective
    ? `             WHERE (t.IsActive = 1 OR t.EffectiveDate > :asOf)
               AND (t.EffectiveDate IS NULL OR t.EffectiveDate <= :asOf)
               AND NOT EXISTS (
                   -- ${pprKey}: a scheduled version takes over on its effective date.
                   SELECT 1 FROM CustomerAgreementType n
                    WHERE n.AgreementKey = t.AgreementKey AND n.EffectiveDate <= :asOf
                      AND n.EffectiveDate > COALESCE(t.EffectiveDate, t.PublishedAt))`
    : "             WHERE t.IsActive = 1";
  return `package com.plexus.customer.terms;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * ${key}: the current versions a customer's type must accept and the customer has not accepted.
 * One set-based query per login; indexed on CustomerAgreement (CustomerID, CustomerAgreementTypeID).
 */
@Repository
public class OutstandingAgreementsQuery {

    static final String SQL = """
            SELECT t.CustomerAgreementTypeID, t.AgreementKey, t.Description, t.DescriptionEs, t.Version
              FROM CustomerAgreementType t
              JOIN CustomerAgreementRequirement r
                ON r.AgreementKey = t.AgreementKey AND r.IsActive = 1
               AND r.CustomerTypeID = :customerTypeId AND r.CountryCode = :countryCode
${versionFilter}
               AND NOT EXISTS (
                   SELECT 1 FROM CustomerAgreement a
                    WHERE a.CustomerID = :customerId
                      AND a.CustomerAgreementTypeID = t.CustomerAgreementTypeID)
             ORDER BY t.AgreementKey
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final Clock clock;

    public OutstandingAgreementsQuery(NamedParameterJdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public List<PostLoginContext.Agreement> forCustomer(int customerId, int customerTypeId, String countryCode) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("customerId", customerId)
                .addValue("customerTypeId", customerTypeId)
                .addValue("countryCode", countryCode)
                .addValue("asOf", Timestamp.from(clock.instant()));
        return jdbc.query(SQL, params, (rs, i) -> new PostLoginContext.Agreement(
                rs.getInt("CustomerAgreementTypeID"),
                rs.getString("AgreementKey"),
                rs.getString("Version"),
                Map.of("en", rs.getString("Description"),
                        "es", rs.getString("DescriptionEs") == null ? rs.getString("Description") : rs.getString("DescriptionEs"))));
    }
}
`;
}

const POST_LOGIN_CONTEXT = `package com.plexus.customer.terms;

import java.util.List;
import java.util.Map;

/** What the Auth0 terms gate reads on every login. */
public record PostLoginContext(int customerId, int customerTypeId, boolean gateEnabled, List<Agreement> outstandingAgreements) {

    public record Agreement(int agreementTypeId, String key, String version, Map<String, String> title) {
    }
}
`;

const GATE_ENABLED_TG = `        boolean gateEnabled = customer.customerTypeId() == CustomerTypes.BRAND_AMBASSADOR
                && flags.enabled(GATE_FLAG, customerId);`;
const GATE_ENABLED_PPR = `        boolean gateEnabled = switch (customer.customerTypeId()) {
            case CustomerTypes.BRAND_AMBASSADOR -> flags.enabled(GATE_FLAG, customerId);
            // PPR_KEY: Preferred and Retail customers are gated for the Privacy Policy only.
            case CustomerTypes.PREFERRED, CustomerTypes.RETAIL -> flags.enabled(ALL_TYPES_FLAG, customerId);
            default -> false;
        };`;

function postLoginController(key: string, allTypes: boolean, pprKey = ""): string {
  return `package com.plexus.customer.terms;

import com.plexus.customer.flags.FeatureFlags;
import com.plexus.customer.profile.CustomerLookup;
import com.plexus.customer.profile.CustomerTypes;
import io.micrometer.core.annotation.Timed;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** ${key}: GET /v1/sso/post-login-context, read by the Auth0 terms gate on every login. */
@RestController
@RequestMapping("/v1/sso/post-login-context")
public class PostLoginContextController {

    static final String GATE_FLAG = "ambassador-upgrade-agreements-enabled";${allTypes ? '\n    static final String ALL_TYPES_FLAG = "privacy-reacceptance-all-customer-types";' : ""}

    private final CustomerLookup customers;
    private final OutstandingAgreementsQuery outstanding;
    private final FeatureFlags flags;

    public PostLoginContextController(CustomerLookup customers, OutstandingAgreementsQuery outstanding, FeatureFlags flags) {
        this.customers = customers;
        this.outstanding = outstanding;
        this.flags = flags;
    }

    @GetMapping
    @Timed(value = "sso.post_login_context", percentiles = {0.95})
    public PostLoginContext get(@RequestParam int customerId) {
        CustomerLookup.Customer customer = customers.byId(customerId);
${allTypes ? GATE_ENABLED_PPR.replace("PPR_KEY", pprKey) : GATE_ENABLED_TG}
        List<PostLoginContext.Agreement> agreements = gateEnabled
                ? outstanding.forCustomer(customerId, customer.customerTypeId(), customer.countryCode())
                : List.of();
        return new PostLoginContext(customerId, customer.customerTypeId(), gateEnabled, agreements);
    }
}
`;
}

const CONTEXT_TEST_CASES = [
  `    @Test
    @DisplayName("AC-1: an ambassador with an unaccepted current version gets it as outstanding")
    void unacceptedCurrentVersionIsOutstanding() {
        givenCustomer(CustomerTypes.BRAND_AMBASSADOR);
        when(outstanding.forCustomer(2081544, CustomerTypes.BRAND_AMBASSADOR, "US")).thenReturn(List.of(BAA));

        PostLoginContext context = controller.get(2081544);

        assertThat(context.gateEnabled()).isTrue();
        assertThat(context.outstandingAgreements()).containsExactly(BAA);
    }`,
  `    @Test
    @DisplayName("AC-2: an ambassador who accepted every current version gets an empty list")
    void fullyAcceptedAmbassadorHasNothingOutstanding() {
        givenCustomer(CustomerTypes.BRAND_AMBASSADOR);
        when(outstanding.forCustomer(2081544, CustomerTypes.BRAND_AMBASSADOR, "US")).thenReturn(List.of());

        assertThat(controller.get(2081544).outstandingAgreements()).isEmpty();
    }`,
  `    @Test
    @DisplayName("AC-3: titles are returned in English and Spanish")
    void titlesInEnglishAndSpanish() {
        givenCustomer(CustomerTypes.BRAND_AMBASSADOR);
        when(outstanding.forCustomer(2081544, CustomerTypes.BRAND_AMBASSADOR, "US")).thenReturn(List.of(BAA));

        assertThat(controller.get(2081544).outstandingAgreements().get(0).title())
                .containsEntry("en", "Brand Ambassador Agreement")
                .containsEntry("es", "Contrato de Embajador de Marca");
    }`,
  `    @Test
    void flagOffMeansNoGate() {
        givenCustomer(CustomerTypes.BRAND_AMBASSADOR);
        when(flags.enabled(PostLoginContextController.GATE_FLAG, 2081544)).thenReturn(false);

        assertThat(controller.get(2081544).gateEnabled()).isFalse();
        verifyNoInteractions(outstanding);
    }`,
];

const CONTEXT_PPR_CASES = [
  `    @Test
    @DisplayName("AC-1: Preferred and Retail customers get the unaccepted Privacy Policy")
    void preferredAndRetailGetThePrivacyPolicy() {
        when(flags.enabled(PostLoginContextController.ALL_TYPES_FLAG, 2081544)).thenReturn(true);
        for (int type : new int[] {CustomerTypes.PREFERRED, CustomerTypes.RETAIL}) {
            givenCustomer(type);
            when(outstanding.forCustomer(2081544, type, "US")).thenReturn(List.of(PRIVACY));

            assertThat(controller.get(2081544).outstandingAgreements()).containsExactly(PRIVACY);
        }
    }`,
  `    @Test
    @DisplayName("AC-3: with the flag off nothing changes for Preferred and Retail customers")
    void allTypesFlagOffKeepsPreferredAndRetailUngated() {
        givenCustomer(CustomerTypes.RETAIL);
        when(flags.enabled(PostLoginContextController.ALL_TYPES_FLAG, 2081544)).thenReturn(false);

        assertThat(controller.get(2081544).gateEnabled()).isFalse();
        verifyNoInteractions(outstanding);
    }`,
];

function contextTest(extra: readonly string[] = []): string {
  const privacy = extra.length
    ? `
    private static final PostLoginContext.Agreement PRIVACY = new PostLoginContext.Agreement(
            103, "privacy-policy", "2026.3", Map.of("en", "Privacy Policy", "es", "Política de Privacidad"));
`
    : "";
  return `package com.plexus.customer.terms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.plexus.customer.flags.FeatureFlags;
import com.plexus.customer.profile.CustomerLookup;
import com.plexus.customer.profile.CustomerTypes;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class PostLoginContextControllerTest {

    private static final PostLoginContext.Agreement BAA = new PostLoginContext.Agreement(
            101, "brand-ambassador-agreement", "2026.2", Map.of("en", "Brand Ambassador Agreement", "es", "Contrato de Embajador de Marca"));
${privacy}
    private final CustomerLookup customers = mock(CustomerLookup.class);
    private final OutstandingAgreementsQuery outstanding = mock(OutstandingAgreementsQuery.class);
    private final FeatureFlags flags = mock(FeatureFlags.class);
    private final PostLoginContextController controller = new PostLoginContextController(customers, outstanding, flags);

    @BeforeEach
    void flagOn() {
        when(flags.enabled(anyString(), anyInt())).thenReturn(true);
    }

${[...CONTEXT_TEST_CASES, ...extra].join("\n\n")}

    private void givenCustomer(int customerTypeId) {
        when(customers.byId(2081544)).thenReturn(new CustomerLookup.Customer(2081544, customerTypeId, "US"));
    }
}
`;
}

function privacyRequirementsSql(key: string): string {
  return `-- ${key}: Preferred (2) and Retail (3) customers must accept the Privacy Policy, and only it.
-- No schema change; the post-login context gates these types behind
-- privacy-reacceptance-all-customer-types until Legal switches it on.
INSERT INTO CustomerAgreementRequirement (AgreementKey, CustomerTypeID, CountryCode)
SELECT 'privacy-policy', t.CustomerTypeID, 'US'
  FROM (VALUES (2), (3)) AS t (CustomerTypeID)
 WHERE NOT EXISTS (SELECT 1 FROM CustomerAgreementRequirement r
                    WHERE r.AgreementKey = 'privacy-policy' AND r.CustomerTypeID = t.CustomerTypeID);
`;
}

// ---------------------------------------------------------------------------------------------
// customer-service-v2: acceptance consumer (TG T-3)
// ---------------------------------------------------------------------------------------------

const ACCEPTED_EVENT = `package com.plexus.customer.terms;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Payload of customerflow.auth0.agreement.accepted.v1, as api-gateway publishes it. */
public record AgreementAcceptedEvent(UUID eventId, int customerId, Instant acceptedAt, List<Item> agreements, Evidence evidence) {

    public record Item(int agreementTypeId, String version) {
    }

    public record Evidence(String ipAddress, String userAgent, Geo geo, String nameSnapshot) {
    }

    public record Geo(String country, String region) {
    }
}
`;

function acceptedConsumer(key: string): string {
  return `package com.plexus.customer.terms;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.annotation.RetryableTopic;
import org.springframework.retry.annotation.Backoff;
import org.springframework.stereotype.Component;

/**
 * ${key}: turns each acceptance event into append-only CustomerAgreement rows. Transient database
 * errors are retried twice with backoff; an event that still fails goes to the .dlt topic.
 */
@Component
public class AgreementAcceptedConsumer {

    static final String TOPIC = "customerflow.auth0.agreement.accepted.v1";

    private static final Logger log = LoggerFactory.getLogger(AgreementAcceptedConsumer.class);

    private final CustomerAgreementWriter writer;

    public AgreementAcceptedConsumer(CustomerAgreementWriter writer) {
        this.writer = writer;
    }

    @RetryableTopic(
            attempts = "3",
            backoff = @Backoff(delay = 1_000, multiplier = 2.0),
            dltTopicSuffix = ".dlt",
            include = TransientDataAccessException.class)
    @KafkaListener(topics = TOPIC, groupId = "customer-service-v2.agreement-acceptance")
    public void onAccepted(AgreementAcceptedEvent event) {
        int written = writer.append(event);
        log.info("agreement.accepted customerId={} eventId={} rows={}", event.customerId(), event.eventId(), written);
    }
}
`;
}

const WRITER_IDEMPOTENT = "                              WHERE c.EventID = :eventId AND c.CustomerAgreementTypeID = :agreementTypeId)";
const WRITER_BROKEN = "                              WHERE c.CustomerID = :customerId AND c.CustomerAgreementTypeID = :agreementTypeId)";

function agreementWriter(key: string): string {
  return `package com.plexus.customer.terms;

import java.sql.Timestamp;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** ${key}: append-only writes; a replayed event (same EventID) never adds a second row. */
@Repository
public class CustomerAgreementWriter {

    static final String INSERT = """
            INSERT INTO CustomerAgreement
                   (EventID, CustomerID, CustomerAgreementTypeID, Version, AcceptedAt,
                    IpAddress, UserAgent, GeoCountry, GeoRegion, NameSnapshot)
            SELECT :eventId, :customerId, :agreementTypeId, :version, :acceptedAt,
                   :ipAddress, :userAgent, :geoCountry, :geoRegion, :nameSnapshot
             WHERE NOT EXISTS (SELECT 1 FROM CustomerAgreement c
${WRITER_IDEMPOTENT})
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public CustomerAgreementWriter(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public int append(AgreementAcceptedEvent event) {
        AgreementAcceptedEvent.Evidence evidence = event.evidence();
        int written = 0;
        for (AgreementAcceptedEvent.Item item : event.agreements()) {
            written += jdbc.update(INSERT, new MapSqlParameterSource()
                    .addValue("eventId", event.eventId())
                    .addValue("customerId", event.customerId())
                    .addValue("agreementTypeId", item.agreementTypeId())
                    .addValue("version", item.version())
                    .addValue("acceptedAt", Timestamp.from(event.acceptedAt()))
                    .addValue("ipAddress", evidence.ipAddress())
                    .addValue("userAgent", evidence.userAgent())
                    .addValue("geoCountry", evidence.geo() == null ? null : evidence.geo().country())
                    .addValue("geoRegion", evidence.geo() == null ? null : evidence.geo().region())
                    .addValue("nameSnapshot", evidence.nameSnapshot()));
        }
        return written;
    }
}
`;
}

const CONSUMER_TEST = `package com.plexus.customer.terms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.kafka.annotation.RetryableTopic;

class AgreementAcceptedConsumerTest {

    private static final UUID EVENT = UUID.fromString("7f3c2a91-0b6e-4c1d-9a55-2d8f6e4b1c07");

    private final NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
    private final CustomerAgreementWriter writer = new CustomerAgreementWriter(jdbc);
    private final AgreementAcceptedConsumer consumer = new AgreementAcceptedConsumer(writer);

    @Test
    @DisplayName("AC-1: each accepted agreement writes one row with customer, type, version and time")
    void eachAcceptedAgreementWritesOneRow() {
        when(jdbc.update(eq(CustomerAgreementWriter.INSERT), argThat((MapSqlParameterSource p) -> true))).thenReturn(1);

        consumer.onAccepted(event());

        verify(jdbc, times(2)).update(eq(CustomerAgreementWriter.INSERT), argThat((MapSqlParameterSource p) ->
                p.getValue("customerId").equals(2081544) && p.getValue("acceptedAt") != null));
    }

    @Test
    @DisplayName("AC-2: the row records IP address, user agent, geolocation and a name snapshot")
    void rowCarriesTheEvidence() {
        consumer.onAccepted(event());

        verify(jdbc, times(2)).update(eq(CustomerAgreementWriter.INSERT), argThat((MapSqlParameterSource p) ->
                "203.0.113.24".equals(p.getValue("ipAddress"))
                        && "US".equals(p.getValue("geoCountry"))
                        && "UT".equals(p.getValue("geoRegion"))
                        && "Jordan Avery".equals(p.getValue("nameSnapshot"))));
    }

    @Test
    @DisplayName("AC-3: a replayed event does not create a second row")
    void replayedEventDoesNotCreateASecondRow() {
        assertThat(CustomerAgreementWriter.INSERT)
                .contains("WHERE c.EventID = :eventId AND c.CustomerAgreementTypeID = :agreementTypeId");
    }

    @Test
    @DisplayName("AC-4: an event that still fails after 3 attempts goes to the .dlt topic")
    void failingEventGoesToTheDeadLetterTopic() throws Exception {
        RetryableTopic retry = AgreementAcceptedConsumer.class
                .getMethod("onAccepted", AgreementAcceptedEvent.class)
                .getAnnotation(RetryableTopic.class);

        assertThat(retry.attempts()).isEqualTo("3");
        assertThat(retry.dltTopicSuffix()).isEqualTo(".dlt");
    }

    private static AgreementAcceptedEvent event() {
        return new AgreementAcceptedEvent(EVENT, 2081544, Instant.parse("2026-08-21T15:02:11Z"),
                List.of(new AgreementAcceptedEvent.Item(101, "2026.2"), new AgreementAcceptedEvent.Item(102, "2026.1")),
                new AgreementAcceptedEvent.Evidence("203.0.113.24", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)",
                        new AgreementAcceptedEvent.Geo("US", "UT"), "Jordan Avery"));
    }
}
`;

const KAFKA_YML = APPLICATION_YML.replace(
  "  datasource:\n",
  `  kafka:
    bootstrap-servers: \${KAFKA_BOOTSTRAP_SERVERS}
    consumer:
      auto-offset-reset: earliest
      properties:
        spring.json.trusted.packages: com.plexus.customer.terms
  datasource:
`,
);

const CONSUMER_FAULT: Fault = {
  check: "unit",
  path: `${PKG}/CustomerAgreementWriter.java`,
  correct: WRITER_IDEMPOTENT,
  broken: WRITER_BROKEN,
  message: "AgreementAcceptedConsumerTest > replayedEventDoesNotCreateASecondRow() FAILED",
  output: `> Task :test FAILED

AgreementAcceptedConsumerTest > replayedEventDoesNotCreateASecondRow() FAILED
    java.lang.AssertionError:
    Expecting actual to contain:
      "WHERE c.EventID = :eventId AND c.CustomerAgreementTypeID = :agreementTypeId"
    (the guard keyed on CustomerID would drop a customer's later acceptance of a new version)
        at CustomerAgreementWriter.java:{line}

Tests: 1 failed, {passed} passed, {total} total
BUILD FAILED in 31s`,
  fixSummary: "Keyed the replay guard in CustomerAgreementWriter on EventID, not CustomerID, so a later acceptance of a new version is still written.",
};

// ---------------------------------------------------------------------------------------------
// api-gateway (TG T-4)
// ---------------------------------------------------------------------------------------------

const ROUTES_TEST = `import { describe, expect, it } from 'vitest';
import { gatewayTestClient, published, stubUpstream, upstreamCalls } from '../support/gateway-test-client';

const gateway = gatewayTestClient({ routes: ['routes/agreements.yaml'] });
const basic = 'Basic ' + Buffer.from('auth0-terms-gate:test-secret').toString('base64');

describe('agreement routes', () => {
  it('AC-1: the terms gate reaches the post-login context with basic auth; other callers get 401', async () => {
    stubUpstream('customer-service-v2', { body: { gateEnabled: true, outstandingAgreements: [] } });
    expect((await gateway.get('/v1/sso/post-login-context?customerId=2081544').set('authorization', basic)).status).toBe(200);
    expect((await gateway.get('/v1/sso/post-login-context?customerId=2081544')).status).toBe(401);
    expect(upstreamCalls('customer-service-v2')).toHaveLength(1);
  });

  it('AC-2: POST /v1/agreements publishes the acceptance and returns 202', async () => {
    const res = await gateway.post('/v1/agreements').set('authorization', basic).send({ eventId: 'e-1', customerId: 2081544, agreements: [] });
    expect(res.status).toBe(202);
    expect(published('customerflow.auth0.agreement.accepted.v1')).toEqual([expect.objectContaining({ key: '2081544' })]);
  });

  it('AC-3: webhook calls without a valid signature or from outside the allow-list get 403', async () => {
    expect((await gateway.post('/api/v1/webhooks/contentful').set('x-contentful-signature', 'bad')).status).toBe(403);
    expect((await gateway.post('/api/v1/webhooks/contentful').set('x-forwarded-for', '198.51.100.7').signed()).status).toBe(403);
  });
});
`;

// ---------------------------------------------------------------------------------------------
// pww-automation (TG T-6, PPR T-4)
// ---------------------------------------------------------------------------------------------

function termsGatePage(key: string, privacy: boolean): string {
  return `package com.plexus.pww.pages

import com.microsoft.playwright.Locator
import com.microsoft.playwright.Page
import com.microsoft.playwright.options.AriaRole

/** ${key}: the Auth0 agreement acceptance form the terms gate renders after login. */
class TermsGatePage(private val page: Page) {
    val heading: Locator get() = page.getByRole(AriaRole.HEADING, Page.GetByRoleOptions().setLevel(1))
    val agreements: Locator get() = page.getByTestId("outstanding-agreement")
    val acceptAll: Locator get() = page.getByRole(AriaRole.CHECKBOX)
    val acceptButton: Locator get() = page.getByRole(AriaRole.BUTTON, Page.GetByRoleOptions().setName(Regex("Accept and continue|Aceptar y continuar")))
    val signOutButton: Locator get() = page.getByRole(AriaRole.BUTTON, Page.GetByRoleOptions().setName(Regex("Sign out|Cerrar sesión")))
${privacy ? '    val policyVersion: Locator get() = page.getByTestId("policy-version")\n    val deniedMessage: Locator get() = page.getByText("Accept the updated Privacy Policy to keep using your account.")\n' : ""}
    fun acceptAndContinue() {
        acceptAll.check()
        acceptButton.click()
        page.waitForURL(Regex(".*/(back-office|account).*"))
    }
}
`;
}

function termsGateTest(key: string): string {
  return `package com.plexus.pww.agreements

import com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat
import com.plexus.pww.framework.BaseUiTest
import com.plexus.pww.framework.TestEnvironment
import com.plexus.pww.pages.TermsGatePage
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

/** ${key}: the agreement gate at login, against internal-apps-test. */
@Tag("agreements")
class TermsGateTest : BaseUiTest() {
    private val env = TestEnvironment.current()

    @Test
    @DisplayName("AC-1: an ambassador with outstanding agreements is gated until they accept")
    fun outstandingAmbassadorIsGated() {
        env.agreements.resetToOutstanding("qa-ambassador-03")
        val session = env.startLogin("qa-ambassador-03")
        val gate = TermsGatePage(session.page)
        assertThat(gate.heading).hasText("Please accept your agreements")
        assertThat(gate.agreements).hasCount(2)
        session.page.navigate(env.backOfficeUrl)
        assertThat(gate.heading).isVisible()
    }

    @Test
    @DisplayName("AC-2: after accepting, the ambassador reaches the back office and a row exists")
    fun acceptingReachesTheBackOffice() {
        env.agreements.resetToOutstanding("qa-ambassador-03")
        val session = env.startLogin("qa-ambassador-03")
        TermsGatePage(session.page).acceptAndContinue()
        assertThat(session.page).hasURL(Regex(".*/back-office.*"))
        assertEquals(2, env.agreements.acceptedSince("qa-ambassador-03", session.startedAt).size)
    }

    @Test
    @DisplayName("AC-3: a Spanish-language session shows the form in Spanish")
    fun spanishSessionShowsSpanishForm() {
        env.agreements.resetToOutstanding("qa-ambassador-03")
        val session = env.startLogin("qa-ambassador-03", locale = "es-US")
        assertThat(TermsGatePage(session.page).heading).hasText("Acepta tus acuerdos")
    }

    @Test
    @DisplayName("AC-4: an ARC session reaches the back office without the gate")
    fun arcSessionSkipsTheGate() {
        env.agreements.resetToOutstanding("qa-ambassador-03")
        val session = env.startArcLogin(operator = "arc-support-02", ambassador = "qa-ambassador-03")
        assertThat(session.page).hasURL(Regex(".*/back-office.*"))
        assertEquals(0, env.agreements.acceptedSince("qa-ambassador-03", session.startedAt).size)
    }
}
`;
}

function privacyTest(key: string): string {
  return `package com.plexus.pww.agreements

import com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat
import com.plexus.pww.framework.BaseUiTest
import com.plexus.pww.framework.TestEnvironment
import com.plexus.pww.pages.TermsGatePage
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import kotlin.test.assertEquals

/** ${key}: Privacy Policy 2026.3 re-acceptance for every customer type. */
@Tag("agreements")
class PrivacyReacceptanceTest : BaseUiTest() {
    private val env = TestEnvironment.current()

    @ParameterizedTest
    @ValueSource(strings = ["qa-ambassador-07", "qa-preferred-02", "qa-retail-05"])
    @DisplayName("AC-1: ambassador, Preferred and Retail customers are prompted once 2026.3 is effective")
    fun everyCustomerTypeIsPrompted(account: String) {
        env.agreements.makeEffective("privacy-policy", "2026.3")
        val gate = TermsGatePage(env.startLogin(account).page)
        assertThat(gate.heading).hasText("We updated our Privacy Policy")
        assertThat(gate.policyVersion).hasText("2026.3")
    }

    @Test
    @DisplayName("AC-2: accepting records a CustomerAgreement row with the version, time and evidence")
    fun acceptingRecordsTheEvidence() {
        val session = env.startLogin("qa-retail-05")
        TermsGatePage(session.page).acceptAndContinue()
        val row = env.agreements.acceptedSince("qa-retail-05", session.startedAt).single()
        assertEquals("2026.3", row.version)
        assertEquals(session.clientIp, row.ipAddress)
    }

    @Test
    @DisplayName("AC-3: declining keeps the customer out of their account")
    fun decliningKeepsTheCustomerOut() {
        val gate = TermsGatePage(env.startLogin("qa-preferred-02").page)
        gate.signOutButton.click()
        assertThat(gate.deniedMessage).isVisible()
    }

    @Test
    @DisplayName("AC-4: a Spanish-language session shows the Spanish policy")
    fun spanishSessionShowsTheSpanishPolicy() {
        val gate = TermsGatePage(env.startLogin("qa-retail-05", locale = "es-US").page)
        assertThat(gate.heading).hasText("Actualizamos nuestra Política de Privacidad")
    }
}
`;
}

const SUITE_BEFORE_TG = SUITE_YAML.replace("      - com.plexus.pww.agreements.TermsGateTest\n", "");
const SUITE_WITH_PRIVACY = SUITE_YAML.replace(
  "      - com.plexus.pww.agreements.TermsGateTest\n",
  "      - com.plexus.pww.agreements.TermsGateTest\n      - com.plexus.pww.agreements.PrivacyReacceptanceTest\n",
);

// ---------------------------------------------------------------------------------------------
// terraform-auth0 action tests (TG T-5, PPR T-3)
// ---------------------------------------------------------------------------------------------

const TG_ACTION_CASES: ActionCase[] = [
  {
    label: "AC-1: renders the acceptance form when agreements are outstanding",
    body: `    mockGateway({ context: { gateEnabled: true, outstandingAgreements: [BAA, PNP] } });
    const api = makeApi();
    await onExecutePostLogin(makeEvent({ customerTypeId: 1 }), api);
    expect(api.prompt.render).toHaveBeenCalledWith('ap_agreement_acceptance', {
      vars: expect.objectContaining({ agreements: [expect.objectContaining({ id: '101' }), expect.objectContaining({ id: '102' })] }),
    });`,
  },
  {
    label: "AC-2: declining or accepting only some agreements denies the session",
    body: `    mockGateway({ context: { gateEnabled: true, outstandingAgreements: [BAA, PNP] } });
    const api = makeApi();
    await onContinuePostLogin(makeEvent({ customerTypeId: 1, prompt: { decision: 'accept', accepted: ['101'] } }), api);
    expect(api.access.deny).toHaveBeenCalledWith('agreements_not_accepted', expect.any(String));
    expect(mockGateway.posted('/v1/agreements')).toHaveLength(0);`,
  },
  {
    label: "AC-3: shows the Spanish titles when the browser language is Spanish",
    body: `    mockGateway({ context: { gateEnabled: true, outstandingAgreements: [BAA] } });
    const api = makeApi();
    await onExecutePostLogin(makeEvent({ customerTypeId: 1, language: 'es-US' }), api);
    expect(api.prompt.render.mock.calls[0][1].vars).toMatchObject({ locale: 'es', agreements: [{ title: 'Contrato de Embajador de Marca' }] });`,
  },
  {
    label: "AC-4: ARC impersonation sessions skip the gate and never record an acceptance",
    body: `    const api = makeApi();
    await onExecutePostLogin(makeEvent({ customerTypeId: 1, arcSession: true }), api);
    expect(api.prompt.render).not.toHaveBeenCalled();
    expect(mockGateway.calls()).toHaveLength(0);`,
  },
  {
    label: "fails open when the post-login context is unavailable",
    body: `    mockGateway({ contextStatus: 503 });
    const api = makeApi();
    await onExecutePostLogin(makeEvent({ customerTypeId: 1 }), api);
    expect(api.access.deny).not.toHaveBeenCalled();`,
  },
];

const PPR_ACTION_CASES: ActionCase[] = [
  {
    label: "AC-1: Preferred and Retail customers with an outstanding Privacy Policy see the prompt",
    body: `    mockGateway({ context: { gateEnabled: true, outstandingAgreements: [PRIVACY] } });
    for (const customerTypeId of [2, 3]) {
      const api = makeApi();
      await onExecutePostLogin(makeEvent({ customerTypeId }), api);
      expect(api.prompt.render.mock.calls[0][1].vars).toMatchObject({ heading: 'privacy-update' });
    }`,
  },
  {
    label: "AC-2: shows the policy in the customer's language",
    body: `    mockGateway({ context: { gateEnabled: true, outstandingAgreements: [PRIVACY] } });
    const api = makeApi();
    await onExecutePostLogin(makeEvent({ customerTypeId: 3, language: 'es-US' }), api);
    expect(api.prompt.render.mock.calls[0][1].vars).toMatchObject({ locale: 'es', agreements: [{ title: 'Política de Privacidad' }] });`,
  },
  {
    label: "AC-3: declining keeps the session blocked with the Privacy Policy message",
    body: `    mockGateway({ context: { gateEnabled: true, outstandingAgreements: [PRIVACY] } });
    const api = makeApi();
    await onContinuePostLogin(makeEvent({ customerTypeId: 2, prompt: { decision: 'decline', accepted: [] } }), api);
    expect(api.access.deny).toHaveBeenCalledWith('agreements_not_accepted', 'Accept the updated Privacy Policy to keep using your account.');`,
  },
  {
    label: "AC-4: adds no new call on the login path",
    body: `    mockGateway({ context: { gateEnabled: false, outstandingAgreements: [] } });
    await onExecutePostLogin(makeEvent({ customerTypeId: 3 }), makeApi());
    expect(mockGateway.calls().map((c) => c.path)).toEqual(['/v1/sso/post-login-context']);`,
  },
];

// The line only exists in the widened action, so the fix swap leaves the task's diff stats alone.
const PPR_ACTION_FAULT: Fault = {
  check: "lint",
  path: TERMS_GATE_JS,
  correct: "  return context.outstandingAgreements.every(function (a) {",
  broken: "  return context.outstandingAgreements.every(function (a, i) {",
  message: "actions/post-login/terms-gate.js:{line}:62 error 'i' is defined but never used (no-unused-vars)",
  output: `actions/post-login/terms-gate.js
  {line}:62  error  'i' is defined but never used  no-unused-vars

1 problem (1 error, 0 warnings)`,
  fixSummary: "Dropped the unused index parameter from onlyPrivacyPolicy in terms-gate.js (no-unused-vars).",
};

// ---------------------------------------------------------------------------------------------
// Task implementations
// ---------------------------------------------------------------------------------------------

function tgImpl(task: RunTask): TaskImpl | undefined {
  const key = keyOf(task);
  const title = task.title.toLowerCase();
  if (task.repo === "customer-service-v2" && /provision|contentful|tables/.test(title)) {
    return {
      summary: "Created the agreement tables (CustomerAgreementType, CustomerAgreementRequirement, append-only CustomerAgreement) and provisioned one active CustomerAgreementType row per version published in Contentful through POST /api/v1/webhooks/contentful.",
      notes: ["Webhook re-deliveries are ignored (unique ContentfulEntryID + Version).", "Signature and IP allow-list checks stay in api-gateway; the controller trusts only forwarded calls."],
      files: [
        { path: `${MIGRATIONS}/V2026_08_03_1__customer_agreement_tables.sql`, after: tablesSql(key) },
        { path: `${PKG}/ContentfulWebhookController.java`, after: webhookController(key) },
        { path: `${PKG}/ContentfulEntry.java`, after: contentfulEntry(key, false) },
        { path: `${PKG}/AgreementProvisioningService.java`, after: provisioningService(key, false) },
        { path: `${TPKG}/AgreementProvisioningServiceTest.java`, after: provisioningTest(false) },
      ],
      primaryFile: `${PKG}/AgreementProvisioningService.java`,
      acCoverage: coverageFor(task, [
        "AgreementProvisioningServiceTest.publishedVersionIsProvisioned",
        "AgreementProvisioningServiceTest.redeliveredWebhookIsIgnored",
        "AgreementProvisioningServiceTest.newVersionDeactivatesThePreviousOne",
      ]),
      baseTests: 24,
      checks: {
        contract: {
          output: "> Task :contractTest\n\nContentfulWebhookContractTest > publishOfLoginAgreementConsentForm() PASSED\nContentfulWebhookContractTest > otherContentTypesAreAccepted() PASSED\n\nBUILD SUCCESSFUL in 13s",
          summary: "webhook contract: 2 cases passed",
        },
      },
    };
  }
  if (task.repo === "customer-service-v2" && /post-login|outstanding/.test(title)) {
    return {
      summary: "Added GET /v1/sso/post-login-context: the current agreement versions the customer's type requires and the customer has not accepted, with English and Spanish titles, gated by ambassador-upgrade-agreements-enabled.",
      notes: ["One set-based query per login, indexed on CustomerAgreement (CustomerID, CustomerAgreementTypeID).", "The flag is evaluated here, so the Auth0 action needs no LaunchDarkly SDK."],
      files: [
        { path: `${PKG}/PostLoginContextController.java`, after: postLoginController(key, false) },
        { path: `${PKG}/PostLoginContext.java`, after: POST_LOGIN_CONTEXT },
        { path: `${PKG}/OutstandingAgreementsQuery.java`, after: outstandingQuery(key, false) },
        { path: `${TPKG}/PostLoginContextControllerTest.java`, after: contextTest() },
      ],
      primaryFile: `${PKG}/PostLoginContextController.java`,
      acCoverage: coverageFor(task, [
        "PostLoginContextControllerTest.unacceptedCurrentVersionIsOutstanding",
        "PostLoginContextControllerTest.fullyAcceptedAmbassadorHasNothingOutstanding",
        "PostLoginContextControllerTest.titlesInEnglishAndSpanish",
        "check:contract p95 latency (budget 50 ms)",
      ]),
      baseTests: 27,
      checks: { contract: { metric: { name: "added latency p95", actual: 31, expected: 50, unit: "ms" } } },
    };
  }
  if (task.repo === "customer-service-v2" && /consumer|accept/.test(title)) {
    return {
      summary: "Consumed customerflow.auth0.agreement.accepted.v1 into append-only CustomerAgreement rows with version, time, IP address, user agent, geolocation and a name snapshot; replays are ignored and failures retry twice before the .dlt topic.",
      notes: ["Acceptance rows are never updated or deleted; a replay guard on EventID keeps writes idempotent."],
      files: [
        { path: `${PKG}/AgreementAcceptedEvent.java`, after: ACCEPTED_EVENT },
        { path: `${PKG}/AgreementAcceptedConsumer.java`, after: acceptedConsumer(key) },
        { path: `${PKG}/CustomerAgreementWriter.java`, after: agreementWriter(key) },
        { path: `${TPKG}/AgreementAcceptedConsumerTest.java`, after: CONSUMER_TEST },
        { path: "src/main/resources/application.yml", before: APPLICATION_YML, after: KAFKA_YML },
      ],
      primaryFile: `${PKG}/AgreementAcceptedConsumer.java`,
      acCoverage: coverageFor(task, [
        "AgreementAcceptedConsumerTest.eachAcceptedAgreementWritesOneRow",
        "AgreementAcceptedConsumerTest.rowCarriesTheEvidence",
        "AgreementAcceptedConsumerTest.replayedEventDoesNotCreateASecondRow",
        "AgreementAcceptedConsumerTest.failingEventGoesToTheDeadLetterTopic",
      ]),
      fault: CONSUMER_FAULT,
      baseTests: 31,
      checks: {
        contract: {
          output: "> Task :contractTest\n\nAgreementAcceptedEventContractTest > matchesTheGatewayPayloadV1() PASSED\nAgreementAcceptedEventContractTest > deadLetterKeepsTheOriginalHeaders() PASSED\n\nBUILD SUCCESSFUL in 17s",
          summary: "event contract matches the api-gateway payload",
          metric: { name: "consumer lag p95", actual: 140, expected: 1000, unit: "ms" },
        },
      },
    };
  }
  if (task.repo === "api-gateway") {
    return {
      summary: "Added the agreement routes to api-gateway: GET /v1/sso/post-login-context (basic auth, 5 s), POST /v1/agreements publishing to customerflow.auth0.agreement.accepted.v1 (202), and POST /api/v1/webhooks/contentful behind the Contentful signature and IP allow-list.",
      notes: ["The gateway authenticates, forwards or publishes; the domain logic stays in customer-service-v2."],
      files: [
        { path: "routes/agreements.yaml", after: AGREEMENTS_ROUTES_YAML },
        { path: "test/routes/agreements.test.ts", after: ROUTES_TEST },
      ],
      primaryFile: "routes/agreements.yaml",
      acCoverage: coverageFor(task, [
        "agreement routes › the terms gate reaches the post-login context with basic auth",
        "agreement routes › POST /v1/agreements publishes the acceptance and returns 202",
        "agreement routes › webhook calls without a valid signature get 403",
      ]),
      baseTests: 112,
      suites: 20,
    };
  }
  if (task.repo === "terraform-auth0") {
    return {
      summary: "Added the terms-gate post-login action: reads the post-login context, renders the Agreement acceptance form (English and Spanish) with the outstanding agreements, denies the session until all are accepted, posts the acceptance with its evidence, and skips ARC impersonation sessions.",
      notes: [
        "The action fails open: if the post-login context is unavailable the login continues and the next login prompts again (nothing on this path may block login).",
        "ambassador-upgrade-agreements-enabled stays off until Legal signs off the copy; it is evaluated in customer-service-v2.",
      ],
      files: [
        { path: TERMS_GATE_JS, after: termsGateAction("ambassadors") },
        { path: TERMS_GATE_TEST, after: actionTestFile(TG_ACTION_CASES) },
        { path: ACTIONS_TF, before: ACTIONS_TF_BEFORE, after: ACTIONS_TF_WITH_GATE },
        { path: AGREEMENT_FORM_TF, after: agreementFormTf("ambassadors") },
      ],
      primaryFile: TERMS_GATE_JS,
      acCoverage: coverageFor(task, TG_ACTION_CASES.map((c) => `terms-gate post-login action › ${c.label.replace(/^AC-\d+: /, "")}`)),
      baseTests: 12,
      suites: 3,
      checks: {
        contract: planOutput(["auth0_action.terms_gate will be created", "auth0_form.agreement_acceptance will be created", "auth0_trigger_actions.post_login will be updated in-place"], 2, 1),
      },
    };
  }
  if (task.repo === "pww-automation") {
    return {
      summary: "Added TermsGateTest to pww-automation (4 Playwright scenarios through Universal Login: outstanding, accepted, Spanish and ARC sessions) and the TermsGatePage page object, and registered it in the agreements suite.",
      notes: ["Test ambassadors are reset to an outstanding state with the agreements fixture before each scenario."],
      files: [
        { path: `${PWW}/pages/TermsGatePage.kt`, after: termsGatePage(key, false) },
        { path: `${PWW}/agreements/TermsGateTest.kt`, after: termsGateTest(key) },
        { path: "src/test/resources/suites/agreements.yaml", before: SUITE_BEFORE_TG, after: SUITE_YAML },
      ],
      primaryFile: `${PWW}/agreements/TermsGateTest.kt`,
      acCoverage: coverageFor(task, ["TermsGateTest.outstandingAmbassadorIsGated", "TermsGateTest.acceptingReachesTheBackOffice", "TermsGateTest.spanishSessionShowsSpanishForm", "TermsGateTest.arcSessionSkipsTheGate"]),
      baseTests: 196,
    };
  }
  return undefined;
}

function pprImpl(task: RunTask): TaskImpl | undefined {
  const key = keyOf(task);
  const title = task.title.toLowerCase();
  if (task.repo === "customer-service-v2" && /preferred|retail|requirement/.test(title)) {
    return {
      summary: "Required the Privacy Policy for Preferred and Retail customers (CustomerAgreementRequirement rows, no schema change) and gated those types in the post-login context behind privacy-reacceptance-all-customer-types, defaulted off.",
      notes: ["Preferred and Retail customers are only ever asked for the Privacy Policy; their requirement rows name no other agreement."],
      files: [
        { path: `${MIGRATIONS}/V2026_10_06_1__privacy_policy_preferred_retail.sql`, after: privacyRequirementsSql(key) },
        { path: `${PKG}/PostLoginContextController.java`, before: postLoginController(TG_KEYS.context, false), after: postLoginController(TG_KEYS.context, true, key) },
        { path: `${TPKG}/PostLoginContextControllerTest.java`, before: contextTest(), after: contextTest(CONTEXT_PPR_CASES) },
      ],
      primaryFile: `${PKG}/PostLoginContextController.java`,
      acCoverage: coverageFor(task, [
        "PostLoginContextControllerTest.preferredAndRetailGetThePrivacyPolicy",
        "V2026_10_06_1 migration: privacy-policy rows only for types 2 and 3",
        "PostLoginContextControllerTest.allTypesFlagOffKeepsPreferredAndRetailUngated",
      ]),
      baseTests: 88,
    };
  }
  if (task.repo === "customer-service-v2" && /effective|scheduled/.test(title)) {
    return {
      summary: "Scheduled Privacy Policy versions: provisioning keeps the current version active when Legal publishes ahead of the effective date, and the outstanding query switches to the new version on that date.",
      notes: ["Uses the existing EffectiveDate column; no schema change.", "Contentful's scheduled publish fires the existing webhook; nothing new runs on a timer."],
      files: [
        { path: `${PKG}/ContentfulEntry.java`, before: contentfulEntry(TG_KEYS.tables, false), after: contentfulEntry(TG_KEYS.tables, true) },
        { path: `${PKG}/AgreementProvisioningService.java`, before: provisioningService(TG_KEYS.tables, false), after: provisioningService(TG_KEYS.tables, true, key) },
        { path: `${PKG}/OutstandingAgreementsQuery.java`, before: outstandingQuery(TG_KEYS.context, false), after: outstandingQuery(TG_KEYS.context, true, key) },
        { path: `${TPKG}/AgreementProvisioningServiceTest.java`, before: provisioningTest(false), after: provisioningTest(true, PROVISIONING_SCHEDULED_CASES) },
      ],
      primaryFile: `${PKG}/AgreementProvisioningService.java`,
      acCoverage: coverageFor(task, [
        "AgreementProvisioningServiceTest.scheduledVersionKeepsTheCurrentOneActive",
        "AgreementProvisioningServiceTest.effectiveVersionReplacesTheCurrentOne",
        "OutstandingAgreementsQuery (current version stays outstanding-free until the effective date)",
      ]),
      baseTests: 91,
    };
  }
  if (task.repo === "terraform-auth0") {
    return {
      summary: "Widened terms-gate.js from Brand Ambassadors to every customer type (the post-login context decides what is outstanding), with the Privacy Policy update heading when only the policy is outstanding and a Privacy Policy message when a customer declines.",
      notes: ["No new call on the login path: every type reuses the post-login context call.", "Copy for the new heading is in the Auth0 Form messages, English and Spanish."],
      files: [
        { path: TERMS_GATE_JS, before: termsGateAction("ambassadors"), after: termsGateAction("all-customer-types", key) },
        { path: TERMS_GATE_TEST, before: actionTestFile(TG_ACTION_CASES), after: actionTestFile(TG_ACTION_CASES, PRIVACY_FIXTURES, { title: `${key}: every customer type, Privacy Policy prompt`, cases: PPR_ACTION_CASES }) },
        { path: AGREEMENT_FORM_TF, before: agreementFormTf("ambassadors"), after: agreementFormTf("all-customer-types") },
      ],
      primaryFile: TERMS_GATE_JS,
      acCoverage: coverageFor(task, PPR_ACTION_CASES.map((c) => `terms-gate post-login action › ${key} › ${c.label.replace(/^AC-\d+: /, "")}`)),
      fault: PPR_ACTION_FAULT,
      baseTests: 12,
      suites: 3,
      checks: { contract: planOutput(["auth0_action.terms_gate will be updated in-place", "auth0_form.agreement_acceptance will be updated in-place"], 0, 2) },
    };
  }
  if (task.repo === "pww-automation") {
    return {
      summary: "Added PrivacyReacceptanceTest to pww-automation (ambassador, Preferred and Retail accounts; accept, decline and Spanish sessions) and the Privacy Policy locators on TermsGatePage.",
      notes: ["qa-preferred-02 and qa-retail-05 are new test customers on internal-apps-test; the fixture makes 2026.3 effective per run."],
      files: [
        { path: `${PWW}/pages/TermsGatePage.kt`, before: termsGatePage(TG_KEYS.e2e, false), after: termsGatePage(TG_KEYS.e2e, true) },
        { path: `${PWW}/agreements/PrivacyReacceptanceTest.kt`, after: privacyTest(key) },
        { path: "src/test/resources/suites/agreements.yaml", before: SUITE_YAML, after: SUITE_WITH_PRIVACY },
      ],
      primaryFile: `${PWW}/agreements/PrivacyReacceptanceTest.kt`,
      acCoverage: coverageFor(task, [
        "PrivacyReacceptanceTest.everyCustomerTypeIsPrompted",
        "PrivacyReacceptanceTest.acceptingRecordsTheEvidence",
        "PrivacyReacceptanceTest.decliningKeepsTheCustomerOut",
        "PrivacyReacceptanceTest.spanishSessionShowsTheSpanishPolicy",
      ]),
      baseTests: 200,
    };
  }
  return undefined;
}

/** Bespoke code for a TG or PPR task; undefined falls back to the repo templates. */
export function gateImpl(projectId: string, task: RunTask): TaskImpl | undefined {
  if (projectId === "terms-gate") return tgImpl(task);
  if (projectId === "policy-reacceptance") return pprImpl(task);
  return undefined;
}
