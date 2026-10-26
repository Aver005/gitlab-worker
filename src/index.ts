#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  loadConfig,
  writeConfigTemplate,
  saveConfigProject,
  writeDotEnvToken,
  globalDir,
  isGlobalMode,
  setGlobalMode,
  migrateLocalToGlobal,
  inspectConfig,
  setConfigValue,
  removeDotEnvToken,
  CONFIG_KEYS,
  type ConfigKey,
} from "./config.ts";
import type { Config } from "./config.ts";
import {
  getCurrentUser,
  listProjects,
  resolveProjectPath,
  resolveUser,
  resolveLabels,
  listLabels,
  findScopedLabelConflicts,
  resolveWorkItemType,
  resolveStatus,
  getWorkItemByIid,
  listWorkItems,
  listMyWorkItems,
  listTodos,
  markTodoDone,
  markAllTodosDone,
  flattenTodo,
  toTodoGid,
  resolveProject,
  createWorkItem,
  updateWorkItem,
  createNote,
  addLinkedItems,
  removeLinkedItems,
  parseLinkType,
  normalizeIid,
  validateDuration,
  buildTimeTrackingWidget,
  isIsoDate,
  getAssignees,
  getLabels,
  getStatus,
  getWeight,
  getDates,
  getTimeTracking,
  getHierarchy,
  getLinkedInfo,
  getDescription,
  matchesSearch,
  type LinkType,
  type SearchCriteria,
  type WorkItemUpdateInput,
  type WorkItemCreateInput,
  type WorkItemNode,
  type TimeTrackingWidgetInput,
} from "./api.ts";
import { parseIssueFile, applyOverrides, expandIssueFiles, type IssueFileData } from "./inputfile.ts";
import {
  formatIssueLine,
  isOpenState,
  printTable,
  secondsToHuman,
  bold,
  green,
  red,
  cyan,
  dim,
  yellow,
  chunk,
} from "./format.ts";
import { readProjectsCache, writeProjectsCache } from "./cache.ts";
import { FIELD_NAMES, parseFields, flattenItem, fieldText, formatFieldTable } from "./fields.ts";

// ─── Global help ─────────────────────────────────────────────────────────────

const HELP = `
glw — GitLab Work Items CLI

Usage: glw <command> [options]

Commands:
  init                  Create a glw.config.json template (or set token in .env)
  config [key] [value]  Show or set configuration (url, project, tokenEnv, token)
  global <on|off>       Toggle the shared global environment (%APPDATA%/glw)
  whoami                Show the authenticated user
  projects              List projects you are a member of
  use <project>         Set the default project (saved to glw.config.json)
  labels                List the project's labels (incl. group labels)
  search                Search work items with filters
  create <file|dir>...  Create work items from files
  list                  List work items
  mine                  Work items assigned to me in all projects
  todos [done <id...>]  My GitLab To-Do List; mark items done
  view <iid>            Show a work item
  update [iid...] ...   Update one or more work items
  comment <iid> [text]  Add a comment to a work item
  close [iid...]        Close one or more work items
  reopen <iid...>       Reopen work items
  link <iid> <tgt...>   Link work items (related/blocks/blocked-by)
  parent <iid...> --to  Set or clear the parent (hierarchy)
  estimate <iid> <dur>  Set time estimate (e.g. 2h, 1h30m)
  spend <iid> <dur>     Log time spent
  completion <shell>    Print shell completion script (bash|zsh|powershell)

Aliases:
  i→init  cfg→config  s→search  p→projects  l/ls→list  v→view
  cr→create  u→update  co→comment  ln→link

Global flags:
  --project <ref>     Override project: full path (group/project) or a short
                      unique name resolved against your memberships
  --json              Machine-readable JSON output (where supported)
  --help, -h          Show help

Run "glw <command> --help" for command-specific help.
`.trim();

// ─── Alias map ────────────────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  i: "init",
  cfg: "config",
  s: "search",
  p: "projects",
  co: "comment",
  cr: "create",
  u: "update",
  v: "view",
  l: "list",
  ls: "list",
  ln: "link",
};

// ─── Error handling ───────────────────────────────────────────────────────────

function die(msg: string): never {
  console.error(red(`Error: ${msg}`));
  process.exit(1);
}

function handleError(err: unknown): never {
  if (err instanceof Error) {
    die(err.message);
  }
  die(String(err));
}

// ─── Argument parsing helpers ─────────────────────────────────────────────────

function getFlag(
  values: Record<string, string | boolean | string[] | undefined>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = values[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function getBoolFlag(
  values: Record<string, string | boolean | string[] | undefined>,
  ...keys: string[]
): boolean {
  for (const k of keys) {
    if (values[k] === true) return true;
  }
  return false;
}

function getMultiFlag(
  values: Record<string, string | boolean | string[] | undefined>,
  key: string
): string[] {
  const v = values[key];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return [];
}

const FIELDS_HELP = `Fields (--fields): ${FIELD_NAMES.join(", ")}
  JSON keeps estimate/spent in seconds and labels/assignees as arrays.`;

function parseFieldsFlag(
  values: Record<string, string | boolean | string[] | undefined>
): string[] | undefined {
  const raw = getFlag(values, "fields");
  return raw === undefined ? undefined : parseFields(raw);
}

function printFields(items: WorkItemNode[], fields: string[], json: boolean): void {
  const rows = items.map((i) => flattenItem(i, fields));
  if (json) {
    console.log(JSON.stringify(rows));
    return;
  }
  if (rows.length === 0) {
    console.log(dim("No work items found."));
    return;
  }
  const [header, ...lines] = formatFieldTable(rows, fields);
  console.log(bold(header!));
  for (const line of lines) console.log(line);
}

function warnScopedLabelConflicts(names: string[]): void {
  for (const { scope, labels } of findScopedLabelConflicts(names)) {
    process.stderr.write(
      `glw: warning: labels ${labels.join(", ")} share scope "${scope}" — GitLab keeps only one\n`
    );
  }
}

// ─── Confirm prompt ───────────────────────────────────────────────────────────

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

// ─── Interactive pager ────────────────────────────────────────────────────────

async function interactivePager<T>(
  items: T[],
  perPage: number,
  renderItem: (item: T) => void
): Promise<void> {
  const pages = chunk(items, perPage);
  const total = pages.length;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    for (const item of page) {
      renderItem(item);
    }

    if (i < total - 1) {
      // Prompt for next page
      const rl = createInterface({ input, output });
      try {
        const answer = await rl.question(
          dim(`-- page ${i + 1}/${total} — Enter: next, q: quit -- `)
        );
        if (answer.trim().toLowerCase() === "q") {
          break;
        }
      } finally {
        rl.close();
      }
    }
  }
}

// ─── Config with project override ────────────────────────────────────────────

// A --project value without "/" is a short name — resolve it against the
// user's membership projects before building the final config.
async function resolveConfig(project?: string): Promise<Config> {
  if (project && !project.includes("/")) {
    const conn = loadConfig(undefined, false);
    const fullPath = await resolveProjectPath(conn, project);
    return { ...conn, project: fullPath };
  }
  return loadConfig(project);
}

// ─── Command implementations ──────────────────────────────────────────────────

// init
async function cmdInit(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      global: { type: "boolean", short: "g" },
      local: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw init [token] [--global | --local]

Create a glw.config.json template (left untouched if it already exists).
With a token argument, also write GITLAB_TOKEN=<token> to .env (creates the
file or replaces the existing line).

Target directory:
  - global mode ON (glw global on) → ${globalDir()}
  - global mode OFF               → current directory
  - --global / --local force one or the other explicitly

Examples:
  glw init
  glw init glpat-xxxxxxxxxxxxxxxx
  glw init glpat-xxxxxxxxxxxxxxxx --global
  glw init --local
`);
    return;
  }

  const token = positionals[0];
  // Follow the enabled global mode by default; flags override explicitly
  const useGlobal = values["global"]
    ? true
    : values["local"]
      ? false
      : isGlobalMode();
  const targetDir = useGlobal ? globalDir() : process.cwd();
  const configPath = join(targetDir, "glw.config.json");

  try {
    const alreadyExisted = existsSync(configPath);
    writeConfigTemplate(targetDir);
    console.log(
      alreadyExisted
        ? dim(`${configPath} already exists — left untouched`)
        : green(`Created ${configPath}`)
    );

    if (!token) {
      console.log(`
Next steps:
  1. Edit glw.config.json — set "url" and "project"
  2. Create a GitLab Personal Access Token with the "api" scope:
     https://your-gitlab-instance/-/user_settings/personal_access_tokens
  3. Set your token in .env or environment:
     glw init glpat-xxxxxxxx
  4. Test the connection:
     glw whoami
`);
    }
  } catch (err) {
    handleError(err);
  }

  if (token) {
    try {
      writeDotEnvToken(token, targetDir);
      const masked = token.slice(0, 8) + "...";
      console.log(green(`GITLAB_TOKEN set in ${join(targetDir, ".env")}: ${masked}`));
    } catch (err) {
      handleError(err);
    }
  }
}

// config
function maskToken(token: string): string {
  return token.length > 8 ? token.slice(0, 8) + "..." : "***";
}

async function cmdConfig(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      global: { type: "boolean", short: "g" },
      local: { type: "boolean" },
      unset: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
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
`);
    return;
  }

  const key = positionals[0] as ConfigKey | undefined;
  const value = positionals[1];

  // No key → show effective config
  if (!key) {
    const info = inspectConfig();
    if (values["json"]) {
      console.log(
        JSON.stringify({ ...info, token: info.token ? maskToken(info.token) : undefined })
      );
      return;
    }
    printTable([
      ["url", info.url ?? dim("(not set)")],
      ["project", info.project ?? dim("(not set)")],
      ["tokenEnv", info.tokenEnv],
      ["token", info.token ? green(maskToken(info.token)) : red("(not set)")],
      ["global mode", info.globalMode ? green("on") : dim("off")],
      ["global dir", dim(info.globalDir)],
    ]);
    return;
  }

  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    die(`Unknown config key "${key}". Valid keys: ${CONFIG_KEYS.join(", ")}`);
  }

  // Key without value → print it
  if (value === undefined && !values["unset"]) {
    const info = inspectConfig();
    const current =
      key === "token" ? (info.token ? maskToken(info.token) : undefined) : info[key];
    if (current === undefined) {
      console.log(dim("(not set)"));
      process.exitCode = 1;
    } else {
      console.log(current);
    }
    return;
  }

  // Write target follows global mode; flags override (same rule as init)
  const useGlobal = values["global"] ? true : values["local"] ? false : isGlobalMode();
  const targetDir = useGlobal ? globalDir() : process.cwd();

  if (key === "token") {
    if (values["unset"]) {
      removeDotEnvToken(targetDir);
      console.log(`${yellow("Token removed")} ${dim(`from ${join(targetDir, ".env")}`)}`);
    } else {
      writeDotEnvToken(value!, targetDir);
      console.log(
        `${green("Token set")} ${dim(`in ${join(targetDir, ".env")}:`)} ${maskToken(value!)}`
      );
    }
    return;
  }

  const written = setConfigValue(key, values["unset"] ? undefined : value, targetDir);
  console.log(
    values["unset"]
      ? `${yellow(`${key} removed`)} ${dim(`(${written})`)}`
      : `${green(`${key} = ${value}`)} ${dim(`(${written})`)}`
  );
}

