import { resolveUsername } from '../api/users.ts';
import {
    hasAssignee,
    hasLabel,
    normalizeIid,
    type WorkItemNode,
} from '../api/work-item.ts';
import { getWorkItemByIid, listWorkItems } from '../api/work-items.ts';
import { yellow } from '../format.ts';
import { itemStateFlag } from './args.ts';
import { itemLine } from './output.ts';

import type { Config } from '../config/load.ts';

export const SELECTION = {
    search: { type: 'string' },
    'filter-assignee': { type: 'string' },
    'filter-label': { type: 'string' },
    state: { type: 'string' },
} as const;

interface SelectionFlags {
    search?: string;
    'filter-assignee'?: string;
    'filter-label'?: string;
    state?: string;
}

/** Исполнитель и метка фильтруются на клиенте: так не зависим от версии GitLab. */
export async function filterItems(
    config: Config,
    items: WorkItemNode[],
    filters: { assignee?: string; label?: string },
): Promise<WorkItemNode[]> {
    let result = items;
    if (filters.assignee) {
        const username = await resolveUsername(config, filters.assignee);
        result = result.filter((i) => hasAssignee(i, username));
    }
    const label = filters.label;
    if (label) result = result.filter((i) => hasLabel(i, label));
    return result;
}

export function getItems(
    config: Config,
    iids: string[],
): Promise<WorkItemNode[]> {
    return Promise.all(
        iids.map((iid) => getWorkItemByIid(config, normalizeIid(iid))),
    );
}

/** Явные номера или выборка фильтрами, если номеров нет. */
export async function selectItems(
    config: Config,
    iids: string[],
    flags: SelectionFlags,
): Promise<{ items: WorkItemNode[]; byFilter: boolean }> {
    if (iids.length > 0) {
        return { items: await getItems(config, iids), byFilter: false };
    }
    const listed = await listWorkItems(config, {
        state: itemStateFlag(flags.state),
        search: flags.search,
        limit: 200,
    });
    const items = await filterItems(config, listed, {
        assignee: flags['filter-assignee'],
        label: flags['filter-label'],
    });
    return { items, byFilter: true };
}

export function printSelection(items: WorkItemNode[]): void {
    console.log(`\nFound ${yellow(String(items.length))} work item(s):\n`);
    for (const item of items) console.log(`  ${itemLine(item)}`);
    console.log();
}
