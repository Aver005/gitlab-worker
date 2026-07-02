import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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

const CONFIG_FILE = "glw.config.json";
const SETTINGS_FILE = "settings.json";

// ─── Global environment (%APPDATA%/glw, ~/.config/glw on POSIX) ──────────────

/** Directory of the machine-global glw environment. Env injectable for tests. */
export function globalDir(
  env: Record<string, string | undefined> = process.env
): string {
  const appData = env["APPDATA"];
  return appData ? join(appData, "glw") : join(homedir(), ".config", "glw");
}

interface GlobalSettings {
  globalMode?: boolean;
}

function readGlobalSettings(): GlobalSettings {
  try {
    const p = join(globalDir(), SETTINGS_FILE);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8")) as GlobalSettings;
  } catch {
    return {};
  }
}

/** Toggle global mode; returns the settings file path. */
export function setGlobalMode(on: boolean): string {
  const dir = globalDir();
  mkdirSync(dir, { recursive: true });
  const p = join(dir, SETTINGS_FILE);
  const settings: GlobalSettings = { ...readGlobalSettings(), globalMode: on };
  writeFileSync(p, JSON.stringify(settings, null, 2) + "\n");
  return p;
}

export function isGlobalMode(): boolean {
  return readGlobalSettings().globalMode === true;
}

// ─── Config layers ────────────────────────────────────────────────────────────

/**
 * Parse a .env file content into a key→value map.
 * Rules:
 *   - Blank lines and lines starting with # are ignored.
 *   - Optional "export " prefix is stripped.
 *   - Values may be surrounded by single or double quotes (stripped).
 * Pure function — exported for unit tests.
 */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trimStart();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) result[key] = val;
  }
  return result;
}

/** Load .env from a directory. Silently returns {} on failure. */
function loadDotEnvFrom(dir: string): Record<string, string> {
  try {
    const p = join(dir, ".env");
    if (!existsSync(p)) return {};
    return parseDotEnv(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

/** Read glw.config.json from a directory. Throws on invalid JSON. */
function readConfigFileFrom(dir: string): ConfigFile {
  const p = join(dir, CONFIG_FILE);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as ConfigFile;
  } catch {
    throw new Error(`Failed to parse ${p}. Ensure it is valid JSON.`);
  }
}

interface ConfigLayers {
  env: (key: string) => string | undefined;
  file: <K extends keyof ConfigFile>(key: K) => ConfigFile[K];
  globalOn: boolean;
  gdir: string;
}

/** Resolve all config layers. Priority: process.env > local .env > global .env;
 *  local glw.config.json > global glw.config.json. Global layers only when
 *  global mode is on. */
function resolveLayers(): ConfigLayers {
  const cwd = process.cwd();
  const globalOn = isGlobalMode();
  const gdir = globalDir();

  const localFile = readConfigFileFrom(cwd);
  const globalFile = globalOn ? readConfigFileFrom(gdir) : {};
  const localEnv = loadDotEnvFrom(cwd);
  const globalEnv = globalOn ? loadDotEnvFrom(gdir) : {};

  return {
    env: (key) => process.env[key] ?? localEnv[key] ?? globalEnv[key],
    file: (key) => localFile[key] ?? globalFile[key],
    globalOn,
    gdir,
  };
}

export function loadConfig(
  projectOverride?: string,
  requireProject = true
): Config {
  const { env, file, globalOn, gdir } = resolveLayers();

  const globalHint = globalOn
    ? `Global mode is ON — files are also read from ${gdir}.`
    : `Tip: "glw global on" enables a shared config in ${gdir}.`;

  const url = env("GITLAB_URL") ?? file("url");
  if (!url) {
    throw new Error(
      `GitLab URL not configured.\n` +
        `Set GITLAB_URL env var (or in .env) or add "url" to ${CONFIG_FILE}.\n` +
        `${globalHint}\n` +
        `Run: glw init`
    );
  }

  const tokenEnvName = file("tokenEnv")?.trim() || "GITLAB_TOKEN";

  const token = env("GITLAB_TOKEN") ?? env(tokenEnvName) ?? file("token");

  if (!token) {
    throw new Error(
      `GitLab access token not configured.\n` +
        `Set the ${tokenEnvName} env var (or in .env), or add "token" to ${CONFIG_FILE}.\n` +
        `${globalHint}\n` +
        `Create a Personal Access Token at: ${url}/-/user_settings/personal_access_tokens\n` +
        `Required scope: api`
    );
  }

  const project = projectOverride ?? env("GITLAB_PROJECT") ?? file("project");

  if (!project) {
    if (!requireProject) {
      return { url: url.replace(/\/+$/, ""), token, project: "" };
    }
    throw new Error(
      `GitLab project not configured.\n` +
        `Set GITLAB_PROJECT env var, add "project" to ${CONFIG_FILE}, use --project flag,\n` +
        `or pick one: glw projects, then glw use <name>`
    );
  }

  return {
    url: url.replace(/\/+$/, ""),
    token,
    project,
  };
}

/**
 * Persist the default project into glw.config.json (merging with existing
 * fields; creates the file if absent). Local config wins if present in cwd;
 * otherwise, when global mode is on, writes to the global config.
 * Returns the config file path written.
 */
export function saveConfigProject(fullPath: string): string {
  const localPath = join(process.cwd(), CONFIG_FILE);
  const useGlobal = !existsSync(localPath) && isGlobalMode();
  const dir = useGlobal ? globalDir() : process.cwd();
  const configPath = join(dir, CONFIG_FILE);

  let fileConfig: ConfigFile = readConfigFileFrom(dir);
  if (!existsSync(configPath)) {
    if (process.env["GITLAB_URL"]) fileConfig.url = process.env["GITLAB_URL"];
    fileConfig.tokenEnv = "GITLAB_TOKEN";
  }

  fileConfig.project = fullPath;
  if (useGlobal) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(fileConfig, null, 2) + "\n");
  return configPath;
}

/** Create a glw.config.json template in `dir` (cwd by default) if absent. */
export function writeConfigTemplate(dir = process.cwd()): void {
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, CONFIG_FILE);

  if (existsSync(configPath)) {
    // No longer throws — init with a token arg should still work
    return;
  }

  const template: ConfigFile = {
    url: "https://gitlab.example.com",
    project: "",
    tokenEnv: "GITLAB_TOKEN",
  };

  writeFileSync(configPath, JSON.stringify(template, null, 2) + "\n");
}

