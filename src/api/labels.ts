import { gql, paginate, type Page } from './client.ts';

import type { Config } from '../config/load.ts';
import type { LabelRef } from './work-item.ts';

// Ключ — «проект:имя в нижнем регистре», значение — gid метки.
const idByName = new Map<string, string>();

/** Имена в gid, включая метки родительских групп; неизвестные — одной ошибкой. */
export async function resolveLabels(
    config: Config,
    names: string[],
): Promise<string[]> {
    const ids: string[] = [];
    const missing: string[] = [];

    for (const name of names) {
        const key = `${config.project}:${name.toLowerCase()}`;
        const id = idByName.get(key) ?? (await findLabelId(config, name));
        if (id) {
            idByName.set(key, id);
            ids.push(id);
        } else {
            missing.push(name);
        }
    }

    if (missing.length > 0) {
        throw new Error(`Unknown label(s): ${missing.join(', ')}`);
    }
    return ids;
}

async function findLabelId(
    config: Config,
    name: string,
): Promise<string | undefined> {
    const data = await gql<{
        project: { labels: { nodes: LabelRef[] } } | null;
    }>(
        config,
        `query ($fullPath: ID!, $search: String) {
            project(fullPath: $fullPath) {
                labels(searchTerm: $search, includeAncestorGroups: true) {
                    nodes { id title }
                }
            }
        }`,
        { fullPath: config.project, search: name },
    );
    const lower = name.toLowerCase();
    return data.project?.labels.nodes.find(
        (n) => n.title.toLowerCase() === lower,
    )?.id;
}

export interface LabelInfo {
    id: string;
    title: string;
    description: string | null;
    color: string;
}

export async function listLabels(
    config: Config,
    opts: { search?: string; limit?: number } = {},
): Promise<LabelInfo[]> {
    return paginate(opts.limit ?? 500, async (first, after) => {
        const data = await gql<{
            project: { labels: Page<LabelInfo> } | null;
        }>(
            config,
            `query ($fullPath: ID!, $search: String, $first: Int!, $after: String) {
                project(fullPath: $fullPath) {
                    labels(searchTerm: $search, includeAncestorGroups: true, first: $first, after: $after) {
                        pageInfo { hasNextPage endCursor }
                        nodes { id title description color }
                    }
                }
            }`,
            {
                fullPath: config.project,
                search: opts.search ?? null,
                first,
                after,
            },
        );
        if (!data.project) {
            throw new Error(`Project not found: "${config.project}"`);
        }
        return data.project.labels;
    });
}

/**
 * Группы scoped-меток одной области (текст до последнего «::»).
 * GitLab оставляет на задаче одну метку из области и молча снимает остальные.
 */
export function findScopedLabelConflicts(
    names: string[],
): Array<{ scope: string; labels: string[] }> {
    const byScope = new Map<string, { scope: string; labels: string[] }>();
    const seen = new Set<string>();
    for (const name of names) {
        const key = name.toLowerCase();
        const sep = name.lastIndexOf('::');
        if (sep <= 0 || seen.has(key)) continue;
        seen.add(key);
        const scope = name.slice(0, sep);
        const group = byScope.get(scope.toLowerCase()) ?? { scope, labels: [] };
        group.labels.push(name);
        byScope.set(scope.toLowerCase(), group);
    }
    return [...byScope.values()].filter((g) => g.labels.length > 1);
}
