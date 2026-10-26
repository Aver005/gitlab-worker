// Слои конфига: process.env > локальные .env и glw.config.json > глобальные
// (только в глобальном режиме).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDotEnvFrom } from './dotenv.ts';
import { CONFIG_FILE, globalDir, isGlobalMode } from './global.ts';

export interface Config {
    url: string;
    token: string;
    project: string;
}

interface ConfigFile {
    url?: string;
    project?: string;
    tokenEnv?: string;
    token?: string;
}

export const CONFIG_KEYS = ['url', 'project', 'tokenEnv', 'token'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

function readConfigFile(dir: string): ConfigFile {
    const path = join(dir, CONFIG_FILE);
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as ConfigFile;
    } catch (err) {
        throw new Error(`Failed to parse ${path}. Ensure it is valid JSON.`, {
            cause: err,
        });
    }
}

function writeConfigFile(dir: string, config: ConfigFile): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, CONFIG_FILE);
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    return path;
}

export interface ConfigInspection {
    url?: string;
    project?: string;
    tokenEnv: string;
    /** Настоящее значение: перед выводом маскирует вызывающий. */
    token?: string;
    globalMode: boolean;
    globalDir: string;
}

/** Итоговые значения по всем слоям; не бросает, даже если чего-то нет. */
export function inspectConfig(): ConfigInspection {
    const cwd = process.cwd();
    const globalOn = isGlobalMode();
    const gdir = globalDir();

    const localFile = readConfigFile(cwd);
    const globalFile = globalOn ? readConfigFile(gdir) : {};
    const localEnv = loadDotEnvFrom(cwd);
    const globalEnv = globalOn ? loadDotEnvFrom(gdir) : {};

    const env = (key: string) =>
        process.env[key] ?? localEnv[key] ?? globalEnv[key];
    const file = <K extends keyof ConfigFile>(key: K) =>
        localFile[key] ?? globalFile[key];

    const tokenEnv = file('tokenEnv')?.trim() || 'GITLAB_TOKEN';
    return {
        url: env('GITLAB_URL') ?? file('url'),
        project: env('GITLAB_PROJECT') ?? file('project'),
        tokenEnv,
        token: env('GITLAB_TOKEN') ?? env(tokenEnv) ?? file('token'),
        globalMode: globalOn,
        globalDir: gdir,
    };
}

/** Без `requireProject` пустой проект допустим: команде он не нужен. */
export function loadConfig(
    projectOverride?: string,
    requireProject = true,
): Config {
    const info = inspectConfig();
    const globalHint = info.globalMode
        ? `Global mode is ON — files are also read from ${info.globalDir}.`
        : `Tip: "glw global on" enables a shared config in ${info.globalDir}.`;

    const url = info.url?.replace(/\/+$/, '');
    if (!url) {
        throw new Error(
            'GitLab URL not configured.\n' +
                `Set GITLAB_URL env var (or in .env) or add "url" to ${CONFIG_FILE}.\n` +
                `${globalHint}\n` +
                'Run: glw init',
        );
    }

    if (!info.token) {
        throw new Error(
            'GitLab access token not configured.\n' +
                `Set the ${info.tokenEnv} env var (or in .env), or add "token" to ${CONFIG_FILE}.\n` +
                `${globalHint}\n` +
                `Create a Personal Access Token at: ${url}/-/user_settings/personal_access_tokens\n` +
                'Required scope: api',
        );
    }

    const project = projectOverride ?? info.project ?? '';
    if (!project && requireProject) {
        throw new Error(
            'GitLab project not configured.\n' +
                `Set GITLAB_PROJECT env var, add "project" to ${CONFIG_FILE}, use --project flag,\n` +
                'or pick one: glw projects, then glw use <name>',
        );
    }

    return { url, token: info.token, project };
}

/** Локальный конфиг важнее; без него в глобальном режиме пишется глобальный. */
export function saveConfigProject(fullPath: string): string {
    const hasLocal = existsSync(join(process.cwd(), CONFIG_FILE));
    const dir = !hasLocal && isGlobalMode() ? globalDir() : process.cwd();

    const config = readConfigFile(dir);
    if (!existsSync(join(dir, CONFIG_FILE))) {
        if (process.env['GITLAB_URL']) config.url = process.env['GITLAB_URL'];
        config.tokenEnv = 'GITLAB_TOKEN';
    }
    config.project = fullPath;
    return writeConfigFile(dir, config);
}

/** Существующий конфиг не трогает: `init` с токеном должен работать и повторно. */
export function writeConfigTemplate(dir: string): boolean {
    if (existsSync(join(dir, CONFIG_FILE))) return false;
    writeConfigFile(dir, {
        url: 'https://gitlab.example.com',
        project: '',
        tokenEnv: 'GITLAB_TOKEN',
    });
    return true;
}

/** `value === undefined` удаляет ключ; возвращает путь записанного файла. */
export function setConfigValue(
    key: Exclude<ConfigKey, 'token'>,
    value: string | undefined,
    dir: string,
): string {
    const config = readConfigFile(dir);
    if (value === undefined) delete config[key];
    else config[key] = value;
    return writeConfigFile(dir, config);
}
