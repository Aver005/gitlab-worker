import { resolveProjectPath } from '../api/projects.ts';
import { readProjectsCache, writeProjectsCache } from '../cache.ts';
import { parseFlags } from '../cli/args.ts';
import { connection } from '../cli/context.ts';
import { saveConfigProject } from '../config/load.ts';
import { CliError } from '../errors.ts';
import { cyan, dim, green } from '../format.ts';

import type { Command } from '../cli/command.ts';

export const use: Command = {
    name: 'use',
    synopsis: 'use <project>',
    summary: 'Set the default project (saved to glw.config.json)',
    help: () => `
glw use <project>

Set the default project, saved to glw.config.json.
<project> is a full path (group/project) or a unique short name.

Examples:
  glw use backend-api
  glw use acme/internal/backend-api
`,
    async run(args) {
        const ref = parseFlags(args, {}).positionals[0];
        if (!ref) throw new CliError('Usage: glw use <project>');

        const fullPath = await resolveProjectPath(connection(), ref);
        saveConfigProject(fullPath);
        // Дописываем, а не перезаписываем: один путь не должен затереть весь кеш.
        writeProjectsCache([...readProjectsCache(), fullPath]);
        console.log(
            `${green('Default project set:')} ${cyan(fullPath)} ${dim('(saved to glw.config.json)')}`,
        );
    },
};
