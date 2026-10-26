import { resolveWorkItemType } from '../api/item-types.ts';
import { resolveLabels } from '../api/labels.ts';
import { resolveStatus } from '../api/statuses.ts';
import { buildTimeTrackingWidget, isIsoDate } from '../api/time-tracking.ts';
import { resolveUser } from '../api/users.ts';
import {
    createWorkItem,
    updateWorkItem,
    type MutationWorkItem,
    type WorkItemCreateInput,
} from '../api/work-items.ts';
import { warnScopedLabelConflicts } from '../cli/output.ts';
import { errorText } from '../errors.ts';
import { bold, dim, printTable, red } from '../format.ts';

import type { TimeTrackingWidgetInput } from '../api/time-tracking.ts';
import type { Config } from '../config/load.ts';
import type { IssueFileData } from '../inputfile.ts';

export interface CreatePlan {
    input: WorkItemCreateInput;
    timeTracking?: TimeTrackingWidgetInput;
    problems: string[];
}

/** Имена в gid без отправки; собирает все проблемы, а не падает на первой. */
export async function planCreate(
    config: Config,
    data: IssueFileData,
): Promise<CreatePlan> {
    const problems: string[] = [];
    const attempt = async <T>(fn: () => Promise<T> | T) => {
        try {
            return await fn();
        } catch (err) {
            problems.push(errorText(err));
            return undefined;
        }
    };

    if (!data.title) {
        problems.push(
            'No title found. Add a title to the file or use --title.',
        );
    }

    const input: WorkItemCreateInput = {
        title: data.title ?? '',
        workItemTypeId:
            (await attempt(() =>
                resolveWorkItemType(config, data.type ?? 'Issue'),
            )) ?? '',
        namespacePath: config.project,
    };
    if (data.confidential) input.confidential = true;
    if (data.description) {
        input.descriptionWidget = { description: data.description };
    }

    if (data.assignees?.length) {
        const users = await Promise.all(
            data.assignees.map((a) => attempt(() => resolveUser(config, a))),
        );
        const ids = users.flatMap((u) => (u ? [u.id] : []));
        if (ids.length > 0) input.assigneesWidget = { assigneeIds: ids };
    }

    const labels = data.labels;
    if (labels?.length) {
        warnScopedLabelConflicts(labels);
        const labelIds = await attempt(() => resolveLabels(config, labels));
        if (labelIds?.length) input.labelsWidget = { labelIds };
    }

    if (data.weight !== undefined) {
        if (Number.isInteger(data.weight)) {
            input.weightWidget = { weight: data.weight };
        } else {
            problems.push(
                `Invalid weight "${data.weight}". Expected a whole number`,
            );
        }
    }

    for (const [key, value] of [
        ['start', data.start],
        ['due', data.due],
    ] as const) {
        if (value !== undefined && !isIsoDate(value)) {
            problems.push(`Invalid ${key} date "${value}". Use YYYY-MM-DD`);
        }
    }
    if (data.start || data.due) {
        input.startAndDueDateWidget = {
            isFixed: true,
            startDate: data.start ?? null,
            dueDate: data.due ?? null,
        };
    }

    const status = data.status;
    if (status) {
        const statusId = await attempt(() => resolveStatus(config, status));
        if (statusId) input.statusWidget = { status: statusId };
    }

    const timeTracking = await attempt(() => buildTimeTrackingWidget(data));
    return { input, timeTracking, problems };
}

/** Учёт времени в workItemCreate не принимается, поэтому идёт следом обновлением. */
export async function executeCreate(
    config: Config,
    plan: CreatePlan,
): Promise<{ created: MutationWorkItem; followUpError?: string }> {
    const created = await createWorkItem(config, plan.input);
    if (!plan.timeTracking) return { created };
    try {
        await updateWorkItem(config, {
            id: created.id,
            timeTrackingWidget: plan.timeTracking,
        });
        return { created };
    } catch (err) {
        return {
            created,
            followUpError: `#${created.iid} was created, but time tracking was not set: ${errorText(err)}`,
        };
    }
}

function planRows(d: IssueFileData): Array<[string, string | undefined]> {
    const descLines = d.description?.split('\n') ?? [];
    return [
        ['Title', d.title],
        ['Type', d.type ?? 'Issue'],
        ['Labels', d.labels?.join(', ')],
        ['Assignees', d.assignees?.join(', ')],
        ['Weight', d.weight?.toString()],
        ['Start', d.start],
        ['Due', d.due],
        ['Status', d.status],
        ['Estimate', d.estimate],
        ['Spend', d.spend],
        ['Spend date', d.spendDate],
        ['Spend summary', d.spendSummary],
        ['Confidential', d.confidential ? 'yes' : undefined],
        [
            'Description',
            d.description
                ? `${descLines.length} line(s): ${descLines[0]!.slice(0, 60)}`
                : undefined,
        ],
    ];
}

/** Итоговые поля; пришедшие из флагов, а не из файла, помечены. */
export function printCreatePlan(
    file: string,
    parsed: IssueFileData,
    data: IssueFileData,
    problems: string[],
): void {
    console.log(`\n${bold(file)} ${dim('(dry-run, nothing sent)')}`);
    const fromFile = new Map(planRows(parsed));
    const rows: Array<[string, string]> = [];
    for (const [key, value] of planRows(data)) {
        if (value === undefined) continue;
        const old = fromFile.get(key);
        const note =
            value === old
                ? ''
                : dim(
                      old === undefined
                          ? '  ← flag'
                          : `  ← flag (file: ${old})`,
                  );
        rows.push([key, value + note]);
    }
    printTable(rows);
    for (const p of problems) console.log(red(`  ✗ ${p}`));
}