// global
async function cmdGlobal(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  const action = positionals[0];

  if (values["help"] || (action && !["on", "off", "status"].includes(action))) {
    console.log(`
glw global <on|off|status>

Toggle the shared global environment. When ON, glw also reads .env and
glw.config.json from the global dir (local files in cwd still win):
  ${globalDir()}

  on      enable; copies local glw.config.json/.env there if it's empty
  off     disable (cwd-only config, as before)
  status  show current mode and which global files exist (default)

Set it up from scratch with: glw init <token> --global
`);
    return;
  }

  const gdir = globalDir();

  if (action === "on") {
    setGlobalMode(true);
    const copied = migrateLocalToGlobal();
    console.log(`${green("Global mode ON")} ${dim(`(${gdir})`)}`);
    if (copied.length > 0) {
      console.log(dim(`Copied from current directory: ${copied.join(", ")}`));
    }
    return;
  }

  if (action === "off") {
    setGlobalMode(false);
    console.log(`${yellow("Global mode OFF")} ${dim("— config is read from the current directory only")}`);
    return;
  }

  // status
  const on = isGlobalMode();
  console.log(`Global mode: ${on ? green("on") : yellow("off")}`);
  console.log(dim(`Dir: ${gdir}`));
  for (const name of ["glw.config.json", ".env"]) {
    const exists = existsSync(join(gdir, name));
    console.log(dim(`  ${name}: ${exists ? "present" : "absent"}`));
  }
}

// whoami
async function cmdWhoami(
  config: Config,
  jsonOut: boolean
): Promise<void> {
  const user = await getCurrentUser(config);
  if (jsonOut) {
    console.log(JSON.stringify(user));
  } else {
    console.log(`${bold(user.name)} (${cyan("@" + user.username)})`);
  }
}

// projects
async function cmdProjects(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      search: { type: "string" },
      limit: { type: "string" },
      "per-page": { type: "string" },
      sort: { type: "string" },
      paginate: { type: "boolean" },
      "no-paginate": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw projects [--search <q>] [--limit <n>] [--per-page <n>] [--sort az|za] [--paginate|--no-paginate] [--json]

List projects you are a member of (id, full path, name).

Flags:
  --search <q>      Filter by name
  --limit <n>       Max total to fetch (default: 100)
  --per-page <n>    Page size for interactive paging (default: 30)
  --sort az|za      Sort by fullPath: az (default) or za; also accepts asc/desc
  --paginate        Force interactive paging (TTY only)
  --no-paginate     Disable interactive paging
  --json            JSON output (never paginates)
`);
    return;
  }

  // Project not required — this command discovers it
  const config = loadConfig(undefined, false);

  const limitVal = values["limit"] ? parseInt(values["limit"] as string, 10) : 100;
  const perPageVal = values["per-page"] ? parseInt(values["per-page"] as string, 10) : 30;
  const sortRaw = (getFlag(values, "sort") ?? "az").toLowerCase();
  const sortDesc = sortRaw === "za" || sortRaw === "desc";

  const projects = await listProjects(config, {
    search: getFlag(values, "search"),
    limit: limitVal,
  });

  // Update cache after successful fetch
  writeProjectsCache(projects.map((p) => p.fullPath));

  // Sort client-side by fullPath (case-insensitive)
  const sorted = [...projects].sort((a, b) => {
    const cmp = a.fullPath.toLowerCase().localeCompare(b.fullPath.toLowerCase());
    return sortDesc ? -cmp : cmp;
  });

  if (values["json"]) {
    console.log(JSON.stringify(sorted));
    return;
  }

  if (sorted.length === 0) {
    console.log(dim("No projects found."));
    return;
  }

  const renderProject = (p: typeof sorted[number]) => {
    const marker = p.fullPath === config.project ? green(" *") : "";
    console.log(`${cyan(p.fullPath)} ${dim(`— ${p.name}`)}${marker}`);
  };

  // Determine paging mode
  const forcePaginate = getBoolFlag(values, "paginate");
  const noPaginate = getBoolFlag(values, "no-paginate");
  const isTTY = process.stdout.isTTY ?? false;
  const shouldPaginate =
    !noPaginate &&
    (forcePaginate || (isTTY && sorted.length > perPageVal));

  if (shouldPaginate) {
    await interactivePager(sorted, perPageVal, renderProject);
  } else {
    for (const p of sorted) {
      renderProject(p);
    }
  }
}

// use
async function cmdUse(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw use <project>

Set the default project, saved to glw.config.json.
<project> is a full path (group/project) or a unique short name.

Examples:
  glw use backend-api
  glw use acme/internal/backend-api
`);
    return;
  }

  const ref = positionals[0];
  if (!ref) die("Usage: glw use <project>");

  const config = loadConfig(undefined, false);
  const fullPath = await resolveProjectPath(config, ref);
  saveConfigProject(fullPath);
  // Merge into the completion cache (never overwrite the full list with a subset)
  writeProjectsCache([...readProjectsCache(), fullPath]);
  console.log(
    `${green("Default project set:")} ${cyan(fullPath)} ${dim("(saved to glw.config.json)")}`
  );
}

