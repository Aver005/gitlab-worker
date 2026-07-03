import type { Config } from "./config.ts";
import { gql } from "./gql.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkItemNode {
  id: string;
  iid: string;
  title: string;
  state: string;
  webUrl: string;
  widgets: WidgetUnion[];
}

/** A lightweight work-item reference as returned inside the hierarchy widget. */
export interface HierarchyRef {
  id: string;
  iid: string;
  title: string;
  state: string;
}

type WidgetUnion =
  | { type: "DESCRIPTION"; description: string }
  | {
      type: "ASSIGNEES";
      assignees: { nodes: Array<{ id: string; username: string; name: string }> };
    }
  | {
      type: "LABELS";
      labels: { nodes: Array<{ id: string; title: string }> };
    }
  | { type: "STATUS"; status: { id: string; name: string } | null }
  | { type: "WEIGHT"; weight: number | null }
  | { type: "START_AND_DUE_DATE"; startDate: string | null; dueDate: string | null }
  | { type: "TIME_TRACKING"; timeEstimate: number; totalTimeSpent: number }
  | {
      type: "HIERARCHY";
      hasParent: boolean;
      hasChildren: boolean;
      parent: HierarchyRef | null;
      children: { nodes: HierarchyRef[] };
    }
  | {
      type: "LINKED_ITEMS";
      blocked: boolean;
      blockedByCount: number;
      blockingCount: number;
    };

export interface WorkItemType {
  id: string;
  name: string;
}

export interface AllowedStatus {
  id: string;
  name: string;
}

// ─── System-defined status map (fallback when server lookup fails) ────────────
// See spec: "gid://gitlab/WorkItems::Statuses::SystemDefined::Status/N"
// N: 1=To do, 2=In progress, 3=Done, 4=Won't do, 5=Duplicate
const SYSTEM_STATUS_MAP: Record<string, string> = {
  "to do": "gid://gitlab/WorkItems::Statuses::SystemDefined::Status/1",
  "in progress": "gid://gitlab/WorkItems::Statuses::SystemDefined::Status/2",
  done: "gid://gitlab/WorkItems::Statuses::SystemDefined::Status/3",
  "won't do": "gid://gitlab/WorkItems::Statuses::SystemDefined::Status/4",
  "wont do": "gid://gitlab/WorkItems::Statuses::SystemDefined::Status/4",
  duplicate: "gid://gitlab/WorkItems::Statuses::SystemDefined::Status/5",
};

// ─── Per-process caches ───────────────────────────────────────────────────────

const workItemTypesCache = new Map<string, WorkItemType[]>();
const allowedStatusesCache = new Map<string, AllowedStatus[]>();
const labelCache = new Map<string, string>(); // "project:labelName" → gid
const userCache = new Map<string, string>(); // username → gid
let currentUserCache: { id: string; username: string; name: string } | null =
  null;

// ─── Widget accessors ─────────────────────────────────────────────────────────

export function getDescription(item: WorkItemNode): string {
  const w = item.widgets.find((x) => x.type === "DESCRIPTION") as
    | { type: "DESCRIPTION"; description: string }
    | undefined;
  return w?.description ?? "";
}

export function getAssignees(
  item: WorkItemNode
): Array<{ id: string; username: string; name: string }> {
  const w = item.widgets.find((x) => x.type === "ASSIGNEES") as
    | { type: "ASSIGNEES"; assignees: { nodes: Array<{ id: string; username: string; name: string }> } }
    | undefined;
  return w?.assignees.nodes ?? [];
}

export function getLabels(
  item: WorkItemNode
): Array<{ id: string; title: string }> {
  const w = item.widgets.find((x) => x.type === "LABELS") as
    | { type: "LABELS"; labels: { nodes: Array<{ id: string; title: string }> } }
    | undefined;
  return w?.labels.nodes ?? [];
}

export function getStatus(
  item: WorkItemNode
): { id: string; name: string } | null {
  const w = item.widgets.find((x) => x.type === "STATUS") as
    | { type: "STATUS"; status: { id: string; name: string } | null }
    | undefined;
  return w?.status ?? null;
}

