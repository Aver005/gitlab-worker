import { gql } from './client.ts';

import type { Config } from '../config/load.ts';

export interface Status {
    id: string;
    name: string;
}

const systemGid = (n: number) =>
    `gid://gitlab/WorkItems::Statuses::SystemDefined::Status/${n}`;

// Системные статусы GitLab; нужны, когда сервер не отдаёт список разрешённых.
const SYSTEM_STATUSES: Status[] = [
    { id: systemGid(1), name: 'To do' },
    { id: systemGid(2), name: 'In progress' },
    { id: systemGid(3), name: 'Done' },
    { id: systemGid(4), name: "Won't do" },
    { id: systemGid(5), name: 'Duplicate' },
];

const SYSTEM_ALIASES: Record<string, string> = { 'wont do': systemGid(4) };

const cache = new Map<string, Status[]>();

/** Статусы проекта с сервера; на старых версиях GitLab запроса нет, тогда системные. */
export async function getAllowedStatuses(config: Config): Promise<Status[]> {
    const cached = cache.get(config.project);
    if (cached) return cached;

    const statuses = (await fetchAllowedStatuses(config)) ?? SYSTEM_STATUSES;
    cache.set(config.project, statuses);
    return statuses;
}

async function fetchAllowedStatuses(
    config: Config,
): Promise<Status[] | undefined> {
    type Data = {
        project: {
            workItemTypes: {
                nodes: Array<{
                    widgetDefinitions: Array<{
                        type: string;
                        allowedStatuses?: { nodes: Status[] };
                    }>;
                }>;
            };
        } | null;
    };

    let data: Data;
    try {
        data = await gql<Data>(
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
            { fullPath: config.project },
        );
    } catch {
        return undefined;
    }

    const byId = new Map<string, Status>();
    for (const type of data.project?.workItemTypes.nodes ?? []) {
        for (const def of type.widgetDefinitions) {
            for (const s of def.allowedStatuses?.nodes ?? []) byId.set(s.id, s);
        }
    }
    return byId.size > 0 ? [...byId.values()] : undefined;
}

/** Сначала список сервера: свои статусы проекта могут затенять системные имена. */
export async function resolveStatus(
    config: Config,
    name: string,
): Promise<string> {
    const lower = name.toLowerCase();
    const statuses = await getAllowedStatuses(config);
    const match =
        statuses.find((s) => s.name.toLowerCase() === lower) ??
        SYSTEM_STATUSES.find((s) => s.name.toLowerCase() === lower);
    const id = match?.id ?? SYSTEM_ALIASES[lower];
    if (id) return id;

    const available = statuses.map((s) => s.name).join(', ');
    throw new Error(`Status "${name}" not found. Available: ${available}`);
}
