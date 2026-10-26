import { listMyWorkItems } from '../api/work-items.ts';
import { intFlag, itemStateFlag, JSON_OUT, parseFlags } from '../cli/args.ts';
import { connection } from '../cli/context.ts';
import { itemLine, printItems } from '../cli/output.ts';
import { FIELDS_HELP, parseFieldsFlag } from '../fields.ts';
import { bold, cyan } from '../format.ts';

import type { WorkItemNode } from '../api/work-item.ts';
import type { Command } from '../cli/command.ts';

function printByProject(items: WorkItemNode[]): void {
    const byProject = Map.groupBy(items, (i) => i.namespace?.fullPath ?? '?');
    for (const path of [...byProject.keys()].toSorted()) {
        console.log(bold(cyan(path)));
        for (const item of byProject.get(path)!) {
            console.log(`  ${itemLine(item, { assignee: false })}`);
        }
    }
}

export const mine: Command = {
    name: 'mine',
    synopsis: 'mine',
    summary: 'Work items assigned to me in all projects',
    help: () => `
glw mine [--state opened|closed|all] [--label <l>]... [--limit <n>] [--fields <csv>] [--json]

Work items assigned to you in every project you can see (server-side filter,
no default project needed). Grouped by project. Needs GitLab 17.10+.

Flags:
  --state <s>       opened | closed | all (default: opened)
  --label <l>       Only items with this label; repeatable, all must match
  --limit <n>       Max results (default: 100)
  --fields <csv>    Flat output of chosen fields (see "Fields" below)
  --json            JSON output

${FIELDS_HELP}

Examples:
  glw mine
  glw mine --label bug --fields project,iid,title,status,due
`,
    async run(args) {
        const { values } = parseFlags(args, {
            state: { type: 'string' },
            label: { type: 'string', multiple: true },
            limit: { type: 'string' },
            fields: { type: 'string' },
            ...JSON_OUT,
        });
        const fields = parseFieldsFlag(values.fields);
        const items = await listMyWorkItems(connection(), {
            state: itemStateFlag(values.state),
            labels: values.label,
            limit: intFlag(values.limit, 'limit', 100),
            includeDescription: fields?.includes('description'),
        });

        if (fields || values.json || items.length === 0) {
            printItems(items, {
                fields,
                json: values.json,
                empty: 'No work items assigned to you.',
            });
            return;
        }
        printByProject(items);
    },
};