export function getWeight(item: WorkItemNode): number | null {
  const w = item.widgets.find((x) => x.type === "WEIGHT") as
    | { type: "WEIGHT"; weight: number | null }
    | undefined;
  return w?.weight ?? null;
}

export function getDates(
  item: WorkItemNode
): { startDate: string | null; dueDate: string | null } {
  const w = item.widgets.find((x) => x.type === "START_AND_DUE_DATE") as
    | { type: "START_AND_DUE_DATE"; startDate: string | null; dueDate: string | null }
    | undefined;
  return { startDate: w?.startDate ?? null, dueDate: w?.dueDate ?? null };
}

export function getTimeTracking(
  item: WorkItemNode
): { timeEstimate: number; totalTimeSpent: number } {
  const w = item.widgets.find((x) => x.type === "TIME_TRACKING") as
    | { type: "TIME_TRACKING"; timeEstimate: number; totalTimeSpent: number }
    | undefined;
  return { timeEstimate: w?.timeEstimate ?? 0, totalTimeSpent: w?.totalTimeSpent ?? 0 };
}

export function getHierarchy(item: WorkItemNode): {
  hasParent: boolean;
  hasChildren: boolean;
  parent: HierarchyRef | null;
  children: HierarchyRef[];
} {
  const w = item.widgets.find((x) => x.type === "HIERARCHY") as
    | {
        type: "HIERARCHY";
        hasParent: boolean;
        hasChildren: boolean;
        parent: HierarchyRef | null;
        children: { nodes: HierarchyRef[] };
      }
    | undefined;
  return {
    hasParent: w?.hasParent ?? false,
    hasChildren: w?.hasChildren ?? false,
    parent: w?.parent ?? null,
    children: w?.children.nodes ?? [],
  };
}

export function getLinkedInfo(item: WorkItemNode): {
  blocked: boolean;
  blockedByCount: number;
  blockingCount: number;
} {
  const w = item.widgets.find((x) => x.type === "LINKED_ITEMS") as
    | {
        type: "LINKED_ITEMS";
        blocked: boolean;
        blockedByCount: number;
        blockingCount: number;
      }
    | undefined;
  return {
    blocked: w?.blocked ?? false,
    blockedByCount: w?.blockedByCount ?? 0,
    blockingCount: w?.blockingCount ?? 0,
  };
}

// ─── GraphQL fragments ────────────────────────────────────────────────────────

const WORK_ITEM_WIDGETS_FRAGMENT = `
  widgets {
    type
    ... on WorkItemWidgetDescription { description }
    ... on WorkItemWidgetAssignees { assignees { nodes { id username name } } }
    ... on WorkItemWidgetLabels { labels { nodes { id title } } }
    ... on WorkItemWidgetStatus { status { id name } }
    ... on WorkItemWidgetWeight { weight }
    ... on WorkItemWidgetStartAndDueDate { startDate dueDate }
    ... on WorkItemWidgetTimeTracking { timeEstimate totalTimeSpent }
    ... on WorkItemWidgetHierarchy {
      hasParent
      hasChildren
      parent { id iid title state }
      children { nodes { id iid title state } }
    }
    ... on WorkItemWidgetLinkedItems { blocked blockedByCount blockingCount }
  }
`;

const WORK_ITEM_CORE = `
  id iid title state webUrl
  ${WORK_ITEM_WIDGETS_FRAGMENT}
`;

// ─── Project discovery ────────────────────────────────────────────────────────

export interface ProjectInfo {
  id: string;
  fullPath: string;
  name: string;
}

export interface ListProjectsOptions {
  search?: string;
  limit?: number;
}

/** Projects the current user is a member of (optionally narrowed by search).
 *  Fetches up to `limit` via cursor pagination (default 100). */
