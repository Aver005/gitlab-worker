import {
    checkPayload,
    gql,
    optionalArgs,
    paginate,
    type Page,
} from './client.ts';
import { getCurrentUser } from './users.ts';

import type { Config } from '../config/load.ts';
import type { TimeTrackingWidgetInput } from './time-tracking.ts';
import type { WorkItemNode } from './work-item.ts';

export type ItemState = 'opened' | 'closed' | 'all';

const LIST_WIDGETS = `
    ... on WorkItemWidgetAssignees { assignees { nodes { id username name } } }
    ... on WorkItemWidgetLabels { labels { nodes { id title } } }
    ... on WorkItemWidgetStatus { status { id name } }
    ... on WorkItemWidgetWeight { weight }
    ... on WorkItemWidgetStartAndDueDate { startDate dueDate }
    ... on WorkItemWidgetTimeTracking { timeEstimate totalTimeSpent }
`;

const FULL_ITEM = `
    id iid title state webUrl namespace { fullPath }
    widgets {
        type
        ... on WorkItemWidgetDescription { description }
        ${LIST_WIDGETS}
        ... on WorkItemWidgetHierarchy {
            hasParent
            hasChildren
            parent { id iid title state }
            children { nodes { id iid title state } }
        }
        ... on WorkItemWidgetLinkedItems { blocked blockedByCount blockingCount }
    }
`;

/** В списках описание по запросу, без иерархии и связей. */
function listItem(includeDescription?: boolean): string {
    const description = includeDescription
        ? '... on WorkItemWidgetDescription { description }'
        : '';
    return `id iid title state webUrl namespace { fullPath }
        widgets { type ${description} ${LIST_WIDGETS} }`;
}

// Аргумент state — enum IssuableState в нижнем регистре; `all` серверу не нужен.
const stateArg = (state?: ItemState) =>
    state && state !== 'all' ? state : undefined;

export async function getWorkItemByIid(
    config: Config,
    iid: string,
): Promise<WorkItemNode> {
    const data = await gql<{
        project: { workItems: { nodes: WorkItemNode[] } } | null;
    }>(
        config,
        `query ($fullPath: ID!, $iids: [String!]) {
            project(fullPath: $fullPath) {
                workItems(iids: $iids) { nodes { ${FULL_ITEM} } }
            }
        }`,
        { fullPath: config.project, iids: [iid] },
    );

    const item = data.project?.workItems.nodes[0];
    if (!item) {
        throw new Error(
            `Issue #${iid} not found in project "${config.project}"`,
        );
    }
    return item;
}

export interface ListOptions {
    state?: ItemState;
    search?: string;
    limit?: number;
    includeDescription?: boolean;
}

export async function listWorkItems(
    config: Config,
    opts: ListOptions = {},
): Promise<WorkItemNode[]> {
    const { args, params, variables } = optionalArgs([
        ['state', 'IssuableState', stateArg(opts.state)],
        ['search', 'String', opts.search],
    ]);
    const query = `
        query ($fullPath: ID!, $first: Int!, $after: String${params}) {
            project(fullPath: $fullPath) {
                workItems(first: $first, after: $after${args}) {
                    pageInfo { hasNextPage endCursor }
                    nodes { ${listItem(opts.includeDescription)} }
                }
            }
        }`;

    return paginate(opts.limit ?? 50, async (first, after) => {
        const data = await gql<{
            project: { workItems: Page<WorkItemNode> } | null;
        }>(config, query, {
            ...variables,
            fullPath: config.project,
            first,
            after,
        });
        return data.project?.workItems ?? null;
    });
}

export interface ListMineOptions {
    state?: ItemState;
    labels?: string[];
    limit?: number;
    includeDescription?: boolean;
}

