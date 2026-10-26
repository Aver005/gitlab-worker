import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN_LINE = /^(export\s+)?GITLAB_TOKEN\s*=/;

/** Пустые строки и `#` пропускаются, `export ` и кавычки вокруг значения снимаются. */
export function parseDotEnv(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const raw of content.split(/\r?\n/)) {
        let line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (line.startsWith('export ')) line = line.slice(7).trimStart();

        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
        if (key) result[key] = value;
    }
    return result;
}

/** Нечитаемый или отсутствующий `.env` — пустой набор, а не ошибка. */
export function loadDotEnvFrom(dir: string): Record<string, string> {
    try {
        const path = join(dir, '.env');
        return existsSync(path) ? parseDotEnv(readFileSync(path, 'utf-8')) : {};
    } catch {
        return {};
    }
}

function readLines(path: string): string[] {
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, 'utf-8').split(/\r?\n/);
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    return lines;
}

/** Ставит или заменяет строку GITLAB_TOKEN, остальные строки не трогает. */
export function writeDotEnvToken(token: string, dir = process.cwd()): void {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, '.env');
    const lines = readLines(path);
    const line = `GITLAB_TOKEN=${token}`;
    const idx = lines.findIndex((l) => TOKEN_LINE.test(l));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
    writeFileSync(path, lines.join('\n') + '\n');
}

export function removeDotEnvToken(dir: string): void {
    const path = join(dir, '.env');
    if (!existsSync(path)) return;
    const lines = readLines(path).filter((l) => !TOKEN_LINE.test(l));
    writeFileSync(path, lines.length > 0 ? lines.join('\n') + '\n' : '');
}
