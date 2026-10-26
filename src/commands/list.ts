import { listWorkItems } from '../api/work-items.ts';
import {
    intFlag,
    itemStateFlag,
    JSON_OUT,
    PROJECT,
    parseFlags,
} from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { printItems } from '../cli/output.ts';
import { filterItems } from '../cli/selection.ts';
import { FIELDS_HELP, parseFieldsFlag } from '../fields.ts';

import type { Command } from '../cli/command.ts';

export const list: Command = {
    name: 'list',
    aliases: ['l', 'ls'],
    synopsis: 'list',
    summary: 'List work items',
    help: () => `
glw list [flags]

List work items.

Flags:
  --state <s>       opened | closed | all (default: opened)
  --search <q>      Search query
  --assignee <u>    Filter by assignee (client-side)
  --label <l>       Filter by label (client-side)
  --limit <n>       Max results (default: 50)
  --fields <csv>    Flat output of chosen fields (see "Fields" below)
  --project <path>  Override project
  --json            JSON output

${FIELDS_HELP}
`,
    async run(args) {
        const { values } = parseFlags(args, {
            ...PROJECT,
            state: { type: 'string' },
            search: { type: 'string' },
            assignee: { type: 'string' },
            label: { type: 'string' },
            limit: { type: 'string' },
            fields: { type: 'string' },
            ...JSON_OUT,
        });
        const fields = parseFieldsFlag(values.fields);
        const config = await projectConfig(values.project);

        const items = await listWorkItems(config, {
            state: itemStateFlag(values.state),
            search: values.search,
            limit: intFlag(values.limit, 'limit', 50),
            includeDescription: fields?.includes('description'),
        });
        const filtered = await filterItems(config, items, {
            assignee: values.assignee,
            label: values.label,
        });
        printItems(filtered, { fields, json: values.json });
    },
};