export async function listProjects(
  config: Config,
  searchOrOpts?: string | ListProjectsOptions,
  limit?: number
): Promise<ProjectInfo[]> {
  // Accept old call signature: listProjects(config, "search") or new object form
  let search: string | undefined;
  let maxItems: number;

  if (typeof searchOrOpts === "string" || searchOrOpts === undefined) {
    search = searchOrOpts;
    maxItems = limit ?? 100;
  } else {
    search = searchOrOpts.search;
    maxItems = searchOrOpts.limit ?? 100;
  }

  type ProjectsPageResult = {
    projects: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: ProjectInfo[];
    };
  };

  const perPage = 100; // API max per page
  const results: ProjectInfo[] = [];
  let cursor: string | null = null;

  while (results.length < maxItems) {
    const fetchCount = Math.min(perPage, maxItems - results.length);
    const data: ProjectsPageResult = await gql<ProjectsPageResult>(
      config,
      `query ($search: String, $first: Int!, $after: String) {
        projects(membership: true, search: $search, first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id fullPath name }
        }
      }`,
      { search: search ?? null, first: fetchCount, after: cursor }
    );

    const page = data.projects;
    results.push(...page.nodes);

    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
    cursor = page.pageInfo.endCursor;
  }

  return results.slice(0, maxItems);
}

/**
 * Pure matcher for short project references, in priority order:
 * exact fullPath → exact name → exact last path segment → unique substring.
 * Exported for tests.
 */
export function pickProject(
  candidates: ProjectInfo[],
  input: string
): { match?: ProjectInfo; ambiguous?: ProjectInfo[] } {
  const q = input.toLowerCase();

  const exactPath = candidates.find((p) => p.fullPath.toLowerCase() === q);
  if (exactPath) return { match: exactPath };

  const exactName = candidates.filter((p) => p.name.toLowerCase() === q);
  if (exactName.length === 1) return { match: exactName[0]! };

  const lastSegment = candidates.filter(
    (p) => p.fullPath.toLowerCase().split("/").pop() === q
  );
  if (lastSegment.length === 1) return { match: lastSegment[0]! };

  const substring = candidates.filter(
    (p) =>
      p.fullPath.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
  );
  if (substring.length === 1) return { match: substring[0]! };
  if (substring.length > 1) return { ambiguous: substring };

  return {};
}

/**
 * Resolve a project reference to a fullPath. Inputs containing "/" are
 * treated as complete paths; short names are matched against the user's
 * membership projects.
 */
export async function resolveProjectPath(
  config: Config,
  input: string
): Promise<string> {
  if (input.includes("/")) return input;

  const candidates = await listProjects(config, input);
  const { match, ambiguous } = pickProject(candidates, input);
  if (match) return match.fullPath;
  if (ambiguous) {
    throw new Error(
      `Project "${input}" is ambiguous. Matches:\n` +
        ambiguous.map((p) => `  ${p.fullPath}`).join("\n")
    );
  }
  throw new Error(
    `No project matching "${input}" found among your memberships. Run: glw projects`
  );
}

// ─── Project / type / status resolvers ───────────────────────────────────────

export async function resolveProject(
  config: Config,
  fullPath: string
): Promise<string> {
  const data = await gql<{ project: { id: string } | null }>(
    config,
    `query ($fullPath: ID!) { project(fullPath: $fullPath) { id } }`,
    { fullPath }
  );
  if (!data.project) {
    throw new Error(
      `Project not found: "${fullPath}". Check the project path and your access token.`
    );
  }
  return data.project.id;
}

export async function getWorkItemTypes(
  config: Config
): Promise<WorkItemType[]> {
  const key = config.project;
  if (workItemTypesCache.has(key)) return workItemTypesCache.get(key)!;

  const data = await gql<{
    project: { workItemTypes: { nodes: WorkItemType[] } } | null;
  }>(
    config,
    `query ($fullPath: ID!) {
      project(fullPath: $fullPath) {
        workItemTypes { nodes { id name } }
      }
    }`,
    { fullPath: config.project }
  );

  const types = data.project?.workItemTypes.nodes ?? [];
  workItemTypesCache.set(key, types);
  return types;
}

export async function resolveWorkItemType(
  config: Config,
  typeName: string
): Promise<string> {
  const types = await getWorkItemTypes(config);
  const match = types.find(
    (t) => t.name.toLowerCase() === typeName.toLowerCase()
  );
  if (!match) {
    const available = types.map((t) => t.name).join(", ");
    throw new Error(
      `Work item type "${typeName}" not found. Available: ${available}`
    );
  }
  return match.id;
}

/**
 * Attempt to fetch allowed statuses from the server.
 * If the extended query fails (older GitLab), fall back to the system-defined status map.
 * This fallback logic is intentionally isolated here and commented.
 */
