import { normalizeIid } from '../api/work-item.ts';
import { getWorkItemByIid, updateWorkItem } from '../api/work-items.ts';
import { JSON_OUT, PROJECT, parseFlags } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { forEachItem } from '../cli/output.ts';
import { CliError } from '../errors.ts';
import { bold, cyan, green } from '../format.ts';

import type { Command } from '../cli/command.ts';

export const reopen: Command = {
    name: 'reopen',
    synopsis: 'reopen <iid...>',
    summary: 'Reopen work items',
    help: () =>
        'glw reopen <iid...> [--project <path>]\n\nReopen closed work items.',
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            ...PROJECT,
            ...JSON_OUT,
        });
        if (positionals.length === 0) {
            throw new CliError('Usage: glw reopen <iid...>');
        }
        const config = await projectConfig(values.project);

        await forEachItem(
            positionals,
            (iid) => `#${iid}`,
            async (iid) => {
                const item = await getWorkItemByIid(config, normalizeIid(iid));
                await updateWorkItem(config, {
                    id: item.id,
                    stateEvent: 'REOPEN',
                });
                console.log(
                    `${green('Reopened')} ${cyan(`#${item.iid}`)} ${bold(item.title)}`,
                );
            },
        );
    },
};
