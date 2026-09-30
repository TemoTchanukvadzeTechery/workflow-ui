import "server-only";

/**
 * One Jira issue or Confluence page the mock `atl` can list, search and fetch. Keys and page ids
 * outside the AGR fixture are invented for the demo and do not exist in Plexus Jira.
 */
export interface CatalogItem {
  ref: string;
  kind: "jira" | "confluence";
  title: string;
  /** Jira issue type (Epic, Story, Task, Bug, Spike, Project) or "page". */
  type: string;
  /** Jira status. */
  status?: string;
  /** Jira parent key. */
  parent?: string;
  labels?: string[];
  links?: Array<{ type: string; ref: string }>;
  /** Confluence space key. */
  space?: string;
  /** Plain-text body: the Jira description or the page text. */
  description: string;
  /** What a discovery planner says about it when it finds it by search. */
  relation?: string;
  why?: string;
  /** Extra search terms. */
  keywords?: string[];
  /** Shows up in searches, but fetching it fails (no permission), so it is "content not fetched". */
  restricted?: boolean;
  /** ISO date of the last change. */
  modified?: string;
  assignee?: string;
}