export async function getAllowedStatuses(
  config: Config
): Promise<AllowedStatus[]> {
  const key = config.project;
  if (allowedStatusesCache.has(key)) return allowedStatusesCache.get(key)!;

  // FALLBACK: First, try the extended query that includes allowedStatuses.
  // Older GitLab instances may not support widgetDefinitions or allowedStatuses fields.
  try {
    const data = await gql<{
      project: {
        workItemTypes: {
          nodes: Array<{
            widgetDefinitions: Array<{
              type: string;
              allowedStatuses?: { nodes: AllowedStatus[] };
            }>;
          }>;
        };
      } | null;
    }>(
      config,
      `query ($fullPath: ID!) {
        project(fullPath: $fullPath) {
          workItemTypes {
            nodes {
              widgetDefinitions {
                type
                ... on WorkItemWidgetDefinitionStatus {
                  allowedStatuses { nodes { id name } }
                }
              }
            }
          }
        }
      }`,
      { fullPath: config.project }
    );

    const allStatuses: AllowedStatus[] = [];
    const seen = new Set<string>();
    for (const wt of data.project?.workItemTypes.nodes ?? []) {
      for (const wd of wt.widgetDefinitions) {
        if (wd.type === "STATUS" && wd.allowedStatuses) {
          for (const s of wd.allowedStatuses.nodes) {
            if (!seen.has(s.id)) {
              seen.add(s.id);
              allStatuses.push(s);
            }
          }
        }
      }
    }

    if (allStatuses.length > 0) {
      allowedStatusesCache.set(key, allStatuses);
      return allStatuses;
    }
    // Fall through if no statuses returned
  } catch {
    // FALLBACK: Extended query failed — older GitLab version.
    // Use system-defined status map (spec-provided constants).
  }

  // FALLBACK: Use system-defined status map constants
  const fallbackStatuses: AllowedStatus[] = Object.entries(SYSTEM_STATUS_MAP).map(
    ([name, id]) => ({
      id,
      name: name.charAt(0).toUpperCase() + name.slice(1),
    })
  );
  // De-duplicate (e.g. "wont do" aliases "won't do")
  const unique = new Map<string, AllowedStatus>();
  for (const s of fallbackStatuses) {
    unique.set(s.id, s);
  }
  const result = Array.from(unique.values());
  allowedStatusesCache.set(key, result);
  return result;
}

export async function resolveStatus(
  config: Config,
  statusName: string
): Promise<string> {
  // Server list first — projects may define custom statuses whose names
  // shadow the system-defined ones; the system map is only a fallback.
  const lower = statusName.toLowerCase();
  const statuses = await getAllowedStatuses(config);
  const match = statuses.find((s) => s.name.toLowerCase() === lower);
  if (match) return match.id;

  if (SYSTEM_STATUS_MAP[lower]) return SYSTEM_STATUS_MAP[lower]!;

  const available = statuses.map((s) => s.name).join(", ");
  throw new Error(
    `Status "${statusName}" not found. Available: ${available}`
  );
}

// ─── Label resolver ───────────────────────────────────────────────────────────

