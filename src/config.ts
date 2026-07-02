import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/** Load .env from cwd and return parsed values. Silently returns {} on failure. */
function loadDotEnv(): Record<string, string> {
  try {
    const p = join(process.cwd(), ".env");
    if (!existsSync(p)) return {};
    return parseDotEnv(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

export function loadConfig(
  projectOverride?: string,
  requireProject = true
): Config {
  const cwd = process.cwd();
  const configPath = join(cwd, CONFIG_FILE);

  let fileConfig: ConfigFile = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8")) as ConfigFile;
    } catch {
      throw new Error(
        `Failed to parse ${CONFIG_FILE}. Ensure it is valid JSON.`
      );
    }
  }

  // .env fallback: real process.env wins, .env wins over glw.config.json
  const dotenv = loadDotEnv();
  const env = (key: string): string | undefined =>
    process.env[key] ?? dotenv[key];

  const url = env("GITLAB_URL") ?? fileConfig.url;
  if (!url) {
    throw new Error(
      `GitLab URL not configured.\n` +
        `Set GITLAB_URL env var (or in .env) or add "url" to ${CONFIG_FILE}.\n` +
        `Run: glw init`
    );
  }

  const tokenEnvName =
    fileConfig.tokenEnv && fileConfig.tokenEnv.trim()
      ? fileConfig.tokenEnv.trim()
      : "GITLAB_TOKEN";

  const token =
    env("GITLAB_TOKEN") ??
    (env(tokenEnvName) ?? fileConfig.token);

  if (!token) {
    throw new Error(
      `GitLab access token not configured.\n` +
        `Set the ${tokenEnvName} env var (or in .env), or add "token" to ${CONFIG_FILE}.\n` +
        `Create a Personal Access Token at: ${url}/-/user_settings/personal_access_tokens\n` +
        `Required scope: api`
    );
  }

  const project =
    projectOverride ??
    env("GITLAB_PROJECT") ??
    fileConfig.project;

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
 * fields; creates the file if absent). Returns the config file path.
 */
export function saveConfigProject(fullPath: string): string {
  const configPath = join(process.cwd(), CONFIG_FILE);

  let fileConfig: ConfigFile = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8")) as ConfigFile;
    } catch {
      throw new Error(
        `Failed to parse ${CONFIG_FILE}. Ensure it is valid JSON.`
      );
    }
  } else {
    if (process.env["GITLAB_URL"]) fileConfig.url = process.env["GITLAB_URL"];
    fileConfig.tokenEnv = "GITLAB_TOKEN";
  }

  fileConfig.project = fullPath;
  writeFileSync(configPath, JSON.stringify(fileConfig, null, 2) + "\n");
  return configPath;
}

export function writeConfigTemplate(): void {
  const cwd = process.cwd();
  const configPath = join(cwd, CONFIG_FILE);

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
 * Write or update GITLAB_TOKEN= in .env in cwd.
 * Preserves all other lines; creates the file if absent.
 */
export function writeDotEnvToken(token: string): void {
  const envPath = join(process.cwd(), ".env");
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