// labels
async function cmdLabels(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      search: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw labels [--search <q>] [--limit <n>] [--json] [--project <ref>]

List labels available in the project, including ones inherited from groups.
Sorted by title, so scoped labels (scope::value) are grouped together.

Flags:
  --search <q>      Title or description contains <q> (e.g. "component::")
  --limit <n>       Max labels to fetch (default: 500)
  --project <ref>   Override project
  --json            JSON output: [{ id, title, description, color }]
`);
    return;
  }

  const config = await resolveConfig(getFlag(values, "project"));
  const labels = await listLabels(config, {
    search: getFlag(values, "search"),
    limit: values["limit"] ? parseInt(values["limit"] as string, 10) : undefined,
  });
  labels.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));

  if (values["json"]) {
    console.log(JSON.stringify(labels));
    return;
  }

  if (labels.length === 0) {
    console.log(dim("No labels found."));
    return;
  }

  const width = Math.max(...labels.map((l) => l.title.length));
  for (const l of labels) {
    const desc = l.description?.trim().split("\n")[0];
    console.log(desc ? `${cyan(l.title.padEnd(width))}  ${dim(desc)}` : cyan(l.title));
  }
}

// search
async function cmdSearch(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      name: { type: "string" },
      body: { type: "string" },
      start_time: { type: "string" },
      start: { type: "string" }, // alias for start_time
      state: { type: "string" },
      limit: { type: "string" },
      fields: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw search [text] [--name <q>] [--body <q>] [--start_time <YYYY-MM-DD>] [--state opened|closed|all] [--limit <n>] [--fields <csv>] [--json] [--project <ref>]

Search work items. At least one filter is required.

Arguments:
  text               Search title AND description (server + client filter)

Flags:
  --name <q>         Title contains (case-insensitive)
  --body <q>         Description contains (case-insensitive)
  --start_time <d>   Start date >= YYYY-MM-DD (alias: --start)
  --state <s>        opened | closed | all (default: opened)
  --limit <n>        Max items to fetch (default: 200)
  --fields <csv>     Flat output of chosen fields (see "Fields" below)
  --project <ref>    Override project
  --json             JSON output

${FIELDS_HELP}

Examples:
  glw search "authentication"
  glw search --name "auth" --body "JWT"
  glw s --start_time 2026-01-01 --state all
  glw search "auth" --fields iid,title,status,labels --json
`);
    return;
  }

  const fields = parseFieldsFlag(values);

  const text = positionals[0];
  const name = getFlag(values, "name");
  const body = getFlag(values, "body");
  const startTime = getFlag(values, "start_time", "start");

  if (!text && !name && !body && !startTime) {
    die(
      "At least one filter is required: positional text, --name, --body, or --start_time\nRun: glw search --help"
    );
  }

  const config = await resolveConfig(getFlag(values, "project"));
  const stateRaw = (getFlag(values, "state") ?? "opened") as "opened" | "closed" | "all";
  const limitVal = values["limit"] ? parseInt(values["limit"] as string, 10) : 200;

  // Fetch with description included; use server-side text search when provided
  const items = await listWorkItems(config, {
    state: stateRaw,
    search: text, // server-side search (may return broader results)
    limit: limitVal,
    includeDescription: true,
  });

  // Client-side filter
  const criteria: SearchCriteria = { text, name, body, startTime };

  const filtered = items.filter((item) => {
    const dates = getDates(item);
    return matchesSearch(
      {
        title: item.title,
        description: getDescription(item),
        startDate: dates.startDate,
      },
      criteria
    );
  });

  if (fields) {
    printFields(filtered, fields, getBoolFlag(values, "json"));
    return;
  }

  if (values["json"]) {
    console.log(JSON.stringify(filtered));
    return;
  }

  if (filtered.length === 0) {
    console.log(dim("No work items found."));
    return;
  }

  for (const item of filtered) {
    const assignees = getAssignees(item);
    const labels = getLabels(item);
    console.log(
      formatIssueLine({
        iid: item.iid,
        state: item.state,
        title: item.title,
        labels: labels.map((l) => l.title),
        assignee: assignees[0]?.username,
      })
    );
  }
}

// ─── Create helpers ───────────────────────────────────────────────────────────

interface CreatePlan {
  input: WorkItemCreateInput;
  timeTracking?: TimeTrackingWidgetInput;
  problems: string[];
}

/** Resolve names to gids without sending anything; collects every problem instead of stopping at the first. */
async function planCreate(config: Config, data: IssueFileData): Promise<CreatePlan> {
  const problems: string[] = [];
  const attempt = async <T>(fn: () => Promise<T> | T): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  };

  if (!data.title) problems.push(`No title found. Add a title to the file or use --title.`);

  const input: WorkItemCreateInput = {
    title: data.title ?? "",
    workItemTypeId: (await attempt(() => resolveWorkItemType(config, data.type ?? "Issue"))) ?? "",
    namespacePath: config.project,
  };

  if (data.confidential) input.confidential = true;
  if (data.description) input.descriptionWidget = { description: data.description };

  if (data.assignees && data.assignees.length > 0) {
    const users = await Promise.all(
      data.assignees.map((a) => attempt(() => resolveUser(config, a)))
    );
    const ids = users.flatMap((u) => (u ? [u.id] : []));
    if (ids.length > 0) input.assigneesWidget = { assigneeIds: ids };
  }

  if (data.labels && data.labels.length > 0) {
    warnScopedLabelConflicts(data.labels);
    const labelIds = await attempt(() => resolveLabels(config, data.labels!));
    if (labelIds && labelIds.length > 0) input.labelsWidget = { labelIds };
  }

  if (data.weight !== undefined) {
    if (Number.isInteger(data.weight)) input.weightWidget = { weight: data.weight };
    else problems.push(`Invalid weight "${data.weight}". Expected a whole number`);
  }

  for (const [key, value] of [["start", data.start], ["due", data.due]] as const) {
    if (value !== undefined && !isIsoDate(value)) {
      problems.push(`Invalid ${key} date "${value}". Use YYYY-MM-DD`);
    }
  }
  if (data.start || data.due) {
    input.startAndDueDateWidget = {
      isFixed: true,
      startDate: data.start ?? null,
      dueDate: data.due ?? null,
    };
  }

  if (data.status) {
    const statusGid = await attempt(() => resolveStatus(config, data.status!));
    if (statusGid) input.statusWidget = { status: statusGid };
  }

  const timeTracking = await attempt(() => buildTimeTrackingWidget(data));
  return { input, timeTracking, problems };
}

/** Time tracking can't go into workItemCreate, so it follows as an update. */
async function executeCreate(
  config: Config,
  plan: CreatePlan
): Promise<{ created: Awaited<ReturnType<typeof createWorkItem>>; followUpError?: string }> {
  const created = await createWorkItem(config, plan.input);
  if (!plan.timeTracking) return { created };
  try {
    await updateWorkItem(config, { id: created.id, timeTrackingWidget: plan.timeTracking });
    return { created };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { created, followUpError: `#${created.iid} was created, but time tracking was not set: ${msg}` };
  }
}

function createRows(d: IssueFileData): Array<[string, string | undefined]> {
  const descLines = d.description?.split("\n") ?? [];
  return [
    ["Title", d.title],
    ["Type", d.type ?? "Issue"],
    ["Labels", d.labels?.join(", ")],
    ["Assignees", d.assignees?.join(", ")],
    ["Weight", d.weight?.toString()],
    ["Start", d.start],
    ["Due", d.due],
    ["Status", d.status],
    ["Estimate", d.estimate],
    ["Spend", d.spend],
    ["Spend date", d.spendDate],
    ["Spend summary", d.spendSummary],
    ["Confidential", d.confidential ? "yes" : undefined],
    ["Description", d.description ? `${descLines.length} line(s): ${descLines[0]!.slice(0, 60)}` : undefined],
  ];
}

/** Final values, with a marker on those that came from flags rather than the file. */
function printCreatePlan(file: string, parsed: IssueFileData, data: IssueFileData, problems: string[]): void {
  console.log(`\n${bold(file)} ${dim("(dry-run, nothing sent)")}`);
  const fromFile = new Map(createRows(parsed));
  const rows: Array<[string, string]> = [];
  for (const [key, value] of createRows(data)) {
    if (value === undefined) continue;
    const old = fromFile.get(key);
    const note = value === old ? "" : dim(old === undefined ? "  ← flag" : `  ← flag (file: ${old})`);
    rows.push([key, value + note]);
  }
  printTable(rows);
  for (const p of problems) console.log(red(`  ✗ ${p}`));
}

interface BatchOptions {
  overrides: IssueFileData;
  extraLabels: string[];
  dryRun: boolean;
  json: boolean;
  askFirst: boolean;
}

/** One item per file; a failed file doesn't stop the rest. Exit code 1 if any failed. */
async function createBatch(config: Config, files: string[], opts: BatchOptions): Promise<void> {
  if (opts.askFirst && !opts.dryRun) {
    console.log(`\nWill create ${yellow(String(files.length))} work item(s) from:\n`);
    for (const f of files) console.log(`  ${f}`);
    console.log();
    if (!(await confirm(`Create ${files.length} item(s)?`))) {
      console.log(dim("Aborted."));
      return;
    }
  }

  const summary: Array<{ file: string; result: string; failed: boolean }> = [];
  const jsonOut: unknown[] = [];
  const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

  for (const file of files) {
    let parsed: IssueFileData;
    try {
      parsed = parseIssueFile(file);
    } catch (err) {
      const error = errorText(err);
      summary.push({ file, result: `✗ ${error}`, failed: true });
      if (opts.json) jsonOut.push(opts.dryRun ? { file, problems: [error] } : { file, error });
      else console.error(red(`Failed ${file}: ${error}`));
      continue;
    }

    const data = applyOverrides(parsed, opts.overrides, opts.extraLabels);
    const plan = await planCreate(config, data);

    if (opts.dryRun) {
      const { input, timeTracking, problems } = plan;
      if (opts.json) jsonOut.push({ file, parsed, final: data, input, timeTracking, problems });
      else printCreatePlan(file, parsed, data, problems);
      const failed = problems.length > 0;
      summary.push({ file, result: failed ? `✗ ${problems.length} problem(s)` : `ok: ${data.title}`, failed });
      continue;
    }

    if (plan.problems.length > 0) {
      const error = plan.problems.join("; ");
      summary.push({ file, result: `✗ ${error}`, failed: true });
      if (opts.json) jsonOut.push({ file, error });
      else console.error(red(`Failed ${file}: ${error}`));
      continue;
    }

    try {
      const { created, followUpError } = await executeCreate(config, plan);
      const result = `#${created.iid} ${created.title}` + (followUpError ? ` ✗ ${followUpError}` : "");
      summary.push({ file, result, failed: !!followUpError });
      if (opts.json) {
        const item = await getWorkItemByIid(config, created.iid);
        jsonOut.push(followUpError ? { file, item, error: followUpError } : { file, item });
      } else {
        console.log(`${green("Created")} ${cyan("#" + created.iid)} ${bold(created.title)} ${dim(file)}`);
        if (followUpError) console.error(red(followUpError));
      }
    } catch (err) {
      const error = errorText(err);
      summary.push({ file, result: `✗ ${error}`, failed: true });
      if (opts.json) jsonOut.push({ file, error });
      else console.error(red(`Failed ${file}: ${error}`));
    }
  }

  const failedCount = summary.filter((s) => s.failed).length;
  if (opts.json) {
    console.log(JSON.stringify(jsonOut));
  } else {
    const okWord = opts.dryRun ? "ready" : "created";
    console.log(`\n${bold("Summary")}: ${summary.length - failedCount} ${okWord}, ${failedCount} failed`);
    const lines = formatFieldTable(summary.map(({ file, result }) => ({ file, result })), ["file", "result"]);
    console.log("  " + dim(lines[0]!));
    lines.slice(1).forEach((line, i) => console.log("  " + (summary[i]!.failed ? red(line) : line)));
  }
  if (failedCount > 0) process.exit(1);
}

