import { join } from 'node:path';

import { JSON_OUT, parseFlags } from '../cli/args.ts';
import { maskToken, printJson } from '../cli/output.ts';
import { removeDotEnvToken, writeDotEnvToken } from '../config/dotenv.ts';
import { globalDir, targetDir } from '../config/global.ts';
import {
    CONFIG_KEYS,
    inspectConfig,
    setConfigValue,
    type ConfigKey,
} from '../config/load.ts';
import { CliError } from '../errors.ts';
import { dim, green, printTable, red, yellow } from '../format.ts';

import type { Command } from '../cli/command.ts';

function isConfigKey(key: string): key is ConfigKey {
    return (CONFIG_KEYS as readonly string[]).includes(key);
}

function showAll(json: boolean | undefined): void {
    const info = inspectConfig();
    const token = info.token ? maskToken(info.token) : undefined;
    if (json) {
        printJson({ ...info, token });
        return;
    }
    printTable([
        ['url', info.url ?? dim('(not set)')],
        ['project', info.project ?? dim('(not set)')],
        ['tokenEnv', info.tokenEnv],
        ['token', token ? green(token) : red('(not set)')],
        ['global mode', info.globalMode ? green('on') : dim('off')],
        ['global dir', dim(info.globalDir)],
    ]);
}

function showOne(key: ConfigKey): void {
    const info = inspectConfig();
    const value =
        key === 'token' ? info.token && maskToken(info.token) : info[key];
    if (value === undefined) {
        console.log(dim('(not set)'));
        process.exitCode = 1;
    } else {
        console.log(value);
    }
}

export const config: Command = {
    name: 'config',
    aliases: ['cfg'],
    synopsis: 'config [key] [value]',
    summary: 'Show or set configuration (url, project, tokenEnv, token)',
    help: () => `
glw config [key] [value] [--unset] [--global | --local]

Show or set configuration. Keys: url, project, tokenEnv, token.

  glw config                       show effective configuration (token masked)
  glw config url                   print one value
  glw config url https://gitlab.example.com
  glw config token glpat-xxx       token goes to .env, never to the json file
  glw config project --unset       remove a key

Write target follows global mode (like "glw init"):
  global mode ON  → ${globalDir()}
  global mode OFF → current directory
  --global / --local force one or the other.
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            global: { type: 'boolean', short: 'g' },
            local: { type: 'boolean' },
            unset: { type: 'boolean' },
            ...JSON_OUT,
        });
        const [key, value] = positionals;

        if (key === undefined) {
            showAll(values.json);
            return;
        }
        if (!isConfigKey(key)) {
            throw new CliError(
                `Unknown config key "${key}". Valid keys: ${CONFIG_KEYS.join(', ')}`,
            );
        }
        if (value === undefined && !values.unset) {
            showOne(key);
            return;
        }

        const newValue = values.unset ? undefined : value;
        const dir = targetDir(values);
        if (key === 'token') {
            const envPath = join(dir, '.env');
            if (newValue === undefined) {
                removeDotEnvToken(dir);
                console.log(
                    `${yellow('Token removed')} ${dim(`from ${envPath}`)}`,
                );
            } else {
                writeDotEnvToken(newValue, dir);
                console.log(
                    `${green('Token set')} ${dim(`in ${envPath}:`)} ${maskToken(newValue)}`,
                );
            }
            return;
        }

        const written = setConfigValue(key, newValue, dir);
        console.log(
            newValue === undefined
                ? `${yellow(`${key} removed`)} ${dim(`(${written})`)}`
                : `${green(`${key} = ${newValue}`)} ${dim(`(${written})`)}`,
        );
    },
};
