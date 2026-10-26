import {
    getDates,
    getDescription,
    matchesSearch,
    type SearchCriteria,
} from '../api/work-item.ts';
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
import { CliError } from '../errors.ts';
import { FIELDS_HELP, parseFieldsFlag } from '../fields.ts';

import type { Command } from '../cli/command.ts';

export const search: Command = {
    name: 'search',
    aliases: ['s'],
    synopsis: 'search',
    summary: 'Search work items with filters',
    help: () => `
glw search [text] [--name <q>] [--body <q>] [--start_time <YYYY-MM-DD>] [--state opened|closed|all] [--limit <n>] [--fields <csv>] [--json] [--project <ref>]

Search work items. At least one filter is required.

Arguments:
  text               Search title AND description (server + client filter)

Flags:
  --name <q>         Title contains (case-insensitive)
  --body <q>         Description contains (case-insensitive)
  --start_time <d>   Start date >= YYYY-MM-DD (alias: --start)
  --state <s>        opened | closed | all (default: opened)
  --limit <n>        Max items to fetch (default: 200)
  --fields <csv>     Flat output of chosen fields (see "Fields" below)
  --project <ref>    Override project
  --json             JSON output

${FIELDS_HELP}

Examples:
  glw search "authentication"
  glw search --name "auth" --body "JWT"
  glw s --start_time 2026-01-01 --state all
  glw search "auth" --fields iid,title,status,labels --json
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            ...PROJECT,
            name: { type: 'string' },
            body: { type: 'string' },
            start_time: { type: 'string' },
            start: { type: 'string' },
            state: { type: 'string' },
            limit: { type: 'string' },
            fields: { type: 'string' },
            ...JSON_OUT,
        });
        const fields = parseFieldsFlag(values.fields);
        const criteria: SearchCriteria = {
            text: positionals[0],
            name: values.name,
            body: values.body,
            startTime: values.start_time ?? values.start,
        };
        if (Object.values(criteria).every((v) => v === undefined)) {
            throw new CliError(
                'At least one filter is required: positional text, --name, --body, or --start_time\nRun: glw search --help',
            );
        }

        const config = await projectConfig(values.project);
        // Серверный поиск шире нужного, поэтому результат ещё раз сверяется здесь.
        const items = await listWorkItems(config, {
            state: itemStateFlag(values.state),
            search: criteria.text,
            limit: intFlag(values.limit, 'limit', 200),
            includeDescription: true,
        });
        const found = items.filter((item) =>
            matchesSearch(
                {
                    title: item.title,
                    description: getDescription(item),
                    startDate: getDates(item).startDate,
                },
                criteria,
            ),
        );
        printItems(found, { fields, json: values.json });
    },
};