/** Задачи на текущем пользователе по всем проектам; поле есть с GitLab 17.10. */
export async function listMyWorkItems(
    config: Config,
    opts: ListMineOptions = {},
): Promise<WorkItemNode[]> {
    const me = await getCurrentUser(config);
    const { args, params, variables } = optionalArgs([
        ['state', 'IssuableState', stateArg(opts.state)],
        [
            'labelName',
            '[String!]',
            opts.labels?.length ? opts.labels : undefined,
        ],
    ]);
    const query = `
        query ($assignees: [String!], $first: Int!, $after: String${params}) {
            currentUser {
                workItems(assigneeUsernames: $assignees, first: $first, after: $after${args}) {
                    pageInfo { hasNextPage endCursor }
                    nodes { ${listItem(opts.includeDescription)} }
                }
            }
        }`;

    return paginate(opts.limit ?? 100, async (first, after) => {
        try {
            const data = await gql<{
                currentUser: { workItems: Page<WorkItemNode> | null } | null;
            }>(config, query, {
                ...variables,
                assignees: [me.username],
                first,
                after,
            });
            return data.currentUser?.workItems ?? null;
        } catch (err) {
            if (
                err instanceof Error &&
                err.message.includes("doesn't exist on type 'CurrentUser'")
            ) {
                throw new Error(
                    `This GitLab has no currentUser.workItems (needs 17.10+): ${err.message}`,
                    { cause: err },
                );
            }
            throw err;
        }
    });
}

// ─── Мутации ──────────────────────────────────────────────────────────────────

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
    /** `parentId: null` отвязывает от родителя. */
    hierarchyWidget?: { parentId?: string | null; childrenIds?: string[] };
}

// В WorkItemCreateInput нет timeTrackingWidget: сервер ответит «Field is not
// defined», поэтому оценка и списание уходят вторым запросом.
export interface WorkItemCreateInput extends WidgetInput {
    title: string;
    workItemTypeId: string;
    namespacePath: string;
    confidential?: boolean;
}

export interface WorkItemUpdateInput extends WidgetInput {
    id: string;
    title?: string;
    stateEvent?: 'CLOSE' | 'REOPEN';
    timeTrackingWidget?: TimeTrackingWidgetInput;
}

export interface MutationWorkItem {
    id: string;
    iid: string;
    title: string;
    state: string;
    webUrl: string;
}

export interface WorkItemPayload {
    workItem: MutationWorkItem | null;
    errors: string[];
    message?: string | null;
}

export function mutatedItem(
    payload: WorkItemPayload,
    action: string,
): MutationWorkItem {
    const { workItem, message } = checkPayload(payload, action);
    if (!workItem) {
        throw new Error(message || `Failed to ${action}: no data returned`);
    }
    return workItem;
}

export async function createWorkItem(
    config: Config,
    input: WorkItemCreateInput,
): Promise<MutationWorkItem> {
    const data = await gql<{ workItemCreate: WorkItemPayload }>(
        config,
        `mutation ($input: WorkItemCreateInput!) {
            workItemCreate(input: $input) {
                workItem { id iid title state webUrl }
                errors
            }
        }`,
        { input },
    );
    return mutatedItem(data.workItemCreate, 'create work item');
}

export async function updateWorkItem(
    config: Config,
    input: WorkItemUpdateInput,
): Promise<MutationWorkItem> {
    const data = await gql<{ workItemUpdate: WorkItemPayload }>(
        config,
        `mutation ($input: WorkItemUpdateInput!) {
            workItemUpdate(input: $input) {
                workItem { id iid title state webUrl }
                errors
            }
        }`,
        { input },
    );
    return mutatedItem(data.workItemUpdate, 'update work item');
}

export async function createNote(
    config: Config,
    noteableId: string,
    body: string,
    internal = false,
): Promise<void> {
    const data = await gql<{
        createNote: { note: { id: string } | null; errors: string[] };
    }>(
        config,
        `mutation ($input: CreateNoteInput!) {
            createNote(input: $input) { note { id } errors }
        }`,
        { input: { noteableId, body, internal } },
    );
    checkPayload(data.createNote, 'create note');
}
