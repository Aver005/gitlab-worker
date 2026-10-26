import { join } from 'node:path';

import { parseFlags } from '../cli/args.ts';
import { maskToken } from '../cli/output.ts';
import { writeDotEnvToken } from '../config/dotenv.ts';
import { globalDir, targetDir } from '../config/global.ts';
import { writeConfigTemplate } from '../config/load.ts';
import { dim, green } from '../format.ts';

import type { Command } from '../cli/command.ts';

const NEXT_STEPS = `
Next steps:
  1. Edit glw.config.json — set "url" and "project"
  2. Create a GitLab Personal Access Token with the "api" scope:
     https://your-gitlab-instance/-/user_settings/personal_access_tokens
  3. Set your token in .env or environment:
     glw init glpat-xxxxxxxx
  4. Test the connection:
     glw whoami
`;

export const init: Command = {
    name: 'init',
    aliases: ['i'],
    synopsis: 'init',
    summary: 'Create a glw.config.json template (or set token in .env)',
    help: () => `
glw init [token] [--global | --local]

Create a glw.config.json template (left untouched if it already exists).
With a token argument, also write GITLAB_TOKEN=<token> to .env (creates the
file or replaces the existing line).

Target directory:
  - global mode ON (glw global on) → ${globalDir()}
  - global mode OFF               → current directory
  - --global / --local force one or the other explicitly

Examples:
  glw init
  glw init glpat-xxxxxxxxxxxxxxxx
  glw init glpat-xxxxxxxxxxxxxxxx --global
  glw init --local
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            global: { type: 'boolean', short: 'g' },
            local: { type: 'boolean' },
        });
        const token = positionals[0];
        const dir = targetDir(values);
        const configPath = join(dir, 'glw.config.json');

        console.log(
            writeConfigTemplate(dir)
                ? green(`Created ${configPath}`)
                : dim(`${configPath} already exists — left untouched`),
        );

        if (!token) {
            console.log(NEXT_STEPS);
            return;
        }
        writeDotEnvToken(token, dir);
        console.log(
            green(
                `GITLAB_TOKEN set in ${join(dir, '.env')}: ${maskToken(token)}`,
            ),
        );
    },
};
