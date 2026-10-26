/** Кеш путей проектов для автодополнения; ошибки записи молча глотаются. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { globalDir } from './config/global.ts';

const PROJECTS_CACHE = join(globalDir(), 'projects.json');
// Прежнее место кеша; читается, пока новый пуст.
const LEGACY_CACHE = join(homedir(), '.glw', 'projects.json');

interface ProjectsCache {
    updatedAt: string;
    fullPaths: string[];
}

function readCacheFile(path: string): string[] {
    try {
        if (!existsSync(path)) return [];
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as ProjectsCache;
        return parsed.fullPaths ?? [];
    } catch {
        return [];
    }
}

export function readProjectsCache(): string[] {
    const current = readCacheFile(PROJECTS_CACHE);
    return current.length > 0 ? current : readCacheFile(LEGACY_CACHE);
}

export function writeProjectsCache(fullPaths: string[]): void {
    try {
        mkdirSync(globalDir(), { recursive: true });
        const data: ProjectsCache = {
            updatedAt: new Date().toISOString(),
            fullPaths: [...new Set(fullPaths)].toSorted(),
        };
        writeFileSync(PROJECTS_CACHE, JSON.stringify(data, null, 2) + '\n');
    } catch {
        // Кеш нужен только автодополнению; без него всё работает.
    }
}
