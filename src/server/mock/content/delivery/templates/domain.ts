import "server-only";
/**
 * The domain vocabulary the service, gateway and contract templates write code in. The seeded
 * projects are all about agreements (CustomerAgreementType, required/accepted counts); any other
 * project gets neutral names under a package taken from its id, so a loyalty project's diff says
 * com.plexus.customer.loyalty and /v1/loyalty/…, not agreements.
 */
import { featureName, stripScope } from "@/server/mock/workflows/delivery-lib/util";

export interface Domain {
  /** Java package, gateway route file and contract folder: "agreements", "loyalty". */
  pkg: string;
  /** Query parameter and field that select one type: agreementTypeId, typeId. */
  idParam: string;
  /** SQL column alias for it. */
  idCol: string;
  /** Record fields for the population, the done part, the rest and the percentage. */
  total: string;
  totalCol: string;
  done: string;
  doneCol: string;
  open: string;
  pct: string;
  /** Sample row descriptions for tests and examples. */
  samples: [string, string];
  /** Okta group the route tests sign in with. */
  role: string;
  /** "acceptance coverage per agreement and version". */
  summary: string;
  /** Top-level application.yml key the service's settings live under. */
  yamlRoot: string;
  /** SQL for the aggregate read (indented for the repository's text block). */
  sql(name: string): string;
}

const AGREEMENT_SQL = `            SELECT t.CustomerAgreementTypeID AS agreement_type_id,
                   t.Description AS description,
                   t.Version AS version,
                   COUNT(DISTINCT c.CustomerID) AS required_count,
                   COUNT(DISTINCT a.CustomerID) AS accepted_count
              FROM CustomerAgreementType t
              JOIN CustomerAgreementRequirement r
                ON r.CustomerAgreementTypeID = t.CustomerAgreementTypeID AND r.IsActive = 1
              JOIN Customers c
                ON c.CustomerTypeID = r.CustomerTypeID
              LEFT JOIN CustomerAgreement a
                ON a.CustomerAgreementTypeID = t.CustomerAgreementTypeID AND a.CustomerID = c.CustomerID
             WHERE t.IsActive = 1
               AND (:agreementTypeId IS NULL OR t.CustomerAgreementTypeID = :agreementTypeId)
               AND (:version IS NULL OR t.Version = :version)
             GROUP BY t.CustomerAgreementTypeID, t.Description, t.Version`;

export const AGREEMENTS: Domain = {
  pkg: "agreements",
  idParam: "agreementTypeId",
  idCol: "agreement_type_id",
  total: "requiredCount",
  totalCol: "required_count",
  done: "acceptedCount",
  doneCol: "accepted_count",
  open: "notAcceptedCount",
  pct: "coveragePercent",
  samples: ["Brand Ambassador Agreement", "Policies & Procedures"],
  role: "Legal-Compliance",
  summary: "Aggregate acceptance coverage per agreement and version",
  yamlRoot: "agreements",
  sql: () => AGREEMENT_SQL,
};

/** Words a test run puts in a project name ("zz", "j3", the role being tested) that are not the domain. */
const NOISE = new Set(["zz", "product", "owner", "developer", "architect", "qa", "po", "tester", "test", "demo", "and", "the", "for", "of"]);

function titleWords(words: readonly string[]): string {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Neutral vocabulary for a project whose domain is `words` ("loyalty", "points", "expiry"). */
function generic(words: readonly string[]): Domain {
  const pkg = (words[0] ?? "feature").replace(/[^a-z]/g, "") || "feature";
  const title = titleWords(words.length ? words : ["feature"]);
  return {
    pkg,
    idParam: "typeId",
    idCol: "type_id",
    total: "totalCount",
    totalCol: "total_count",
    done: "completedCount",
    doneCol: "completed_count",
    open: "openCount",
    pct: "completionPercent",
    samples: [`${title} (standard)`, `${title} (pilot)`],
    role: "Customer-Support",
    summary: `Aggregate ${title.toLowerCase()} figures per type and version`,
    yamlRoot: pkg,
    sql: (name) => `            SELECT s.${name}TypeID AS type_id,
                   s.Description AS description,
                   s.Version AS version,
                   COUNT(DISTINCT s.CustomerID) AS total_count,
                   COUNT(DISTINCT CASE WHEN s.Status = 'COMPLETE' THEN s.CustomerID END) AS completed_count
              FROM ${name}Record s
             WHERE s.IsActive = 1
               AND (:typeId IS NULL OR s.${name}TypeID = :typeId)
               AND (:version IS NULL OR s.Version = :version)
             GROUP BY s.${name}TypeID, s.Description, s.Version`,
  };
}

/** Packages the agreement-based seeds use; everything else gets the neutral vocabulary. */
const AGREEMENT_PKGS = new Set(["agreements", "privacy", "terms"]);

export function domainFor(pkg?: string): Domain {
  if (!pkg || AGREEMENT_PKGS.has(pkg)) return pkg ? { ...AGREEMENTS, pkg } : AGREEMENTS;
  return generic([pkg]);
}

/** The domain of a project without a hand-written pack, from its id ("zz-j3-developer-loyalty-points-expiry"). */
export function projectDomain(projectId: string): Domain {
  const words = projectId
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/\d/.test(w) && !NOISE.has(w));
  return generic(words);
}

/**
 * Class-name feature for a task in a neutral domain, without the test-run words of the project
 * name: "[customer-service-v2] zz J3 Developer Loyalty Points Expiry: read endpoint" in package
 * loyalty -> "PointsExpiry".
 */
/** Words the planner's task titles wrap around the feature ("Contract for …: core experience: read endpoint"). */
const TITLE_WORDS = new Set(["contract", "route", "prerequisite", "read", "endpoint", "core", "experience", "part", "action", "login", "post"]);

export function featureFor(title: string, d: Domain): string {
  const words = stripScope(title)
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 1 && !/\d/.test(w) && !NOISE.has(w.toLowerCase()) && !TITLE_WORDS.has(w.toLowerCase()));
  // The package already says "loyalty"; the class names the rest ("PointsExpiry").
  const rest = words.filter((w) => w.toLowerCase() !== d.pkg);
  return featureName((rest.length ? rest : words).join(" ")) || featureName(stripScope(title));
}
