import { createNote, updateWorkItem } from '../api/work-items.ts';
import { JSON_OUT, PROJECT, parseFlags, YES } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { forEachItem } from '../cli/output.ts';
import { confirmOrAbort } from '../cli/prompt.ts';
import { printSelection, SELECTION, selectItems } from '../cli/selection.ts';
import { bold, cyan, dim, green } from '../format.ts';

import type { Command } from '../cli/command.ts';

export const close: Command = {
    name: 'close',
    synopsis: 'close [iid...]',
    summary: 'Close one or more work items',
    help: () => `
glw close [iid...] [selection flags] [--comment <text>] [--yes]

Close one or more work items.

Selection (if no iids given):
  --search <q>
  --filter-assignee <u>
  --filter-label <l>
  --state <s>           (default: opened)

Options:
  --comment <text>  Add a comment before closing
  --yes             Skip confirmation
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            ...PROJECT,
            ...SELECTION,
            comment: { type: 'string' },
            ...YES,
            ...JSON_OUT,
        });
        const config = await projectConfig(values.project);
        const { items, byFilter } = await selectItems(
            config,
            positionals,
            values,
        );

        if (byFilter) {
            if (items.length === 0) {
                console.log(dim('No matching work items found.'));
                return;
            }
            printSelection(items);
            const question = `Close ${items.length} item(s)?`;
            if (!(await confirmOrAbort(question, values.yes))) return;
        }

        const comment = values.comment;
        await forEachItem(
            items,
            (item) => `#${item.iid}`,
            async (item) => {
                if (comment) await createNote(config, item.id, comment);
                await updateWorkItem(config, {
                    id: item.id,
                    stateEvent: 'CLOSE',
                });
                console.log(
                    `${green('Closed')} ${cyan(`#${item.iid}`)} ${bold(item.title)}`,
                );
            },
        );
    },
};
