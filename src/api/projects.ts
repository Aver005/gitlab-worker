import { gql, paginate, type Page } from './client.ts';

import type { Config } from '../config/load.ts';

export interface ProjectInfo {
    id: string;
    fullPath: string;
    name: string;
}

/** Проекты, где пользователь состоит участником. */
export async function listProjects(
    config: Config,
    opts: { search?: string; limit?: number } = {},
): Promise<ProjectInfo[]> {
    return paginate(opts.limit ?? 100, async (first, after) => {
        const data = await gql<{ projects: Page<ProjectInfo> }>(
            config,
            `query ($search: String, $first: Int!, $after: String) {
                projects(membership: true, search: $search, first: $first, after: $after) {
                    pageInfo { hasNextPage endCursor }
                    nodes { id fullPath name }
                }
            }`,
            { search: opts.search ?? null, first, after },
        );
        return data.projects;
    });
}

/**
 * Короткое имя проекта, по убыванию приоритета: точный путь, точное имя,
 * последний сегмент пути, единственное вхождение подстроки.
 */
export function pickProject(
    candidates: ProjectInfo[],
    input: string,
): { match?: ProjectInfo; ambiguous?: ProjectInfo[] } {
    const q = input.toLowerCase();
    const single = (list: ProjectInfo[]) =>
        list.length === 1 ? list[0] : undefined;

    const match =
        candidates.find((p) => p.fullPath.toLowerCase() === q) ??
        single(candidates.filter((p) => p.name.toLowerCase() === q)) ??
        single(
            candidates.filter(
                (p) => p.fullPath.toLowerCase().split('/').pop() === q,
            ),
        );
    if (match) return { match };

    const substring = candidates.filter(
        (p) =>
            p.fullPath.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q),
    );
    if (substring.length === 1) return { match: substring[0] };
    if (substring.length > 1) return { ambiguous: substring };
    return {};
}

/** Ссылка с «/» считается полным путём, без «/» ищется среди проектов пользователя. */
export async function resolveProjectPath(
    config: Config,
    input: string,
): Promise<string> {
    if (input.includes('/')) return input;

    const candidates = await listProjects(config, { search: input });
    const { match, ambiguous } = pickProject(candidates, input);
    if (match) return match.fullPath;
    if (ambiguous) {
        throw new Error(
            `Project "${input}" is ambiguous. Matches:\n` +
                ambiguous.map((p) => `  ${p.fullPath}`).join('\n'),
        );
    }
    throw new Error(
        `No project matching "${input}" found among your memberships. Run: glw projects`,
    );
}

export async function resolveProjectId(
    config: Config,
    fullPath: string,
): Promise<string> {
    const data = await gql<{ project: { id: string } | null }>(
        config,
        `query ($fullPath: ID!) { project(fullPath: $fullPath) { id } }`,
        { fullPath },
    );
    if (!data.project) {
        throw new Error(
            `Project not found: "${fullPath}". Check the project path and your access token.`,
        );
    }
    return data.project.id;
}