// create
async function cmdCreate(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      title: { type: "string" },
      label: { type: "string", multiple: true },
      labels: { type: "string" },
      assignee: { type: "string" },
      weight: { type: "string" },
      start: { type: "string" },
      due: { type: "string" },
      estimate: { type: "string" },
      spend: { type: "string" },
      date: { type: "string" },
      summary: { type: "string" },
      status: { type: "string" },
      confidential: { type: "boolean" },
      type: { type: "string" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw create <file|dir>... [flags]

Create work items from files (.md, .txt, .json). Several files or a directory
create one item per file, continue past failures and end with a summary.

Arguments:
  <file>              Path to an issue file
  <dir>               Every .md/.markdown/.txt/.json file directly inside it
                      (no subdirectories, natural sort); asks to confirm

Flags:
  --title <t>         Override/set title
  --label <l>         Add label (repeatable)
  --labels <csv>      Set labels as comma-separated list
  --assignee <u>      Assign to user (username, @me)
  --weight <n>        Set weight
  --start YYYY-MM-DD  Set start date
  --due YYYY-MM-DD    Set due date
  --estimate <dur>    Set time estimate (e.g. 2h)
  --spend <dur>       Log time spent right after creation
  --date YYYY-MM-DD   Day the time was spent (default: today)
  --summary <s>       Summary for the time log
  --status <name>     Set status (e.g. "In progress")
  --confidential      Mark as confidential
  --type <name>       Work item type (default: Issue)
  --dry-run           Show parsed and final fields, check names on the server, send nothing
  --yes               Skip the confirmation for a directory
  --project <path>    Override project
  --json              Full created item, same shape as "view --json";
                      several files: [{ file, item?, error? }]

Flags apply to every file. --title works with a single file only.
`);
    return;
  }

  if (positionals.length === 0) die("Usage: glw create <file|dir>...");
  const { files, fromDir } = expandIssueFiles(positionals);
  if (files.length === 0) die(`No .md/.txt/.json files found in: ${positionals.join(", ")}`);
  if (values["title"] && files.length > 1) die(`--title can't be used with several files`);

  const overrides: IssueFileData = {
    title: getFlag(values, "title"),
    confidential: values["confidential"] ? true : undefined,
    weight: values["weight"] !== undefined ? Number(values["weight"]) : undefined,
    start: getFlag(values, "start"),
    due: getFlag(values, "due"),
    estimate: getFlag(values, "estimate"),
    spend: getFlag(values, "spend"),
    spendDate: getFlag(values, "date"),
    spendSummary: getFlag(values, "summary"),
    status: getFlag(values, "status"),
    type: getFlag(values, "type"),
    assignees: values["assignee"] ? [values["assignee"] as string] : undefined,
  };
  const extraLabels = [
    ...getMultiFlag(values, "label"),
    ...(getFlag(values, "labels")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ];

  const config = await resolveConfig(getFlag(values, "project"));

  if (files.length > 1 || fromDir) {
    await createBatch(config, files, {
      overrides,
      extraLabels,
      dryRun: getBoolFlag(values, "dry-run"),
      json: getBoolFlag(values, "json"),
      askFirst: fromDir && !getBoolFlag(values, "yes"),
    });
    return;
  }

  const filePath = files[0]!;
  const parsed = parseIssueFile(filePath);
  const data = applyOverrides(parsed, overrides, extraLabels);
  const plan = await planCreate(config, data);

  if (values["dry-run"]) {
    if (values["json"]) {
      const { input, timeTracking, problems } = plan;
      console.log(JSON.stringify({ file: filePath, parsed, final: data, input, timeTracking, problems }));
    } else {
      printCreatePlan(filePath, parsed, data, plan.problems);
    }
    if (plan.problems.length > 0) process.exit(1);
    return;
  }

  if (plan.problems.length > 0) die(plan.problems.join("\n"));

  const { created, followUpError } = await executeCreate(config, plan);

  if (values["json"]) {
    // Re-read so the output shows widgets as GitLab stored them, same shape as view --json.
    console.log(JSON.stringify(await getWorkItemByIid(config, created.iid)));
  } else {
    console.log(
      `${green("Created")} ${cyan("#" + created.iid)} ${bold(created.title)}`
    );
    console.log(dim(created.webUrl));
  }

  if (followUpError) die(followUpError);
}

// list
async function cmdList(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      state: { type: "string" },
      search: { type: "string" },
      assignee: { type: "string" },
      label: { type: "string" },
      limit: { type: "string" },
      fields: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw list [flags]

List work items.

Flags:
  --state <s>       opened | closed | all (default: opened)
  --search <q>      Search query
  --assignee <u>    Filter by assignee (client-side)
  --label <l>       Filter by label (client-side)
  --limit <n>       Max results (default: 50)
  --fields <csv>    Flat output of chosen fields (see "Fields" below)
  --project <path>  Override project
  --json            JSON output

${FIELDS_HELP}
`);
    return;
  }

  const fields = parseFieldsFlag(values);
  const config = await resolveConfig(getFlag(values, "project"));
  const stateRaw = (getFlag(values, "state") ?? "opened") as "opened" | "closed" | "all";

  const items = await listWorkItems(config, {
    state: stateRaw,
    search: getFlag(values, "search"),
    limit: values["limit"] ? parseInt(values["limit"] as string, 10) : 50,
    includeDescription: fields?.includes("description"),
  });

  let filtered = items;

  // Client-side assignee filter
  const assigneeFilter = getFlag(values, "assignee");
  if (assigneeFilter) {
    let filterUsername: string | null = null;
    if (assigneeFilter === "@me") {
      const me = await getCurrentUser(config);
      filterUsername = me.username;
    } else {
      filterUsername = assigneeFilter.startsWith("@")
        ? assigneeFilter.slice(1)
        : assigneeFilter;
    }
    filtered = filtered.filter((item) =>
      getAssignees(item).some(
        (a) => a.username.toLowerCase() === filterUsername!.toLowerCase()
      )
    );
  }

  // Client-side label filter
  const labelFilter = getFlag(values, "label");
  if (labelFilter) {
    filtered = filtered.filter((item) =>
      getLabels(item).some(
        (l) => l.title.toLowerCase() === labelFilter.toLowerCase()
      )
    );
  }

  if (fields) {
    printFields(filtered, fields, getBoolFlag(values, "json"));
    return;
  }

  if (values["json"]) {
    console.log(JSON.stringify(filtered));
    return;
  }

  if (filtered.length === 0) {
    console.log(dim("No work items found."));
    return;
  }

  for (const item of filtered) {
    const assignees = getAssignees(item);
    const labels = getLabels(item);
    console.log(
      formatIssueLine({
        iid: item.iid,
        state: item.state,
        title: item.title,
        labels: labels.map((l) => l.title),
        assignee: assignees[0]?.username,
      })
    );
  }
}

// mine
async function cmdMine(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      state: { type: "string" },
      label: { type: "string", multiple: true },
      limit: { type: "string" },
      fields: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw mine [--state opened|closed|all] [--label <l>]... [--limit <n>] [--fields <csv>] [--json]

Work items assigned to you in every project you can see (server-side filter,
no default project needed). Grouped by project. Needs GitLab 17.10+.

Flags:
  --state <s>       opened | closed | all (default: opened)
  --label <l>       Only items with this label; repeatable, all must match
  --limit <n>       Max results (default: 100)
  --fields <csv>    Flat output of chosen fields (see "Fields" below)
  --json            JSON output

${FIELDS_HELP}

Examples:
  glw mine
  glw mine --label bug --fields project,iid,title,status,due
`);
    return;
  }

  const fields = parseFieldsFlag(values);
  const config = loadConfig(undefined, false);
  const items = await listMyWorkItems(config, {
    state: (getFlag(values, "state") ?? "opened") as "opened" | "closed" | "all",
    labels: getMultiFlag(values, "label"),
    limit: values["limit"] ? parseInt(values["limit"] as string, 10) : 100,
    includeDescription: fields?.includes("description"),
  });

  if (fields) {
    printFields(items, fields, getBoolFlag(values, "json"));
    return;
  }

  if (values["json"]) {
    console.log(JSON.stringify(items));
    return;
  }

  if (items.length === 0) {
    console.log(dim("No work items assigned to you."));
    return;
  }

  const byProject = new Map<string, WorkItemNode[]>();
  for (const item of items) {
    const path = item.namespace?.fullPath ?? "?";
    byProject.set(path, [...(byProject.get(path) ?? []), item]);
  }

  for (const path of [...byProject.keys()].sort()) {
    console.log(bold(cyan(path)));
    for (const item of byProject.get(path)!) {
      console.log(
        "  " +
          formatIssueLine({
            iid: item.iid,
            state: item.state,
            title: item.title,
            labels: getLabels(item).map((l) => l.title),
          })
      );
    }
  }
}

