import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = join(homedir(), ".glw");
const PROJECTS_CACHE = join(CACHE_DIR, "projects.json");

interface ProjectsCache {
  updatedAt: string;
  fullPaths: string[];
}

export function readProjectsCache(): string[] {
  try {
    if (!existsSync(PROJECTS_CACHE)) return [];
    const raw = readFileSync(PROJECTS_CACHE, "utf-8");
    const parsed = JSON.parse(raw) as ProjectsCache;
    return parsed.fullPaths ?? [];
  } catch {
    return [];
  }
}

export function writeProjectsCache(fullPaths: string[]): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const data: ProjectsCache = {
      updatedAt: new Date().toISOString(),
      fullPaths: Array.from(new Set(fullPaths)).sort(),
    };
    writeFileSync(PROJECTS_CACHE, JSON.stringify(data, null, 2) + "\n");
  } catch {
    // best-effort — silently ignore write failures
  }
}
