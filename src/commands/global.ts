import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseFlags } from '../cli/args.ts';
import {
    CONFIG_FILE,
    globalDir,
    isGlobalMode,
    migrateLocalToGlobal,
    setGlobalMode,
} from '../config/global.ts';
import { dim, green, yellow } from '../format.ts';

import type { Command } from '../cli/command.ts';

const help = () => `
glw global <on|off|status>

Toggle the shared global environment. When ON, glw also reads .env and
glw.config.json from the global dir (local files in cwd still win):
  ${globalDir()}

  on      enable; copies local glw.config.json/.env there if it's empty
  off     disable (cwd-only config, as before)
  status  show current mode and which global files exist (default)

Set it up from scratch with: glw init <token> --global
`;

export const global: Command = {
    name: 'global',
    synopsis: 'global <on|off>',
    summary: 'Toggle the shared global environment (%APPDATA%/glw)',
    help,
    async run(args) {
        const { positionals } = parseFlags(args, {});
        const action = positionals[0] ?? 'status';
        const dir = globalDir();

        switch (action) {
            case 'on': {
                setGlobalMode(true);
                const copied = migrateLocalToGlobal();
                console.log(`${green('Global mode ON')} ${dim(`(${dir})`)}`);
                if (copied.length > 0) {
                    console.log(
                        dim(
                            `Copied from current directory: ${copied.join(', ')}`,
                        ),
                    );
                }
                return;
            }
            case 'off':
                setGlobalMode(false);
                console.log(
                    `${yellow('Global mode OFF')} ${dim('— config is read from the current directory only')}`,
                );
                return;
            case 'status':
                console.log(
                    `Global mode: ${isGlobalMode() ? green('on') : yellow('off')}`,
                );
                console.log(dim(`Dir: ${dir}`));
                for (const name of [CONFIG_FILE, '.env']) {
                    const state = existsSync(join(dir, name))
                        ? 'present'
                        : 'absent';
                    console.log(dim(`  ${name}: ${state}`));
                }
                return;
            default:
                console.log(help());
        }
    },
};
