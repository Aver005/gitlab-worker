import { getCurrentUser } from '../api/users.ts';
import { JSON_OUT, PROJECT, parseFlags } from '../cli/args.ts';
import { connection } from '../cli/context.ts';
import { printJson } from '../cli/output.ts';
import { bold, cyan } from '../format.ts';

import type { Command } from '../cli/command.ts';

export const whoami: Command = {
    name: 'whoami',
    synopsis: 'whoami',
    summary: 'Show the authenticated user',
    help: () => 'glw whoami [--json]\n\nShow the authenticated GitLab user.',
    async run(args) {
        // --project принимается ради единообразия, пользователю проект не нужен.
        const { values } = parseFlags(args, { ...PROJECT, ...JSON_OUT });
        const user = await getCurrentUser(connection());
        if (values.json) printJson(user);
        else console.log(`${bold(user.name)} (${cyan(`@${user.username}`)})`);
    },
};
