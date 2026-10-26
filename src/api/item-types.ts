import { gql } from './client.ts';

import type { Config } from '../config/load.ts';

interface WorkItemType {
    id: string;
    name: string;
}

const cache = new Map<string, WorkItemType[]>();

async function getWorkItemTypes(config: Config): Promise<WorkItemType[]> {
    const cached = cache.get(config.project);
    if (cached) return cached;

    const data = await gql<{
        project: { workItemTypes: { nodes: WorkItemType[] } } | null;
    }>(
        config,
        `query ($fullPath: ID!) {
            project(fullPath: $fullPath) {
                workItemTypes { nodes { id name } }
            }
        }`,
        { fullPath: config.project },
    );

    const types = data.project?.workItemTypes.nodes ?? [];
    cache.set(config.project, types);
    return types;
}

export async function resolveWorkItemType(
    config: Config,
    name: string,
): Promise<string> {
    const types = await getWorkItemTypes(config);
    const match = types.find(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
    );
    if (!match) {
        const available = types.map((t) => t.name).join(', ');
        throw new Error(
            `Work item type "${name}" not found. Available: ${available}`,
        );
    }
    return match.id;
}