export async function resolveLabels(
  config: Config,
  names: string[]
): Promise<string[]> {
  const ids: string[] = [];
  const missing: string[] = [];

  for (const name of names) {
    const cacheKey = `${config.project}:${name.toLowerCase()}`;
    if (labelCache.has(cacheKey)) {
      ids.push(labelCache.get(cacheKey)!);
      continue;
    }

    const data = await gql<{
      project: {
        labels: { nodes: Array<{ id: string; title: string }> };
      } | null;
    }>(
      config,
      `query ($fullPath: ID!, $search: String) {
        project(fullPath: $fullPath) {
          labels(searchTerm: $search, includeAncestorGroups: true) {
            nodes { id title }
          }
        }
      }`,
      { fullPath: config.project, search: name }
    );

    const nodes = data.project?.labels.nodes ?? [];
    const match = nodes.find(
      (n) => n.title.toLowerCase() === name.toLowerCase()
    );

    if (!match) {
      missing.push(name);
    } else {
      labelCache.set(cacheKey, match.id);
      ids.push(match.id);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Unknown label(s): ${missing.join(", ")}`);
  }

  return ids;
}

// ─── User resolver ────────────────────────────────────────────────────────────

export async function resolveUser(
  config: Config,
  input: string
): Promise<{ id: string; username: string } | null> {
  if (input === "none") return null; // clear assignees

  if (input === "@me") {
    const me = await getCurrentUser(config);
    return { id: me.id, username: me.username };
  }

  const username = input.startsWith("@") ? input.slice(1) : input;
  const cacheKey = username.toLowerCase();

  if (userCache.has(cacheKey)) {
    return { id: userCache.get(cacheKey)!, username };
  }

  const data = await gql<{
    users: { nodes: Array<{ id: string; username: string }> };
  }>(
    config,
    `query ($usernames: [String!]) {
      users(usernames: $usernames) { nodes { id username } }
    }`,
    { usernames: [username] }
  );

  const node = data.users.nodes[0];
  if (!node) {
    throw new Error(`User not found: "${username}"`);
  }

  userCache.set(cacheKey, node.id);
  return { id: node.id, username: node.username };
}

export async function getCurrentUser(
  config: Config
): Promise<{ id: string; username: string; name: string }> {
  if (currentUserCache) return currentUserCache;

  const data = await gql<{
    currentUser: { id: string; username: string; name: string } | null;
  }>(
    config,
    `query { currentUser { id username name } }`
  );

  if (!data.currentUser) {
    throw new Error(
      `Could not fetch current user. Check your access token.`
    );
  }

  currentUserCache = data.currentUser;
  return data.currentUser;
}

// ─── Work item queries ────────────────────────────────────────────────────────

export async function getWorkItemByIid(
  config: Config,
  iid: string | number
): Promise<WorkItemNode> {
  const data = await gql<{
    project: {
      workItems: { nodes: WorkItemNode[] };
    } | null;
  }>(
    config,
    `query ($fullPath: ID!, $iids: [String!]) {
      project(fullPath: $fullPath) {
        workItems(iids: $iids) {
          nodes { ${WORK_ITEM_CORE} }
        }
      }
    }`,
    { fullPath: config.project, iids: [String(iid)] }
  );

  const nodes = data.project?.workItems.nodes;
  if (!nodes || nodes.length === 0) {
    throw new Error(`Issue #${iid} not found in project "${config.project}"`);
  }
  return nodes[0]!;
}

export interface ListWorkItemsOptions {
  state?: "opened" | "closed" | "all";
  search?: string;
  limit?: number;
  includeDescription?: boolean;
}

export async function listWorkItems(
  config: Config,
  opts: ListWorkItemsOptions = {}
): Promise<WorkItemNode[]> {
  const variables: Record<string, unknown> = {
    fullPath: config.project,
    first: opts.limit ?? 50,
  };

  // Build args conditionally
  const args: string[] = [`first: $first`];
  const queryArgs: string[] = [`$fullPath: ID!`, `$first: Int`];

  if (opts.state && opts.state !== "all") {
    args.push("state: $state");
    queryArgs.push("$state: IssuableState");
    // IssuableState enum values are lowercase: opened / closed / all
    variables["state"] = opts.state;
  }

  if (opts.search) {
    args.push("search: $search");
    queryArgs.push("$search: String");
    variables["search"] = opts.search;
  }

  // List query — optionally includes description widget
  const descriptionFragment = opts.includeDescription
    ? `... on WorkItemWidgetDescription { description }`
    : "";

  const WORK_ITEM_LIST_WIDGETS = `
    widgets {
      type
      ${descriptionFragment}
      ... on WorkItemWidgetAssignees { assignees { nodes { id username name } } }
      ... on WorkItemWidgetLabels { labels { nodes { id title } } }
      ... on WorkItemWidgetStatus { status { id name } }
      ... on WorkItemWidgetWeight { weight }
      ... on WorkItemWidgetStartAndDueDate { startDate dueDate }
      ... on WorkItemWidgetTimeTracking { timeEstimate totalTimeSpent }
    }
  `;

  const query = `
    query (${queryArgs.join(", ")}) {
      project(fullPath: $fullPath) {
        workItems(${args.join(", ")}) {
          nodes { id iid title state webUrl ${WORK_ITEM_LIST_WIDGETS} }
        }
      }
    }
  `;

  const data = await gql<{
    project: { workItems: { nodes: WorkItemNode[] } } | null;
  }>(config, query, variables);

  return data.project?.workItems.nodes ?? [];
}

// ─── Search predicate ─────────────────────────────────────────────────────────

export interface SearchCriteria {
  text?: string;
  name?: string;
  body?: string;
  startTime?: string; // ISO date string YYYY-MM-DD
}

/**
 * Pure client-side predicate for search filtering.
 * Operates on plain values (not WorkItemNode) so it can be unit-tested without fixtures.
 * All supplied criteria are ANDed.
 */
export function matchesSearch(
  item: { title: string; description: string; startDate: string | null },
  criteria: SearchCriteria
): boolean {
  const { text, name, body, startTime } = criteria;
  const titleLower = item.title.toLowerCase();
  const descLower = item.description.toLowerCase();

  if (text !== undefined) {
    const t = text.toLowerCase();
    if (!titleLower.includes(t) && !descLower.includes(t)) return false;
  }

  if (name !== undefined) {
    if (!titleLower.includes(name.toLowerCase())) return false;
  }

  if (body !== undefined) {
    if (!descLower.includes(body.toLowerCase())) return false;
  }

  if (startTime !== undefined) {
    if (!item.startDate) return false;
    if (item.startDate < startTime) return false;
  }

  return true;
}

// ─── Mutation types ───────────────────────────────────────────────────────────

interface WidgetInput {
  descriptionWidget?: { description: string };
  assigneesWidget?: { assigneeIds: string[] };
  labelsWidget?: {
    labelIds?: string[];
    addLabelIds?: string[];
    removeLabelIds?: string[];
  };
  weightWidget?: { weight: number | null };
  startAndDueDateWidget?: {
    isFixed: boolean;
    startDate: string | null;
    dueDate: string | null;
  };
  statusWidget?: { status: string };
  timeTrackingWidget?: {
    timeEstimate?: string;
    timelog?: { timeSpent: string; summary?: string };
  };
  hierarchyWidget?: {
    // Set the parent work item (null clears it) and/or add children.
    parentId?: string | null;
    childrenIds?: string[];
  };
}

export interface WorkItemCreateInput extends WidgetInput {
  title: string;
  workItemTypeId: string;
  namespacePath: string;
  confidential?: boolean;
}

export interface WorkItemUpdateInput extends WidgetInput {
  id: string;
  title?: string;
  stateEvent?: "CLOSE" | "REOPEN";
}

interface MutationWorkItem {
  id: string;
  iid: string;
  title: string;
  state: string;
  webUrl: string;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createWorkItem(
  config: Config,
  input: WorkItemCreateInput
): Promise<MutationWorkItem> {
  const data = await gql<{
    workItemCreate: {
      workItem: MutationWorkItem | null;
      errors: string[];
    };
  }>(
    config,
    `mutation ($input: WorkItemCreateInput!) {
      workItemCreate(input: $input) {
        workItem { id iid title state webUrl }
        errors
      }
    }`,
    { input }
  );

  if (data.workItemCreate.errors.length > 0) {
    throw new Error(
      `Failed to create work item: ${data.workItemCreate.errors.join("; ")}`
    );
  }

  if (!data.workItemCreate.workItem) {
    throw new Error(`Work item creation returned no data`);
  }

  return data.workItemCreate.workItem;
}

export async function updateWorkItem(
  config: Config,
  input: WorkItemUpdateInput
): Promise<MutationWorkItem> {
  const data = await gql<{
    workItemUpdate: {
      workItem: MutationWorkItem | null;
      errors: string[];
    };
  }>(
    config,
    `mutation ($input: WorkItemUpdateInput!) {
      workItemUpdate(input: $input) {
        workItem { id iid title state webUrl }
        errors
      }
    }`,
    { input }
  );

  if (data.workItemUpdate.errors.length > 0) {
    throw new Error(
      `Failed to update work item: ${data.workItemUpdate.errors.join("; ")}`
    );
  }

  if (!data.workItemUpdate.workItem) {
    throw new Error(`Work item update returned no data`);
  }

  return data.workItemUpdate.workItem;
}

export async function createNote(
  config: Config,
  noteableId: string,
  body: string,
  internal = false
): Promise<void> {
  const data = await gql<{
    createNote: { note: { id: string } | null; errors: string[] };
  }>(
    config,
    `mutation ($input: CreateNoteInput!) {
      createNote(input: $input) {
        note { id }
        errors
      }
    }`,
    { input: { noteableId, body, internal } }
  );

  if (data.createNote.errors.length > 0) {
    throw new Error(
      `Failed to create note: ${data.createNote.errors.join("; ")}`
    );
  }
}

// ─── Linked items (related / blocks / blocked-by) ─────────────────────────────
// GitLab exposes these as dedicated mutations (not widgets on workItemUpdate).
// linkType describes the relation FROM `id` TO each item in `workItemsIds`.

export type LinkType = "RELATED" | "BLOCKS" | "BLOCKED_BY";

interface LinkedItemsPayload {
  workItem: MutationWorkItem | null;
  errors: string[];
  message: string | null;
}

export async function addLinkedItems(
  config: Config,
  id: string,
  workItemsIds: string[],
  linkType: LinkType
): Promise<MutationWorkItem> {
  const data = await gql<{ workItemAddLinkedItems: LinkedItemsPayload }>(
    config,
    `mutation ($input: WorkItemAddLinkedItemsInput!) {
      workItemAddLinkedItems(input: $input) {
        workItem { id iid title state webUrl }
        errors
        message
      }
    }`,
    { input: { id, workItemsIds, linkType } }
  );

  const res = data.workItemAddLinkedItems;
  if (res.errors.length > 0) {
    throw new Error(`Failed to link work items: ${res.errors.join("; ")}`);
  }
  if (!res.workItem) {
    throw new Error(res.message || `Linking work items returned no data`);
  }
  return res.workItem;
}

export async function removeLinkedItems(
  config: Config,
  id: string,
  workItemsIds: string[]
): Promise<MutationWorkItem> {
  const data = await gql<{ workItemRemoveLinkedItems: LinkedItemsPayload }>(
    config,
    `mutation ($input: WorkItemRemoveLinkedItemsInput!) {
      workItemRemoveLinkedItems(input: $input) {
        workItem { id iid title state webUrl }
        errors
        message
      }
    }`,
    { input: { id, workItemsIds } }
  );

  const res = data.workItemRemoveLinkedItems;
  if (res.errors.length > 0) {
    throw new Error(`Failed to unlink work items: ${res.errors.join("; ")}`);
  }
  if (!res.workItem) {
    throw new Error(res.message || `Unlinking work items returned no data`);
  }
  return res.workItem;
}

// ─── Relation input parsers (pure — unit-tested) ──────────────────────────────

/**
 * Parse a user-supplied link-type into the GraphQL enum.
 * Accepts friendly spellings (spaces/underscores/hyphens interchangeable).
 */
export function parseLinkType(input: string): LinkType {
  const s = input.trim().toLowerCase().replace(/[\s_]+/g, "-");
  switch (s) {
    case "related":
    case "relates":
    case "relate":
    case "rel":
      return "RELATED";
    case "blocks":
    case "block":
    case "blocking":
      return "BLOCKS";
    case "blocked-by":
    case "blockedby":
    case "is-blocked-by":
    case "blocked":
      return "BLOCKED_BY";
    default:
      throw new Error(
        `Invalid link type "${input}". Use: related, blocks, blocked-by`
      );
  }
}

/** Normalize an issue reference: strip a leading "#", trim, require digits. */
export function normalizeIid(input: string): string {
  const s = input.trim().replace(/^#/, "");
  if (!/^\d+$/.test(s)) {
    throw new Error(
      `Invalid issue number "${input}". Expected a number like 42 or #42`
    );
  }
  return s;
}

// ─── Duration validation ──────────────────────────────────────────────────────

const DURATION_RE = /^(\d+[wdhm]\s*)+$/i;

export function validateDuration(dur: string): string {
  const trimmed = dur.trim();
  if (!DURATION_RE.test(trimmed)) {
    throw new Error(
      `Invalid duration "${dur}". Use format like "2h", "1h30m", "3d", "1w2d3h"`
    );
  }
  return trimmed;
}