// todos
async function cmdTodos(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      state: { type: "string" },
      project: { type: "string" },
      limit: { type: "string" },
      all: { type: "boolean" },
      yes: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw todos [--state pending|done|all] [--project <ref>] [--limit <n>] [--json]
glw todos done <id...>
glw todos done --all [--project <ref>] [--yes]

Your GitLab To-Do List: what you were assigned, mentioned in, asked to review.
Not tied to the default project; --project narrows to one project.

Flags:
  --state <s>       pending | done | all (default: pending)
  --project <ref>   Only to-dos of this project
  --limit <n>       Max results (default: 100)
  --json            JSON output: flat objects { id, action, state, type,
                    project, ref, title, targetState, author, createdAt, url, body }

done:
  <id...>           Mark these to-dos done (ids from the ID column)
  --all             Mark every pending to-do done (with --project: of that project)
  --yes             Skip confirmation for --all

Examples:
  glw todos
  glw todos --project backend-api --json
  glw todos done 1201 1202
  glw todos done --all --yes
`);
    return;
  }

  const config = loadConfig(undefined, false);
  const projectRef = getFlag(values, "project");
  const projectId = projectRef
    ? await resolveProject(config, await resolveProjectPath(config, projectRef))
    : undefined;

  if (positionals[0] === "done") {
    await todosDone(config, positionals.slice(1), projectId, values);
    return;
  }
  if (positionals.length > 0) die(`Unknown todos subcommand: "${positionals[0]}". Run: glw todos --help`);

  const state = (getFlag(values, "state") ?? "pending") as "pending" | "done" | "all";
  if (!["pending", "done", "all"].includes(state)) die(`--state must be pending, done or all`);

  const todos = (
    await listTodos(config, {
      state,
      projectId,
      limit: values["limit"] ? parseInt(values["limit"] as string, 10) : 100,
    })
  ).map(flattenTodo);

  if (values["json"]) {
    console.log(JSON.stringify(todos));
    return;
  }

  if (todos.length === 0) {
    console.log(dim("To-Do List is empty."));
    return;
  }

  const columns = ["id", "action", "target", "title", "author", "created"];
  if (state !== "pending") columns.splice(2, 0, "state");
  const rows = todos.map((t) => ({
    id: t.id,
    action: t.action,
    state: t.state,
    target: t.targetState && !isOpenState(t.targetState) ? `${t.ref} (${t.targetState})` : t.ref,
    title: t.title,
    author: t.author ? "@" + t.author : null,
    created: t.createdAt.slice(0, 10),
  }));
  const [header, ...lines] = formatFieldTable(rows, columns);
  console.log(bold(header!));
  for (const line of lines) console.log(line);
}

async function todosDone(
  config: Config,
  ids: string[],
  projectId: string | undefined,
  values: Record<string, string | boolean | string[] | undefined>
): Promise<void> {
  const jsonOut = getBoolFlag(values, "json");

  if (getBoolFlag(values, "all")) {
    if (ids.length > 0) die("Pass either to-do ids or --all, not both");

    const pending = (await listTodos(config, { state: "pending", projectId, limit: 1000 })).map(flattenTodo);
    if (pending.length === 0) {
      console.log(dim("No pending to-dos."));
      return;
    }
    if (!values["yes"]) {
      console.log(`\nFound ${yellow(String(pending.length))} pending to-do(s):\n`);
      for (const t of pending) console.log(`  ${dim(t.id)} ${t.action} ${cyan(t.ref)} ${bold(t.title)}`);
      console.log();
      if (!(await confirm(`Mark ${pending.length} to-do(s) done?`))) {
        console.log(dim("Aborted."));
        return;
      }
    }

    const count = await markAllTodosDone(config, projectId);
    if (jsonOut) console.log(JSON.stringify({ done: count }));
    else console.log(`${green("Marked done:")} ${count} to-do(s)`);
    return;
  }

  if (ids.length === 0) die("Usage: glw todos done <id...> | glw todos done --all");

  const gids = ids.map(toTodoGid);
  const results: Array<{ id: string; error?: string }> = [];
  for (const [i, gid] of gids.entries()) {
    try {
      await markTodoDone(config, gid);
      results.push({ id: ids[i]! });
      if (!jsonOut) console.log(`${green("Done")} ${cyan(ids[i]!)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: ids[i]!, error: msg });
      if (!jsonOut) console.error(red(`Failed ${ids[i]}: ${msg}`));
    }
  }

  if (jsonOut) console.log(JSON.stringify(results));
  if (results.some((r) => r.error)) process.exit(1);
}

// view
async function cmdView(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      fields: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw view <iid> [--fields <csv>] [--json] [--project <path>]

Show details for a work item. With --fields: only those fields, as
key/value lines, or one flat JSON object with --json.

${FIELDS_HELP}
`);
    return;
  }

  const iid = positionals[0];
  if (!iid) die("Usage: glw view <iid>");

  const fields = parseFieldsFlag(values);
  const config = await resolveConfig(getFlag(values, "project"));
  const item = await getWorkItemByIid(config, iid);

  if (fields) {
    const row = flattenItem(item, fields);
    if (values["json"]) console.log(JSON.stringify(row));
    else printTable(fields.map((f) => [f, fieldText(f, row[f] ?? null)]));
    return;
  }

  if (values["json"]) {
    console.log(JSON.stringify(item));
    return;
  }

  const assignees = getAssignees(item);
  const labels = getLabels(item);
  const status = getStatus(item);
  const weight = getWeight(item);
  const dates = getDates(item);
  const timeTracking = getTimeTracking(item);
  const hierarchy = getHierarchy(item);
  const linked = getLinkedInfo(item);
  const description = getDescription(item);

  console.log(`\n${bold(item.title)}`);
  console.log(dim(item.webUrl));
  console.log();

  const rows: Array<[string, string]> = [
    ["ID", cyan(`#${item.iid}`)],
    ["State", isOpenState(item.state) ? green(item.state.toLowerCase()) : dim(item.state.toLowerCase())],
  ];

  if (status) rows.push(["Status", status.name]);
  if (assignees.length > 0)
    rows.push([
      "Assignees",
      assignees.map((a) => `@${a.username}`).join(", "),
    ]);
  if (labels.length > 0)
    rows.push(["Labels", labels.map((l) => l.title).join(", ")]);
  if (weight !== null) rows.push(["Weight", String(weight)]);
  if (dates.startDate) rows.push(["Start", dates.startDate]);
  if (dates.dueDate) rows.push(["Due", dates.dueDate]);
  if (timeTracking.timeEstimate)
    rows.push(["Estimate", secondsToHuman(timeTracking.timeEstimate)]);
  if (timeTracking.totalTimeSpent)
    rows.push(["Time Spent", secondsToHuman(timeTracking.totalTimeSpent)]);

  if (hierarchy.parent)
    rows.push([
      "Parent",
      `${cyan("#" + hierarchy.parent.iid)} ${hierarchy.parent.title}`,
    ]);
  if (hierarchy.children.length > 0)
    rows.push([
      `Children (${hierarchy.children.length})`,
      hierarchy.children.map((c) => cyan("#" + c.iid)).join(", "),
    ]);
  if (linked.blockingCount > 0)
    rows.push(["Blocks", String(linked.blockingCount)]);
  if (linked.blockedByCount > 0)
    rows.push(["Blocked by", String(linked.blockedByCount)]);

  printTable(rows);

  if (description) {
    console.log(`\n${dim("─".repeat(50))}`);
    console.log(description);
  }
  console.log();
}

// ─── Update helpers ───────────────────────────────────────────────────────────

interface UpdateFields {
  title?: string;
  body?: string;
  status?: string;
  assignee?: string;
  labels?: string; // CSV for set
  addLabel?: string[];
  removeLabel?: string[];
  weight?: string; // "none" or number
  start?: string; // "none" or date
  due?: string; // "none" or date
  estimate?: string;
  spend?: string;
  spendDate?: string;
  spendSummary?: string;
}

