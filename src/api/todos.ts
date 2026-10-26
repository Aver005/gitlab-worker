import {
    checkPayload,
    gql,
    optionalArgs,
    paginate,
    type Page,
} from './client.ts';

import type { Config } from '../config/load.ts';

// Поле `target` устарело с 17.4 и бывает null вопреки схеме — читаем `targetEntity`.
export interface TodoNode {
    id: string;
    action: string;
    body: string;
    state: string;
    createdAt: string;
    targetType: string;
    targetUrl: string | null;
    author: { username: string } | null;
    project: { fullPath: string } | null;
    group: { fullPath: string } | null;
    targetEntity: {
        name: string | null;
        webUrl: string | null;
        iid?: string;
        // У Issue, WorkItem и MergeRequest state — разные enum'ы, без алиасов не смешать.
        issueState?: string;
        workItemState?: string;
        mrState?: string;
    } | null;
}

export type TodoState = 'pending' | 'done' | 'all';

export async function listTodos(
    config: Config,
    opts: { state?: TodoState; projectId?: string; limit?: number } = {},
): Promise<TodoNode[]> {
    const state = opts.state ?? 'pending';
    const { args, params, variables } = optionalArgs([
        ['projectId', '[ID!]', opts.projectId ? [opts.projectId] : undefined],
    ]);
    const query = `
        query ($state: [TodoStateEnum!], $first: Int!, $after: String${params}) {
            currentUser {
                todos(state: $state, first: $first, after: $after${args}) {
                    pageInfo { hasNextPage endCursor }
                    nodes {
                        id action body state createdAt targetType targetUrl
                        author { username }
                        project { fullPath }
                        group { fullPath }
                        targetEntity {
                            name webUrl
                            ... on Issue { iid issueState: state }
                            ... on WorkItem { iid workItemState: state }
                            ... on MergeRequest { iid mrState: state }
                        }
                    }
                }
            }
        }`;

    return paginate(opts.limit ?? 100, async (first, after) => {
        const data = await gql<{
            currentUser: { todos: Page<TodoNode> | null } | null;
        }>(config, query, {
            ...variables,
            state: state === 'all' ? ['pending', 'done'] : [state],
            first,
            after,
        });
        return data.currentUser?.todos ?? null;
    });
}

export async function markTodoDone(config: Config, id: string): Promise<void> {
    const data = await gql<{ todoMarkDone: { errors: string[] } }>(
        config,
        `mutation ($id: TodoID!) {
            todoMarkDone(input: { id: $id }) { todo { id state } errors }
        }`,
        { id },
    );
    checkPayload(data.todoMarkDone, 'mark to-do done');
}

/** Закрывает все ожидающие дела (или дела одного проекта); возвращает их число. */
export async function markAllTodosDone(
    config: Config,
    projectId?: string,
): Promise<number> {
    const data = await gql<{
        todosMarkAllDone: { todos: Array<{ id: string }>; errors: string[] };
    }>(
        config,
        `mutation ($input: TodosMarkAllDoneInput!) {
            todosMarkAllDone(input: $input) { todos { id } errors }
        }`,
        { input: projectId ? { projectId: [projectId] } : {} },
    );
    return checkPayload(data.todosMarkAllDone, 'mark to-dos done').todos.length;
}

// ─── Плоский вид записи ──────────────────────────────────────────────────────

export interface FlatTodo {
    id: string;
    action: string;
    state: string;
    type: string;
    project: string | null;
    ref: string;
    title: string;
    targetState: string | null;
    author: string | null;
    createdAt: string;
    url: string | null;
    body: string;
}

const TODO_GID_PREFIX = 'gid://gitlab/Todo/';

/** «123» или «gid://gitlab/Todo/123» в глобальный id; остальное — ошибка. */
export function toTodoGid(input: string): string {
    const s = input.trim();
    const num = s.startsWith(TODO_GID_PREFIX)
        ? s.slice(TODO_GID_PREFIX.length)
        : s;
    if (!/^\d+$/.test(num)) {
        throw new Error(
            `Invalid to-do id "${input}". Expected a number like 123 (see: glw todos)`,
        );
    }
    return TODO_GID_PREFIX + num;
}

/** Ссылка в синтаксисе GitLab: group/app#42, group/app!7 для MR, group&3 для эпика. */
export function todoRef(
    targetType: string,
    path: string | null,
    iid: string | undefined,
): string {
    if (!iid) return path ?? '';
    const sigil =
        targetType === 'MERGEREQUEST' ? '!' : targetType === 'EPIC' ? '&' : '#';
    return `${path ?? ''}${sigil}${iid}`;
}

export function flattenTodo(t: TodoNode): FlatTodo {
    const e = t.targetEntity;
    const path = t.project?.fullPath ?? t.group?.fullPath ?? null;
    const targetState = e?.workItemState ?? e?.issueState ?? e?.mrState;
    return {
        id: t.id.replace(TODO_GID_PREFIX, ''),
        action: t.action,
        state: t.state,
        type: t.targetType,
        project: path,
        ref: todoRef(t.targetType, path, e?.iid),
        title: e?.name ?? t.body,
        targetState: targetState?.toLowerCase() ?? null,
        author: t.author?.username ?? null,
        createdAt: t.createdAt,
        url: e?.webUrl ?? t.targetUrl,
        body: t.body,
    };
}
