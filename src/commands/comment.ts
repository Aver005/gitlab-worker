import { readFileSync } from 'node:fs';

import { normalizeIid } from '../api/work-item.ts';
import { createNote, getWorkItemByIid } from '../api/work-items.ts';
import { JSON_OUT, PROJECT, parseFlags } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { CliError } from '../errors.ts';
import { cyan, green } from '../format.ts';

import type { Command } from '../cli/command.ts';

export const comment: Command = {
    name: 'comment',
    aliases: ['co'],
    synopsis: 'comment <iid> [text]',
    summary: 'Add a comment to a work item',
    help: () => `
glw comment <iid> [text] [--file <f>] [--internal]

Add a comment to a work item.

  --file <f>    Read comment body from file
  --internal    Mark as internal (confidential) note
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            ...PROJECT,
            file: { type: 'string' },
            internal: { type: 'boolean' },
            ...JSON_OUT,
        });
        const [iid, ...words] = positionals;
        if (!iid) throw new CliError('Usage: glw comment <iid> [text]');

        let body = words.join(' ');
        if (values.file) {
            try {
                body = readFileSync(values.file, 'utf-8');
            } catch (err) {
                throw new CliError(`File not found: ${values.file}`, {
                    cause: err,
                });
            }
        }
        if (!body.trim()) {
            throw new CliError(
                'Comment body is empty. Provide text or use --file.',
            );
        }

        const config = await projectConfig(values.project);
        const item = await getWorkItemByIid(config, normalizeIid(iid));
        await createNote(config, item.id, body, values.internal);
        console.log(`${green('Comment added')} to ${cyan(`#${item.iid}`)}`);
    },
};
