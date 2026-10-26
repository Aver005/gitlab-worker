import { findScopedLabelConflicts } from '../api/labels.ts';
import { getAssignees, getLabels } from '../api/work-item.ts';
import { errorText } from '../errors.ts';
import { flattenItem, formatFieldTable } from '../fields.ts';
import { bold, dim, formatIssueLine, red } from '../format.ts';

import type { WorkItemNode } from '../api/work-item.ts';

export function printJson(value: unknown): void {
    console.log(JSON.stringify(value));
}

export function maskToken(token: string): string {
    return token.length > 8 ? `${token.slice(0, 8)}...` : '***';
}

export function itemLine(
    item: WorkItemNode,
    opts: { assignee?: boolean } = {},
): string {
    return formatIssueLine({
        iid: item.iid,
        state: item.state,
        title: item.title,
        labels: getLabels(item).map((l) => l.title),
        assignee:
            opts.assignee === false
                ? undefined
                : getAssignees(item)[0]?.username,
    });
}

export function printTableRows(lines: string[]): void {
    const [header, ...rows] = lines;
    if (header !== undefined) console.log(bold(header));
    for (const row of rows) console.log(row);
}

/** Общий вывод списков: `--fields`, затем `--json`, затем строки задач. */
export function printItems(
    items: WorkItemNode[],
    opts: { fields?: string[]; json?: boolean; empty?: string } = {},
): void {
    if (opts.fields) {
        const rows = items.map((i) => flattenItem(i, opts.fields!));
        if (opts.json) printJson(rows);
        else if (rows.length === 0) console.log(dim('No work items found.'));
        else printTableRows(formatFieldTable(rows, opts.fields));
        return;
    }
    if (opts.json) {
        printJson(items);
        return;
    }
    if (items.length === 0) {
        console.log(dim(opts.empty ?? 'No work items found.'));
        return;
    }
    for (const item of items) console.log(itemLine(item));
}

export function warnScopedLabelConflicts(names: string[]): void {
    for (const { scope, labels } of findScopedLabelConflicts(names)) {
        process.stderr.write(
            `glw: warning: labels ${labels.join(', ')} share scope "${scope}" — GitLab keeps only one\n`,
        );
    }
}

/** Сбой на одном элементе печатается и даёт код выхода 1, но остальные идут дальше. */
export async function forEachItem<T>(
    items: T[],
    label: (item: T) => string,
    action: (item: T) => Promise<void>,
): Promise<Array<{ item: T; error: string }>> {
    const failures: Array<{ item: T; error: string }> = [];
    for (const item of items) {
        try {
            await action(item);
        } catch (err) {
            const error = errorText(err);
            failures.push({ item, error });
            console.error(red(`Failed ${label(item)}: ${error}`));
        }
    }
    if (failures.length > 0) process.exitCode = 1;
    return failures;
}