/**
 * Write or update GITLAB_TOKEN= in .env in `dir` (cwd by default).
 * Preserves all other lines; creates the file if absent.
 */
export function writeDotEnvToken(token: string, dir = process.cwd()): void {
  mkdirSync(dir, { recursive: true });
  const envPath = join(dir, ".env");
  let lines: string[] = [];
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
    // Remove trailing empty line that split may produce
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  }
  const idx = lines.findIndex((l) => /^(export\s+)?GITLAB_TOKEN\s*=/.test(l));
  const newLine = `GITLAB_TOKEN=${token}`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    lines.push(newLine);
  }
  writeFileSync(envPath, lines.join("\n") + "\n");
}

// ─── glw config command support ───────────────────────────────────────────────

export const CONFIG_KEYS = ["url", "project", "tokenEnv", "token"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export interface ConfigInspection {
  url?: string;
  project?: string;
  tokenEnv: string;
  /** Effective token value (caller must mask before display). */
  token?: string;
  globalMode: boolean;
  globalDir: string;
}

/** Non-throwing view of the effective configuration across all layers. */
export function inspectConfig(): ConfigInspection {
  const { env, file, globalOn, gdir } = resolveLayers();
  const tokenEnvName = file("tokenEnv")?.trim() || "GITLAB_TOKEN";
  return {
    url: env("GITLAB_URL") ?? file("url"),
    project: env("GITLAB_PROJECT") ?? file("project"),
    tokenEnv: tokenEnvName,
    token: env("GITLAB_TOKEN") ?? env(tokenEnvName) ?? file("token"),
    globalMode: globalOn,
    globalDir: gdir,
  };
}

/** Set or unset (value === undefined) a glw.config.json field in `dir`.
 *  Returns the config file path written. */
export function setConfigValue(
  key: Exclude<ConfigKey, "token">,
  value: string | undefined,
  dir: string
): string {
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, CONFIG_FILE);
  const fileConfig = readConfigFileFrom(dir);
  if (value === undefined) {
    delete fileConfig[key];
  } else {
    fileConfig[key] = value;
  }
  writeFileSync(configPath, JSON.stringify(fileConfig, null, 2) + "\n");
  return configPath;
}

/** Remove the GITLAB_TOKEN line from .env in `dir` (other lines preserved). */
export function removeDotEnvToken(dir: string): void {
  const envPath = join(dir, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8")
    .split(/\r?\n/)
    .filter((l) => !/^(export\s+)?GITLAB_TOKEN\s*=/.test(l));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  writeFileSync(envPath, lines.length > 0 ? lines.join("\n") + "\n" : "");
}

/** Copy local (cwd) glw.config.json and .env into the global dir if the
 *  global dir doesn't have them yet. Returns the list of copied file names. */
export function migrateLocalToGlobal(): string[] {
  const cwd = process.cwd();
  const gdir = globalDir();
  mkdirSync(gdir, { recursive: true });
  const copied: string[] = [];

  for (const name of [CONFIG_FILE, ".env"]) {
    const src = join(cwd, name);
    const dst = join(gdir, name);
    if (existsSync(src) && !existsSync(dst)) {
      writeFileSync(dst, readFileSync(src));
      copied.push(name);
    }
  }
  return copied;
}
