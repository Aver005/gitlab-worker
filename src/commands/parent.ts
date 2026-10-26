import { normalizeIid } from '../api/work-item.ts';
import { getWorkItemByIid, updateWorkItem } from '../api/work-items.ts';
import { JSON_OUT, PROJECT, parseFlags } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { forEachItem, printJson } from '../cli/output.ts';
import { CliError } from '../errors.ts';
import { bold, cyan, dim, green, yellow } from '../format.ts';

import type { Command } from '../cli/command.ts';

export const parent: Command = {
    name: 'parent',
    synopsis: 'parent <iid...> --to',
    summary: 'Set or clear the parent (hierarchy)',
    help: () => `
glw parent <iid...> --to <parent-iid|none> [--json]

Set or clear the parent of one or more work items (hierarchy). Use it to nest
issues under a parent/epic, or to reparent/detach them. Setting the same parent
on several items is how you "add children" to that parent.

Arguments:
  <iid...>           Child work item(s) to reparent

Flags:
  --to <n|none>      Parent work item number, or "none" to remove the parent
  --json             JSON output
  --project <path>   Override project

Examples:
  glw parent 4 --to 3          # make #4 a child of #3
  glw parent 4 5 6 --to 3      # add #4, #5, #6 as children of #3
  glw parent 4 --to none       # detach #4 from its parent
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            ...PROJECT,
            to: { type: 'string' },
            ...JSON_OUT,
        });
        if (positionals.length === 0) {
            throw new CliError(
                'Usage: glw parent <iid...> --to <parent-iid|none>',
            );
        }
        if (values.to === undefined) {
            throw new CliError(
                'Missing --to. Use: glw parent <iid...> --to <parent-iid|none>',
            );
        }
        const childIids = positionals.map(normalizeIid);
        const clear = values.to.trim().toLowerCase() === 'none';

        const config = await projectConfig(values.project);
        const parentItem = clear
            ? null
            : await getWorkItemByIid(config, normalizeIid(values.to));
        const parentRef = parentItem ? `#${parentItem.iid}` : null;

        const children: Array<{ id: string; iid: string; title: string }> = [];
        await forEachItem(
            childIids,
            (iid) => `#${iid}`,
            async (iid) => {
                const child = await getWorkItemByIid(config, iid);
                const updated = await updateWorkItem(config, {
                    id: child.id,
                    hierarchyWidget: { parentId: parentItem?.id ?? null },
                });
                children.push({
                    id: updated.id,
                    iid: updated.iid,
                    title: updated.title,
                });
                if (values.json) return;
                const ref = cyan(`#${updated.iid}`);
                console.log(
                    parentRef
                        ? `${green('Set parent')} of ${ref} ${dim('→')} ${cyan(parentRef)} ${bold(updated.title)}`
                        : `${yellow('Cleared parent')} of ${ref} ${bold(updated.title)}`,
                );
            },
        );

        if (values.json) {
            printJson({
                action: clear ? 'clear-parent' : 'set-parent',
                parent: parentRef,
                children,
            });
        }
    },
};
