import { errorText } from '../errors.ts';

import type { Config } from '../config/load.ts';

interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}

export async function gql<T>(
    config: Config,
    query: string,
    variables: Record<string, unknown> = {},
): Promise<T> {
    const endpoint = `${config.url}/api/graphql`;

    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.token}`,
            },
            body: JSON.stringify({ query, variables }),
        });
    } catch (err) {
        throw new Error(
            `Network error connecting to ${endpoint}: ${errorText(err)}`,
            { cause: err },
        );
    }

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
            `GitLab API HTTP ${response.status} ${response.statusText}` +
                (body ? `\n${body.slice(0, 500)}` : ''),
        );
    }

    let json: GraphQLResponse<T>;
    try {
        json = (await response.json()) as GraphQLResponse<T>;
    } catch (err) {
        throw new Error('Failed to parse GitLab API response as JSON', {
            cause: err,
        });
    }

    if (json.errors && json.errors.length > 0) {
        const messages = json.errors.map((e) => e.message).join('; ');
        throw new Error(`GitLab GraphQL error: ${messages}`);
    }
    if (json.data === undefined) {
        throw new Error('GitLab API returned no data');
    }
    return json.data;
}

// В запрос попадают только заданные аргументы: GraphQL отвергает
// объявленную, но не использованную переменную.
export function optionalArgs(
    defs: Array<[name: string, type: string, value: unknown]>,
): { args: string; params: string; variables: Record<string, unknown> } {
    const used = defs.filter(([, , value]) => value !== undefined);
    return {
        args: used.map(([name]) => `, ${name}: $${name}`).join(''),
        params: used.map(([name, type]) => `, $${name}: ${type}`).join(''),
        variables: Object.fromEntries(used.map(([name, , v]) => [name, v])),
    };
}

export interface Page<T> {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: T[];
}

// GitLab отдаёт не больше 100 узлов за запрос, даже если просить больше.
const MAX_PAGE = 100;

/** Курсорная выборка до `limit` узлов; `null` от сервера значит «пусто». */
export async function paginate<T>(
    limit: number,
    fetchPage: (first: number, after: string | null) => Promise<Page<T> | null>,
): Promise<T[]> {
    const results: T[] = [];
    let cursor: string | null = null;

    while (results.length < limit) {
        const page = await fetchPage(
            Math.min(MAX_PAGE, limit - results.length),
            cursor,
        );
        if (!page) break;
        results.push(...page.nodes);
        if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
        cursor = page.pageInfo.endCursor;
    }

    return results.slice(0, limit);
}

/** Мутации GitLab сообщают об отказе в `errors`, а не ошибкой GraphQL. */
export function checkPayload<T extends { errors: string[] }>(
    payload: T,
    action: string,
): T {
    if (payload.errors.length > 0) {
        throw new Error(`Failed to ${action}: ${payload.errors.join('; ')}`);
    }
    return payload;
}