async function buildUpdateInput(
  config: Config,
  item: WorkItemNode,
  fields: UpdateFields
): Promise<WorkItemUpdateInput> {
  const updateInput: WorkItemUpdateInput = { id: item.id };

  if (fields.title !== undefined) updateInput.title = fields.title;

  if (fields.body !== undefined) {
    updateInput.descriptionWidget = { description: fields.body };
  }

  if (fields.status !== undefined) {
    const statusGid = await resolveStatus(config, fields.status);
    updateInput.statusWidget = { status: statusGid };
  }

  if (fields.assignee !== undefined) {
    const user = await resolveUser(config, fields.assignee);
    updateInput.assigneesWidget = { assigneeIds: user ? [user.id] : [] };
  }

  // Labels: compute add/remove against current
  const currentLabelIds = getLabels(item).map((l) => l.id);
  const currentLabelTitles = getLabels(item).map((l) => l.title.toLowerCase());

  let addLabelIds: string[] = [];
  let removeLabelIds: string[] = [];

  if (fields.labels !== undefined) {
    // Set labels: compute diff
    const desired = fields.labels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const desiredIds = desired.length > 0 ? await resolveLabels(config, desired) : [];

    // IDs to add (not in current)
    addLabelIds = desiredIds.filter((id) => !currentLabelIds.includes(id));
    // IDs to remove (in current but not in desired)
    removeLabelIds = currentLabelIds.filter((id) => !desiredIds.includes(id));
  }

  if (fields.addLabel && fields.addLabel.length > 0) {
    const ids = await resolveLabels(config, fields.addLabel);
    addLabelIds = [...addLabelIds, ...ids.filter((id) => !addLabelIds.includes(id))];
  }

  if (fields.removeLabel && fields.removeLabel.length > 0) {
    const removeNames = fields.removeLabel;
    const labelNodes = getLabels(item);
    const idsToRemove: string[] = [];
    const notFound: string[] = [];
    for (const name of removeNames) {
      const node = labelNodes.find(
        (l) => l.title.toLowerCase() === name.toLowerCase()
      );
      if (node) {
        idsToRemove.push(node.id);
      } else if (currentLabelTitles.includes(name.toLowerCase())) {
        // Already removed
      } else {
        notFound.push(name);
      }
    }
    if (notFound.length > 0) {
      // Warn but don't fail — label might just not be on this item
      process.stderr.write(
        `glw: warning: labels not found on #${item.iid}: ${notFound.join(", ")}\n`
      );
    }
    removeLabelIds = [
      ...removeLabelIds,
      ...idsToRemove.filter((id) => !removeLabelIds.includes(id)),
    ];
  }

  if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
    updateInput.labelsWidget = {};
    if (addLabelIds.length > 0) updateInput.labelsWidget.addLabelIds = addLabelIds;
    if (removeLabelIds.length > 0) updateInput.labelsWidget.removeLabelIds = removeLabelIds;
  }

  if (fields.weight !== undefined) {
    updateInput.weightWidget = {
      weight: fields.weight === "none" ? null : parseInt(fields.weight, 10),
    };
  }

  if (fields.start !== undefined || fields.due !== undefined) {
    const currentDates = getDates(item);
    updateInput.startAndDueDateWidget = {
      isFixed: true,
      startDate:
        fields.start === undefined
          ? currentDates.startDate
          : fields.start === "none"
          ? null
          : fields.start,
      dueDate:
        fields.due === undefined
          ? currentDates.dueDate
          : fields.due === "none"
          ? null
          : fields.due,
    };
  }

  const tw = buildTimeTrackingWidget(fields);
  if (tw) updateInput.timeTrackingWidget = tw;

  return updateInput;
}

// update
async function cmdUpdate(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      search: { type: "string" },
      "filter-assignee": { type: "string" },
      "filter-label": { type: "string" },
      state: { type: "string" },
      // field flags
      title: { type: "string" },
      body: { type: "string" },
      "body-file": { type: "string" },
      status: { type: "string" },
      assignee: { type: "string" },
      labels: { type: "string" },
      "add-label": { type: "string", multiple: true },
      "remove-label": { type: "string", multiple: true },
      weight: { type: "string" },
      start: { type: "string" },
      due: { type: "string" },
      estimate: { type: "string" },
      spend: { type: "string" },
      date: { type: "string" },
      summary: { type: "string" },
      yes: { type: "boolean" },
      "dry-run": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw update [iid...] [selection flags] [field flags] [--yes] [--dry-run]

Selection:
  Positional iids     Specific issues
  --search <q>        Filter by search query
  --filter-assignee   Filter by assignee
  --filter-label      Filter by label
  --state <s>         State filter (default: opened)

Field flags:
  --title <t>         Set title
  --body <text>       Set description
  --body-file <f>     Set description from file
  --status <name>     Set status
  --assignee <u>      Set assignee (username, @me, none)
  --labels <csv>      Set labels (replaces all)
  --add-label <l>     Add label (repeatable)
  --remove-label <l>  Remove label (repeatable)
  --weight <n|none>   Set weight (or "none" to clear)
  --start <date|none> Set start date (or "none" to clear)
  --due <date|none>   Set due date (or "none" to clear)
  --estimate <dur>    Set time estimate
  --spend <dur>       Log time spent
  --date YYYY-MM-DD   Day the time was spent (default: today)
  --summary <s>       Summary for time log
  --yes               Skip confirmation
  --dry-run           Preview without making changes
  --project <path>    Override project
`);
    return;
  }

  const config = await resolveConfig(getFlag(values, "project"));

  // Check at least one field flag
  const fieldFlags = [
    "title", "body", "body-file", "status", "assignee", "labels",
    "add-label", "remove-label", "weight", "start", "due", "estimate", "spend",
  ];
  const hasField = fieldFlags.some((f) => values[f] !== undefined && values[f] !== false);
  if (!hasField) {
    die("At least one field flag is required. Run: glw update --help");
  }

  // Resolve body
  let body: string | undefined;
  if (values["body"]) {
    body = values["body"] as string;
  } else if (values["body-file"]) {
    const bf = values["body-file"] as string;
    if (!existsSync(bf)) die(`File not found: ${bf}`);
    body = readFileSync(bf, "utf-8");
  }

  const fields: UpdateFields = {
    title: getFlag(values, "title"),
    body,
    status: getFlag(values, "status"),
    assignee: getFlag(values, "assignee"),
    labels: getFlag(values, "labels"),
    addLabel: getMultiFlag(values, "add-label"),
    removeLabel: getMultiFlag(values, "remove-label"),
    weight: getFlag(values, "weight"),
    start: getFlag(values, "start"),
    due: getFlag(values, "due"),
    estimate: getFlag(values, "estimate"),
    spend: getFlag(values, "spend"),
    spendDate: getFlag(values, "date"),
    spendSummary: getFlag(values, "summary"),
  };
  // Fail on a bad duration/date before touching any item.
  buildTimeTrackingWidget(fields);
  warnScopedLabelConflicts([
    ...(fields.labels?.split(",").map((l) => l.trim()).filter(Boolean) ?? []),
    ...(fields.addLabel ?? []),
  ]);

  // Gather items
  let items: WorkItemNode[];

  if (positionals.length > 0) {
    items = await Promise.all(
      positionals.map((iid) => getWorkItemByIid(config, iid))
    );
  } else {
    const stateRaw = (getFlag(values, "state") ?? "opened") as "opened" | "closed" | "all";
    items = await listWorkItems(config, {
      state: stateRaw,
      search: getFlag(values, "search"),
      limit: 200,
    });

    // Client-side filters
    const fa = getFlag(values, "filter-assignee");
    if (fa) {
      let filterUsername: string | null = null;
      if (fa === "@me") {
        const me = await getCurrentUser(config);
        filterUsername = me.username;
      } else {
        filterUsername = fa.startsWith("@") ? fa.slice(1) : fa;
      }
      items = items.filter((item) =>
        getAssignees(item).some(
          (a) => a.username.toLowerCase() === filterUsername!.toLowerCase()
        )
      );
    }

    const fl = getFlag(values, "filter-label");
    if (fl) {
      items = items.filter((item) =>
        getLabels(item).some((l) => l.title.toLowerCase() === fl.toLowerCase())
      );
    }

    if (items.length === 0) {
      console.log(dim("No matching work items found."));
      return;
    }

    // Print matches
    console.log(`\nFound ${yellow(String(items.length))} work item(s):\n`);
    for (const item of items) {
      const assignees = getAssignees(item);
      const labels = getLabels(item);
      console.log(
        "  " +
          formatIssueLine({
            iid: item.iid,
            state: item.state,
            title: item.title,
            labels: labels.map((l) => l.title),
            assignee: assignees[0]?.username,
          })
      );
    }
    console.log();

    if (values["dry-run"]) {
      console.log(dim("(dry-run) Changes would be applied to the above items."));
      console.log(dim("Fields: " + JSON.stringify(fields)));
      return;
    }

    if (!values["yes"]) {
      const ok = await confirm(`Apply changes to ${items.length} item(s)?`);
      if (!ok) {
        console.log(dim("Aborted."));
        return;
      }
    }
  }

  if (values["dry-run"]) {
    console.log(dim("(dry-run) Would update:"));
    for (const item of items) {
      console.log(dim(`  #${item.iid} ${item.title}`));
    }
    return;
  }

  let anyFailed = false;
  for (const item of items) {
    try {
      const updateInput = await buildUpdateInput(config, item, fields);
      const updated = await updateWorkItem(config, updateInput);
      console.log(
        `${green("Updated")} ${cyan("#" + updated.iid)} ${bold(updated.title)}`
      );
    } catch (err) {
      anyFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`Failed #${item.iid}: ${msg}`));
    }
  }

  if (anyFailed) process.exit(1);
}

