import {
    addLinkedItems,
    parseLinkType,
    removeLinkedItems,
    type LinkType,
} from '../api/links.ts';
import { JSON_OUT, PROJECT, parseFlags } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { printJson } from '../cli/output.ts';
import { getItems } from '../cli/selection.ts';
import { CliError } from '../errors.ts';
import { cyan, dim, green, yellow } from '../format.ts';

import type { Command } from '../cli/command.ts';

const VERBS: Record<LinkType, string> = {
    RELATED: 'related to',
    BLOCKS: 'blocks',
    BLOCKED_BY: 'blocked by',
};

export const link: Command = {
    name: 'link',
    aliases: ['ln'],
    synopsis: 'link <iid> <tgt...>',
    summary: 'Link work items (related/blocks/blocked-by)',
    help: () => `
glw link <iid> <target-iid...> [--type related|blocks|blocked-by] [--remove] [--json]

Link work items together (related / blocks / blocked-by). Creates the link from
<iid> to each target; --remove deletes it instead.

Arguments:
  <iid>              The anchor work item
  <target-iid...>    One or more work items to link to <iid>

Flags:
  --type <t>         Relationship from <iid> to each target:
                     related (default) | blocks | blocked-by
  --remove           Remove the link(s) instead of creating them
                     (--type is ignored on removal)
  --json             JSON output
  --project <path>   Override project

Examples:
  glw link 42 43                     # 42 is related to 43
  glw link 42 43 44 --type blocks    # 42 blocks 43 and 44
  glw link 42 43 --type blocked-by   # 42 is blocked by 43
  glw link 42 43 --remove            # remove the link between 42 and 43
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            ...PROJECT,
            type: { type: 'string' },
            remove: { type: 'boolean' },
            ...JSON_OUT,
        });
        const [anchorIid, ...targetIids] = positionals;
        if (!anchorIid || targetIids.length === 0) {
            throw new CliError(
                'Usage: glw link <iid> <target-iid...> [--type related|blocks|blocked-by] [--remove]',
            );
        }
        const remove = Boolean(values.remove);
        // Тип разбирается до сети, чтобы опечатка не стоила запросов.
        const linkType = remove
            ? null
            : parseLinkType(values.type ?? 'related');

        const config = await projectConfig(values.project);
        const [anchor, ...targets] = await getItems(config, [
            anchorIid,
            ...targetIids,
        ]);
        const targetIds = targets.map((t) => t.id);
        const result = linkType
            ? await addLinkedItems(config, anchor!.id, targetIds, linkType)
            : await removeLinkedItems(config, anchor!.id, targetIds);

        if (values.json) {
            printJson({
                action: remove ? 'unlink' : 'link',
                linkType,
                workItem: {
                    id: result.id,
                    iid: result.iid,
                    title: result.title,
                },
                targets: targets.map((t) => ({
                    id: t.id,
                    iid: t.iid,
                    title: t.title,
                })),
            });
            return;
        }

        const anchorRef = cyan(`#${anchor!.iid}`);
        const targetList = targets.map((t) => cyan(`#${t.iid}`)).join(', ');
        console.log(
            linkType
                ? `${green('Linked')} ${anchorRef} ${dim(VERBS[linkType])} ${targetList}`
                : `${yellow('Unlinked')} ${anchorRef} ${dim('from')} ${targetList}`,
        );
    },
};
