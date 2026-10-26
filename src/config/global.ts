import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_FILE = 'glw.config.json';
const SETTINGS_FILE = 'settings.json';

/** `%APPDATA%/glw` на Windows, `~/.config/glw` на POSIX; env подменяется в тестах. */
export function globalDir(
    env: Record<string, string | undefined> = process.env,
): string {
    const appData = env['APPDATA'];
    return appData ? join(appData, 'glw') : join(homedir(), '.config', 'glw');
}

interface GlobalSettings {
    globalMode?: boolean;
}

function readSettings(): GlobalSettings {
    try {
        const path = join(globalDir(), SETTINGS_FILE);
        if (!existsSync(path)) return {};
        return JSON.parse(readFileSync(path, 'utf-8')) as GlobalSettings;
    } catch {
        return {};
    }
}

export function isGlobalMode(): boolean {
    return readSettings().globalMode === true;
}

export function setGlobalMode(on: boolean): void {
    const dir = globalDir();
    mkdirSync(dir, { recursive: true });
    const settings: GlobalSettings = { ...readSettings(), globalMode: on };
    writeFileSync(
        join(dir, SETTINGS_FILE),
        JSON.stringify(settings, null, 2) + '\n',
    );
}

/** Куда писать `init`/`config`: флаг важнее, без флага — по глобальному режиму. */
export function targetDir(flags: {
    global?: boolean;
    local?: boolean;
}): string {
    const useGlobal = flags.global || (!flags.local && isGlobalMode());
    return useGlobal ? globalDir() : process.cwd();
}

/** Копирует локальные конфиг и `.env` в пустую глобальную папку; возвращает имена. */
export function migrateLocalToGlobal(): string[] {
    const dir = globalDir();
    mkdirSync(dir, { recursive: true });
    const copied: string[] = [];
    for (const name of [CONFIG_FILE, '.env']) {
        const src = join(process.cwd(), name);
        const dst = join(dir, name);
        if (existsSync(src) && !existsSync(dst)) {
            copyFileSync(src, dst);
            copied.push(name);
        }
    }
    return copied;
}