// comment
async function cmdComment(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      file: { type: "string" },
      internal: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw comment <iid> [text] [--file <f>] [--internal]

Add a comment to a work item.

  --file <f>    Read comment body from file
  --internal    Mark as internal (confidential) note
`);
    return;
  }

  const iid = positionals[0];
  if (!iid) die("Usage: glw comment <iid> [text]");

  let body = positionals.slice(1).join(" ");
  if (values["file"]) {
    const f = values["file"] as string;
    if (!existsSync(f)) die(`File not found: ${f}`);
    body = readFileSync(f, "utf-8");
  }

  if (!body.trim()) {
    die("Comment body is empty. Provide text or use --file.");
  }

  const config = await resolveConfig(getFlag(values, "project"));
  const item = await getWorkItemByIid(config, iid);
  await createNote(config, item.id, body, getBoolFlag(values, "internal"));

  console.log(`${green("Comment added")} to ${cyan("#" + item.iid)}`);
}

// close
async function cmdClose(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      search: { type: "string" },
      "filter-assignee": { type: "string" },
      "filter-label": { type: "string" },
      state: { type: "string" },
      comment: { type: "string" },
      yes: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw close [iid...] [selection flags] [--comment <text>] [--yes]

Close one or more work items.

Selection (if no iids given):
  --search <q>
  --filter-assignee <u>
  --filter-label <l>
  --state <s>           (default: opened)

Options:
  --comment <text>  Add a comment before closing
  --yes             Skip confirmation
`);
    return;
  }

  const config = await resolveConfig(getFlag(values, "project"));

  let items: WorkItemNode[];

  if (positionals.length > 0) {
    items = await Promise.all(
      positionals.map((iid) => getWorkItemByIid(config, iid))
    );
  } else {
    const stateRaw = (getFlag(values, "state") ?? "opened") as "opened" | "closed" | "all";
    items = await listWorkItems(config, {
      state: stateRaw,
      search: getFlag(values, "search"),
      limit: 200,
    });

    const fa = getFlag(values, "filter-assignee");
    if (fa) {
      let filterUsername: string | null = null;
      if (fa === "@me") {
        const me = await getCurrentUser(config);
        filterUsername = me.username;
      } else {
        filterUsername = fa.startsWith("@") ? fa.slice(1) : fa;
      }
      items = items.filter((item) =>
        getAssignees(item).some(
          (a) => a.username.toLowerCase() === filterUsername!.toLowerCase()
        )
      );
    }

    const fl = getFlag(values, "filter-label");
    if (fl) {
      items = items.filter((item) =>
        getLabels(item).some((l) => l.title.toLowerCase() === fl.toLowerCase())
      );
    }

    if (items.length === 0) {
      console.log(dim("No matching work items found."));
      return;
    }

    console.log(`\nFound ${yellow(String(items.length))} work item(s):\n`);
    for (const item of items) {
      const assignees = getAssignees(item);
      console.log(
        "  " +
          formatIssueLine({
            iid: item.iid,
            state: item.state,
            title: item.title,
            assignee: assignees[0]?.username,
          })
      );
    }
    console.log();

    if (!values["yes"]) {
      const ok = await confirm(`Close ${items.length} item(s)?`);
      if (!ok) {
        console.log(dim("Aborted."));
        return;
      }
    }
  }

  const commentText = getFlag(values, "comment");
  let anyFailed = false;

  for (const item of items) {
    try {
      if (commentText) {
        await createNote(config, item.id, commentText);
      }
      await updateWorkItem(config, { id: item.id, stateEvent: "CLOSE" });
      console.log(`${green("Closed")} ${cyan("#" + item.iid)} ${bold(item.title)}`);
    } catch (err) {
      anyFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`Failed #${item.iid}: ${msg}`));
    }
  }

  if (anyFailed) process.exit(1);
}

// reopen
async function cmdReopen(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`glw reopen <iid...> [--project <path>]\n\nReopen closed work items.`);
    return;
  }

  if (positionals.length === 0) die("Usage: glw reopen <iid...>");

  const config = await resolveConfig(getFlag(values, "project"));
  let anyFailed = false;

  for (const iid of positionals) {
    try {
      const item = await getWorkItemByIid(config, iid);
      await updateWorkItem(config, { id: item.id, stateEvent: "REOPEN" });
      console.log(`${green("Reopened")} ${cyan("#" + item.iid)} ${bold(item.title)}`);
    } catch (err) {
      anyFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`Failed #${iid}: ${msg}`));
    }
  }

  if (anyFailed) process.exit(1);
}

// link
async function cmdLink(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      type: { type: "string" },
      remove: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw link <iid> <target-iid...> [--type related|blocks|blocked-by] [--remove] [--json]

Link work items together (related / blocks / blocked-by). Creates the link from
<iid> to each target; --remove deletes it instead.

Arguments:
  <iid>              The anchor work item
  <target-iid...>    One or more work items to link to <iid>

Flags:
  --type <t>         Relationship from <iid> to each target:
                     related (default) | blocks | blocked-by
  --remove           Remove the link(s) instead of creating them
                     (--type is ignored on removal)
  --json             JSON output
  --project <path>   Override project

Examples:
  glw link 42 43                     # 42 is related to 43
  glw link 42 43 44 --type blocks    # 42 blocks 43 and 44
  glw link 42 43 --type blocked-by   # 42 is blocked by 43
  glw link 42 43 --remove            # remove the link between 42 and 43
`);
    return;
  }

  const anchorRaw = positionals[0];
  const targetsRaw = positionals.slice(1);
  if (!anchorRaw || targetsRaw.length === 0) {
    die("Usage: glw link <iid> <target-iid...> [--type related|blocks|blocked-by] [--remove]");
  }

  const remove = getBoolFlag(values, "remove");
  // Parse the link type up front so a bad value fails before any network call.
  const linkType: LinkType = remove
    ? "RELATED"
    : parseLinkType(getFlag(values, "type") ?? "related");

  const config = await resolveConfig(getFlag(values, "project"));

  const anchorIid = normalizeIid(anchorRaw);
  const targetIids = targetsRaw.map(normalizeIid);

  const anchor = await getWorkItemByIid(config, anchorIid);
  const targets = await Promise.all(
    targetIids.map((iid) => getWorkItemByIid(config, iid))
  );
  const targetGids = targets.map((t) => t.id);

  const result = remove
    ? await removeLinkedItems(config, anchor.id, targetGids)
    : await addLinkedItems(config, anchor.id, targetGids, linkType);

  if (values["json"]) {
    console.log(
      JSON.stringify({
        action: remove ? "unlink" : "link",
        linkType: remove ? null : linkType,
        workItem: { id: result.id, iid: result.iid, title: result.title },
        targets: targets.map((t) => ({ id: t.id, iid: t.iid, title: t.title })),
      })
    );
    return;
  }

  const targetList = targets.map((t) => cyan("#" + t.iid)).join(", ");
  if (remove) {
    console.log(
      `${yellow("Unlinked")} ${cyan("#" + anchor.iid)} ${dim("from")} ${targetList}`
    );
  } else {
    const verb =
      linkType === "RELATED"
        ? "related to"
        : linkType === "BLOCKS"
          ? "blocks"
          : "blocked by";
    console.log(
      `${green("Linked")} ${cyan("#" + anchor.iid)} ${dim(verb)} ${targetList}`
    );
  }
}

// parent
async function cmdParent(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      to: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw parent <iid...> --to <parent-iid|none> [--json]

Set or clear the parent of one or more work items (hierarchy). Use it to nest
issues under a parent/epic, or to reparent/detach them. Setting the same parent
on several items is how you "add children" to that parent.

Arguments:
  <iid...>           Child work item(s) to reparent

Flags:
  --to <n|none>      Parent work item number, or "none" to remove the parent
  --json             JSON output
  --project <path>   Override project

Examples:
  glw parent 4 --to 3          # make #4 a child of #3
  glw parent 4 5 6 --to 3      # add #4, #5, #6 as children of #3
  glw parent 4 --to none       # detach #4 from its parent
`);
    return;
  }

  if (positionals.length === 0) {
    die("Usage: glw parent <iid...> --to <parent-iid|none>");
  }

  const to = getFlag(values, "to");
  if (to === undefined) {
    die('Missing --to. Use: glw parent <iid...> --to <parent-iid|none>');
  }

  const config = await resolveConfig(getFlag(values, "project"));

  const clear = to.trim().toLowerCase() === "none";
  let parentId: string | null = null;
  let parentLabel = "(none)";
  if (!clear) {
    const parent = await getWorkItemByIid(config, normalizeIid(to));
    parentId = parent.id;
    parentLabel = "#" + parent.iid;
  }

  const childIids = positionals.map(normalizeIid);
  const results: Array<{ id: string; iid: string; title: string }> = [];
  let anyFailed = false;

  for (const iid of childIids) {
    try {
      const child = await getWorkItemByIid(config, iid);
      const updated = await updateWorkItem(config, {
        id: child.id,
        hierarchyWidget: { parentId },
      });
      results.push({ id: updated.id, iid: updated.iid, title: updated.title });
      if (!values["json"]) {
        console.log(
          clear
            ? `${yellow("Cleared parent")} of ${cyan("#" + updated.iid)} ${bold(updated.title)}`
            : `${green("Set parent")} of ${cyan("#" + updated.iid)} ${dim("→")} ${cyan(parentLabel)} ${bold(updated.title)}`
        );
      }
    } catch (err) {
      anyFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(red(`Failed #${iid}: ${msg}`));
    }
  }

  if (values["json"]) {
    console.log(
      JSON.stringify({
        action: clear ? "clear-parent" : "set-parent",
        parent: clear ? null : parentLabel,
        children: results,
      })
    );
  }

  if (anyFailed) process.exit(1);
}

