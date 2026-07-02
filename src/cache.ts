import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { globalDir } from "./config.ts";

// Cache lives in the global glw dir (%APPDATA%/glw, ~/.config/glw on POSIX).
// ~/.glw is the legacy location, still read as a fallback.
const PROJECTS_CACHE = join(globalDir(), "projects.json");
const LEGACY_CACHE = join(homedir(), ".glw", "projects.json");

interface ProjectsCache {
  updatedAt: string;
  fullPaths: string[];
}

function readCacheFile(path: string): string[] {
  try {
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ProjectsCache;
    return parsed.fullPaths ?? [];
  } catch {
    return [];
  }
}

export function readProjectsCache(): string[] {
  const current = readCacheFile(PROJECTS_CACHE);
  if (current.length > 0) return current;
  return readCacheFile(LEGACY_CACHE);
}

export function writeProjectsCache(fullPaths: string[]): void {
  try {
    mkdirSync(globalDir(), { recursive: true });
    const data: ProjectsCache = {
      updatedAt: new Date().toISOString(),
      fullPaths: Array.from(new Set(fullPaths)).sort(),
    };
    writeFileSync(PROJECTS_CACHE, JSON.stringify(data, null, 2) + "\n");
  } catch {
    // best-effort — silently ignore write failures
  }
}
