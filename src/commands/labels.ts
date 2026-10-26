import { listLabels } from '../api/labels.ts';
import { intFlag, JSON_OUT, PROJECT, parseFlags } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { printJson } from '../cli/output.ts';
import { cyan, dim } from '../format.ts';

import type { Command } from '../cli/command.ts';

export const labels: Command = {
    name: 'labels',
    synopsis: 'labels',
    summary: "List the project's labels (incl. group labels)",
    help: () => `
glw labels [--search <q>] [--limit <n>] [--json] [--project <ref>]

List labels available in the project, including ones inherited from groups.
Sorted by title, so scoped labels (scope::value) are grouped together.

Flags:
  --search <q>      Title or description contains <q> (e.g. "component::")
  --limit <n>       Max labels to fetch (default: 500)
  --project <ref>   Override project
  --json            JSON output: [{ id, title, description, color }]
`,
    async run(args) {
        const { values } = parseFlags(args, {
            ...PROJECT,
            search: { type: 'string' },
            limit: { type: 'string' },
            ...JSON_OUT,
        });
        const config = await projectConfig(values.project);
        const found = (
            await listLabels(config, {
                search: values.search,
                limit: intFlag(values.limit, 'limit', 500),
            })
        ).toSorted((a, b) =>
            a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
        );

        if (values.json) {
            printJson(found);
            return;
        }
        if (found.length === 0) {
            console.log(dim('No labels found.'));
            return;
        }

        const width = Math.max(...found.map((l) => l.title.length));
        for (const l of found) {
            const desc = l.description?.trim().split('\n')[0];
            console.log(
                desc
                    ? `${cyan(l.title.padEnd(width))}  ${dim(desc)}`
                    : cyan(l.title),
            );
        }
    },
};