// estimate
async function cmdEstimate(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`glw estimate <iid> <dur>\n\nSet time estimate. E.g.: glw estimate 42 2h`);
    return;
  }

  const iid = positionals[0];
  const dur = positionals[1];
  if (!iid || !dur) die("Usage: glw estimate <iid> <dur>");

  const config = await resolveConfig(getFlag(values, "project"));
  const item = await getWorkItemByIid(config, iid);
  const validated = validateDuration(dur);
  await updateWorkItem(config, {
    id: item.id,
    timeTrackingWidget: { timeEstimate: validated },
  });
  console.log(
    `${green("Estimate set")} on ${cyan("#" + item.iid)}: ${bold(validated)}`
  );
}

// spend
async function cmdSpend(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      summary: { type: "string" },
      date: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw spend <iid> <dur> [--date YYYY-MM-DD] [--summary <s>]

Log time spent.

Flags:
  --date YYYY-MM-DD   Day the time was spent (default: today)
  --summary <s>       Summary for the time log

Examples:
  glw spend 42 1h30m --summary "code review"
  glw spend 42 4h --date 2026-10-15
`);
    return;
  }

  const iid = positionals[0];
  const dur = positionals[1];
  if (!iid || !dur) die("Usage: glw spend <iid> <dur>");

  const date = getFlag(values, "date");
  const timeTracking = buildTimeTrackingWidget({
    spend: dur,
    spendDate: date,
    spendSummary: getFlag(values, "summary"),
  })!;

  const config = await resolveConfig(getFlag(values, "project"));
  const item = await getWorkItemByIid(config, iid);

  await updateWorkItem(config, { id: item.id, timeTrackingWidget: timeTracking });

  console.log(
    `${green("Time logged")} on ${cyan("#" + item.iid)}: ${bold(timeTracking.timelog!.timeSpent)}` +
      (date ? ` (${date})` : "")
  );
}

// completion
function cmdCompletion(args: string[]): void {
  const shell = args[0];

  if (!shell || shell === "--help" || shell === "-h") {
    console.log(`
glw completion <bash|zsh|powershell>

Print a shell completion script. Setup:
  bash:        eval "$(glw completion bash)"        # in ~/.bashrc
  zsh:         eval "$(glw completion zsh)"         # in ~/.zshrc
  powershell:  glw completion powershell | Out-String | Invoke-Expression  # in $PROFILE

Completes command names and project paths after "use" / "--project"
(from the cache at ~/.glw/projects.json, updated by "glw projects").
`);
    return;
  }

  const subcommands = [
    "init", "config", "global", "whoami", "projects", "use", "labels", "search", "create", "list",
    "mine", "todos", "view", "update", "comment", "close", "reopen", "link", "parent", "estimate", "spend",
    "completion",
    // aliases
    "i", "cfg", "s", "p", "co", "cr", "u", "v", "l", "ls", "ln",
  ].join(" ");

  if (shell === "bash") {
    console.log(`# glw bash completion
# Add to ~/.bashrc:  eval "$(glw completion bash)"
_glw_complete() {
  local cur prev words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( \$(compgen -W "${subcommands}" -- "\${cur}") )
  elif [[ "\${prev}" == "use" || "\${prev}" == "--project" ]]; then
    local projects
    projects=\$(glw __complete projects 2>/dev/null)
    COMPREPLY=( \$(compgen -W "\${projects}" -- "\${cur}") )
  fi
}
complete -F _glw_complete glw`);
  } else if (shell === "zsh") {
    console.log(`# glw zsh completion
# Add to ~/.zshrc:  eval "$(glw completion zsh)"
_glw() {
  local state
  _arguments \\
    '1: :->cmd' \\
    '*: :->args'
  case \$state in
    cmd)
      compadd ${subcommands}
      ;;
    args)
      case \${words[2]} in
        use|--project)
          local projects
          projects=(\${(f)"\$(glw __complete projects 2>/dev/null)"})
          compadd \$projects
          ;;
      esac
      ;;
  esac
}
compdef _glw glw`);
  } else if (shell === "powershell") {
    console.log(`# glw PowerShell completion
# Add to $PROFILE:  glw completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName glw -ScriptBlock {
  param(\$wordToComplete, \$commandAst, \$cursorPosition)
  \$words = \$commandAst.CommandElements
  \$prev = if (\$words.Count -ge 2) { \$words[\$words.Count - 2].ToString() } else { '' }
  if (\$words.Count -le 2) {
    '${subcommands}'.Split(' ') | Where-Object { \$_ -like "\$wordToComplete*" } |
      ForEach-Object { [System.Management.Automation.CompletionResult]::new(\$_, \$_, 'ParameterValue', \$_) }
  } elseif (\$prev -eq 'use' -or \$prev -eq '--project') {
    \$projects = (glw __complete projects 2>\$null) -split '\`n'
    \$projects | Where-Object { \$_ -like "\$wordToComplete*" } |
      ForEach-Object { [System.Management.Automation.CompletionResult]::new(\$_, \$_, 'ParameterValue', \$_) }
  }
}`);
  } else {
    console.error(red(`Unknown shell: "${shell}". Use: bash, zsh, or powershell`));
    process.exit(1);
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(HELP);
    return;
  }

  // Resolve aliases before dispatching
  const rawCmd = argv[0]!;
  const cmd = ALIASES[rawCmd] ?? rawCmd;
  const rest = argv.slice(1);

  try {
    switch (cmd) {
      case "init":
        await cmdInit(rest);
        break;

      case "config":
        await cmdConfig(rest);
        break;

      case "global":
        await cmdGlobal(rest);
        break;

      case "whoami": {
        const { values } = parseArgs({
          args: rest,
          options: {
            project: { type: "string" },
            json: { type: "boolean" },
            help: { type: "boolean", short: "h" },
          },
          strict: false,
        });
        if (values["help"]) {
          console.log(`glw whoami [--json]\n\nShow the authenticated GitLab user.`);
          break;
        }
        // project is irrelevant for currentUser — do not require it
        const config = loadConfig(undefined, false);
        await cmdWhoami(config, getBoolFlag(values, "json"));
        break;
      }

      case "projects":
        await cmdProjects(rest);
        break;

      case "use":
        await cmdUse(rest);
        break;

      case "labels":
        await cmdLabels(rest);
        break;

      case "search":
        await cmdSearch(rest);
        break;

      case "create":
        await cmdCreate(rest);
        break;

      case "list":
        await cmdList(rest);
        break;

      case "mine":
        await cmdMine(rest);
        break;

      case "todos":
        await cmdTodos(rest);
        break;

      case "view":
        await cmdView(rest);
        break;

      case "update":
        await cmdUpdate(rest);
        break;

      case "comment":
        await cmdComment(rest);
        break;

      case "close":
        await cmdClose(rest);
        break;

      case "reopen":
        await cmdReopen(rest);
        break;

      case "link":
        await cmdLink(rest);
        break;

      case "parent":
        await cmdParent(rest);
        break;

      case "estimate":
        await cmdEstimate(rest);
        break;

      case "spend":
        await cmdSpend(rest);
        break;

      case "completion":
        cmdCompletion(rest);
        break;

      case "__complete": {
        // Hidden command for shell completion scripts
        if (rest[0] === "projects") {
          const cached = readProjectsCache();
          if (cached.length > 0) {
            console.log(cached.join("\n"));
          }
        }
        break;
      }

      default:
        console.error(red(`Unknown command: "${rawCmd}"`));
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    handleError(err);
  }
}

main().catch(handleError);
