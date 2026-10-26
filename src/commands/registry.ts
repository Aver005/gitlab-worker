/** Единый список команд: из него собираются диспетчер, общая справка и автодополнение. */

import { close } from './close.ts';
import { comment } from './comment.ts';
import { completionCommand } from './completion.ts';
import { config } from './config.ts';
import { create } from './create.ts';
import { global } from './global.ts';
import { init } from './init.ts';
import { labels } from './labels.ts';
import { link } from './link.ts';
import { list } from './list.ts';
import { mine } from './mine.ts';
import { parent } from './parent.ts';
import { projects } from './projects.ts';
import { reopen } from './reopen.ts';
import { search } from './search.ts';
import { estimate, spend } from './time.ts';
import { todos } from './todos.ts';
import { update } from './update.ts';
import { use } from './use.ts';
import { view } from './view.ts';
import { whoami } from './whoami.ts';

import type { Command } from '../cli/command.ts';

export const COMMANDS: Command[] = [
    init,
    config,
    global,
    whoami,
    projects,
    use,
    labels,
    search,
    create,
    list,
    mine,
    todos,
    view,
    update,
    comment,
    close,
    reopen,
    link,
    parent,
    estimate,
    spend,
    completionCommand(() => [
        ...COMMANDS.map((c) => c.name),
        ...COMMANDS.flatMap((c) => c.aliases ?? []),
    ]),
];

export function findCommand(name: string): Command | undefined {
    return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}

function aliasLines(): string[] {
    const pairs = COMMANDS.filter((c) => c.aliases).map(
        (c) => `${c.aliases!.join('/')}→${c.name}`,
    );
    const lines: string[] = [];
    for (let i = 0; i < pairs.length; i += 6) {
        lines.push(`  ${pairs.slice(i, i + 6).join('  ')}`);
    }
    return lines;
}

export function rootHelp(): string {
    const commands = COMMANDS.map(
        (c) => `  ${c.synopsis.padEnd(22)}${c.summary}`,
    ).join('\n');
    return `
glw — GitLab Work Items CLI

Usage: glw <command> [options]

Commands:
${commands}

Aliases:
${aliasLines().join('\n')}

Global flags:
  --project <ref>     Override project: full path (group/project) or a short
                      unique name resolved against your memberships
  --json              Machine-readable JSON output (where supported)
  --help, -h          Show help

Run "glw <command> --help" for command-specific help.
`.trim();
}
