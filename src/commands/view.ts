import {
    getAssignees,
    getDates,
    getDescription,
    getHierarchy,
    getLabels,
    getLinkedInfo,
    getStatus,
    getTimeTracking,
    getWeight,
    normalizeIid,
} from '../api/work-item.ts';
import { getWorkItemByIid } from '../api/work-items.ts';
import { JSON_OUT, PROJECT, parseFlags } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { printJson } from '../cli/output.ts';
import { CliError } from '../errors.ts';
import {
    fieldText,
    FIELDS_HELP,
    flattenItem,
    parseFieldsFlag,
} from '../fields.ts';
import {
    bold,
    cyan,
    dim,
    green,
    isOpenState,
    printTable,
    secondsToHuman,
} from '../format.ts';

import type { WorkItemNode } from '../api/work-item.ts';
import type { Command } from '../cli/command.ts';

/** Строки карточки; пустые поля пропускаются. */
function detailRows(item: WorkItemNode): Array<[string, string]> {
    const state = item.state.toLowerCase();
    const status = getStatus(item);
    const assignees = getAssignees(item);
    const labels = getLabels(item);
    const weight = getWeight(item);
    const { startDate, dueDate } = getDates(item);
    const { timeEstimate, totalTimeSpent } = getTimeTracking(item);
    const { parent, children } = getHierarchy(item);
    const { blockingCount, blockedByCount } = getLinkedInfo(item);

    const rows: Array<[string, string | false | null | undefined]> = [
        ['ID', cyan(`#${item.iid}`)],
        ['State', isOpenState(item.state) ? green(state) : dim(state)],
        ['Status', status?.name],
        ['Assignees', assignees.map((a) => `@${a.username}`).join(', ')],
        ['Labels', labels.map((l) => l.title).join(', ')],
        ['Weight', weight !== null && String(weight)],
        ['Start', startDate],
        ['Due', dueDate],
        ['Estimate', timeEstimate > 0 && secondsToHuman(timeEstimate)],
        ['Time Spent', totalTimeSpent > 0 && secondsToHuman(totalTimeSpent)],
        ['Parent', parent && `${cyan(`#${parent.iid}`)} ${parent.title}`],
        [
            `Children (${children.length})`,
            children.map((c) => cyan(`#${c.iid}`)).join(', '),
        ],
        ['Blocks', blockingCount > 0 && String(blockingCount)],
        ['Blocked by', blockedByCount > 0 && String(blockedByCount)],
    ];
    return rows.filter((r): r is [string, string] => Boolean(r[1]));
}

export const view: Command = {
    name: 'view',
    aliases: ['v'],
    synopsis: 'view <iid>',
    summary: 'Show a work item',
    help: () => `
glw view <iid> [--fields <csv>] [--json] [--project <path>]

Show details for a work item. With --fields: only those fields, as
key/value lines, or one flat JSON object with --json.

${FIELDS_HELP}
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            ...PROJECT,
            fields: { type: 'string' },
            ...JSON_OUT,
        });
        const iid = positionals[0];
        if (!iid) throw new CliError('Usage: glw view <iid>');

        const fields = parseFieldsFlag(values.fields);
        const config = await projectConfig(values.project);
        const item = await getWorkItemByIid(config, normalizeIid(iid));

        if (fields) {
            const row = flattenItem(item, fields);
            if (values.json) printJson(row);
            else
                printTable(
                    fields.map((f) => [f, fieldText(f, row[f] ?? null)]),
                );
            return;
        }
        if (values.json) {
            printJson(item);
            return;
        }

        console.log(`\n${bold(item.title)}`);
        console.log(dim(item.webUrl));
        console.log();
        printTable(detailRows(item));

        const description = getDescription(item);
        if (description) {
            console.log(`\n${dim('─'.repeat(50))}`);
            console.log(description);
        }
        console.log();
    },
};
