#!/usr/bin/env bun
import { readProjectsCache } from './cache.ts';
import { findCommand, rootHelp } from './commands/registry.ts';
import { errorText } from './errors.ts';
import { red } from './format.ts';

const HELP_FLAGS = new Set(['--help', '-h']);

async function main(argv: string[]): Promise<void> {
    const [name, ...args] = argv;
    if (name === undefined || HELP_FLAGS.has(name)) {
        console.log(rootHelp());
        return;
    }
    // Скрытая команда для скриптов автодополнения.
    if (name === '__complete') {
        if (args[0] === 'projects') {
            const cached = readProjectsCache();
            if (cached.length > 0) console.log(cached.join('\n'));
        }
        return;
    }

    const command = findCommand(name);
    if (!command) {
        console.error(red(`Unknown command: "${name}"`));
        console.log(rootHelp());
        process.exitCode = 1;
        return;
    }
    // Справка до разбора флагов и загрузки конфига: работает без настроенного окружения.
    const end = args.indexOf('--');
    const flags = end === -1 ? args : args.slice(0, end);
    if (flags.some((a) => HELP_FLAGS.has(a))) {
        console.log(command.help());
        return;
    }
    await command.run(args);
}

try {
    await main(process.argv.slice(2));
} catch (err) {
    console.error(red(`Error: ${errorText(err)}`));
    process.exitCode = 1;
}
