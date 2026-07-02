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
  resolveWorkItemType,
  resolveStatus,
  getWorkItemByIid,
  listWorkItems,
  createWorkItem,
  updateWorkItem,
  createNote,
  validateDuration,
  getAssignees,
  getLabels,
  getStatus,
  getWeight,
  getDates,
  getTimeTracking,
  getDescription,
  matchesSearch,
  type SearchCriteria,
  type WorkItemUpdateInput,
  type WorkItemCreateInput,
  type WorkItemNode,
} from "./api.ts";
import { parseIssueFile } from "./inputfile.ts";
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
  search                Search work items with filters
  create <file>         Create a work item from a file
  list                  List work items
  view <iid>            Show a work item
  update [iid...] ...   Update one or more work items
  comment <iid> [text]  Add a comment to a work item
  close [iid...]        Close one or more work items
  reopen <iid...>       Reopen work items
  estimate <iid> <dur>  Set time estimate (e.g. 2h, 1h30m)
  spend <iid> <dur>     Log time spent
  completion <shell>    Print shell completion script (bash|zsh|powershell)

Aliases:
  i→init  cfg→config  s→search  p→projects  l/ls→list  v→view
  cr→create  u→update  co→comment

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
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw search [text] [--name <q>] [--body <q>] [--start_time <YYYY-MM-DD>] [--state opened|closed|all] [--limit <n>] [--json] [--project <ref>]

Search work items. At least one filter is required.

Arguments:
  text               Search title AND description (server + client filter)

Flags:
  --name <q>         Title contains (case-insensitive)
  --body <q>         Description contains (case-insensitive)
  --start_time <d>   Start date >= YYYY-MM-DD (alias: --start)
  --state <s>        opened | closed | all (default: opened)
  --limit <n>        Max items to fetch (default: 200)
  --project <ref>    Override project
  --json             JSON output

Examples:
  glw search "authentication"
  glw search --name "auth" --body "JWT"
  glw s --start_time 2026-01-01 --state all
`);
    return;
  }

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
      status: { type: "string" },
      confidential: { type: "boolean" },
      type: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(`
glw create <file> [flags]

Create a work item from a file (.md, .txt, .json).

Arguments:
  <file>              Path to the issue file

Flags:
  --title <t>         Override/set title
  --label <l>         Add label (repeatable)
  --labels <csv>      Set labels as comma-separated list
  --assignee <u>      Assign to user (username, @me)
  --weight <n>        Set weight
  --start YYYY-MM-DD  Set start date
  --due YYYY-MM-DD    Set due date
  --estimate <dur>    Set time estimate (e.g. 2h)
  --status <name>     Set status (e.g. "In progress")
  --confidential      Mark as confidential
  --type <name>       Work item type (default: Issue)
  --project <path>    Override project
  --json              JSON output
`);
    return;
  }

  const filePath = positionals[0];
  if (!filePath) die("Usage: glw create <file>");

  const config = await resolveConfig(getFlag(values, "project"));

  let fileData = parseIssueFile(filePath);

  // CLI flags override file values
  if (values["title"]) fileData.title = values["title"] as string;
  if (values["confidential"]) fileData.confidential = true;
  if (values["weight"]) fileData.weight = parseInt(values["weight"] as string, 10);
  if (values["start"]) fileData.start = values["start"] as string;
  if (values["due"]) fileData.due = values["due"] as string;
  if (values["estimate"]) fileData.estimate = values["estimate"] as string;
  if (values["status"]) fileData.status = values["status"] as string;
  if (values["type"]) fileData.type = values["type"] as string;
  if (values["assignee"]) fileData.assignees = [values["assignee"] as string];

  // Merge labels
  const extraLabels: string[] = [];
  const labelFlags = getMultiFlag(values, "label");
  if (labelFlags.length > 0) extraLabels.push(...labelFlags);
  if (values["labels"]) {
    extraLabels.push(...(values["labels"] as string).split(",").map((s) => s.trim()).filter(Boolean));
  }
  if (extraLabels.length > 0) {
    fileData.labels = [...(fileData.labels ?? []), ...extraLabels];
  }

  if (!fileData.title) {
    die(
      `No title found. Add a title to the file or use --title.`
    );
  }

  // Resolve type
  const typeName = fileData.type ?? "Issue";
  const workItemTypeId = await resolveWorkItemType(config, typeName);

  // Build input
  const createInput: WorkItemCreateInput = {
    title: fileData.title,
    workItemTypeId,
    namespacePath: config.project,
  };

  if (fileData.confidential) createInput.confidential = true;

  if (fileData.description) {
    createInput.descriptionWidget = { description: fileData.description };
  }

  if (fileData.assignees && fileData.assignees.length > 0) {
    const users = await Promise.all(
      fileData.assignees.map((a) => resolveUser(config, a))
    );
    const ids = users.filter((u) => u !== null).map((u) => u!.id);
    if (ids.length > 0) createInput.assigneesWidget = { assigneeIds: ids };
  }

  if (fileData.labels && fileData.labels.length > 0) {
    const labelIds = await resolveLabels(config, fileData.labels);
    if (labelIds.length > 0) createInput.labelsWidget = { labelIds };
  }

  if (fileData.weight !== undefined) {
    createInput.weightWidget = { weight: fileData.weight };
  }

  if (fileData.start || fileData.due) {
    createInput.startAndDueDateWidget = {
      isFixed: true,
      startDate: fileData.start ?? null,
      dueDate: fileData.due ?? null,
    };
  }

  if (fileData.status) {
    const statusGid = await resolveStatus(config, fileData.status);
    createInput.statusWidget = { status: statusGid };
  }

  if (fileData.estimate) {
    const dur = validateDuration(fileData.estimate);
    createInput.timeTrackingWidget = { timeEstimate: dur };
  }

  const created = await createWorkItem(config, createInput);

  if (values["json"]) {
    console.log(JSON.stringify(created));
  } else {
    console.log(
      `${green("Created")} ${cyan("#" + created.iid)} ${bold(created.title)}`
    );
    console.log(dim(created.webUrl));
  }
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
  --project <path>  Override project
  --json            JSON output
`);
    return;
  }

  const config = await resolveConfig(getFlag(values, "project"));
  const stateRaw = (getFlag(values, "state") ?? "opened") as "opened" | "closed" | "all";

  const items = await listWorkItems(config, {
    state: stateRaw,
    search: getFlag(values, "search"),
    limit: values["limit"] ? parseInt(values["limit"] as string, 10) : 50,
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

// view
async function cmdView(args: string[]): Promise<void> {
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
    console.log(`
glw view <iid> [--json] [--project <path>]

Show details for a work item.
`);
    return;
  }

  const iid = positionals[0];
  if (!iid) die("Usage: glw view <iid>");

  const config = await resolveConfig(getFlag(values, "project"));
  const item = await getWorkItemByIid(config, iid);

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

  if (fields.estimate !== undefined || fields.spend !== undefined) {
    const tw: NonNullable<WorkItemUpdateInput["timeTrackingWidget"]> = {};
    if (fields.estimate !== undefined) {
      tw.timeEstimate = validateDuration(fields.estimate);
    }
    if (fields.spend !== undefined) {
      tw.timelog = {
        timeSpent: validateDuration(fields.spend),
        ...(fields.spendSummary ? { summary: fields.spendSummary } : {}),
      };
    }
    updateInput.timeTrackingWidget = tw;
  }

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
    spendSummary: getFlag(values, "summary"),
  };

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
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values["help"]) {
    console.log(
      `glw spend <iid> <dur> [--summary <s>]\n\nLog time spent. E.g.: glw spend 42 1h30m --summary "code review"`
    );
    return;
  }

  const iid = positionals[0];
  const dur = positionals[1];
  if (!iid || !dur) die("Usage: glw spend <iid> <dur>");

  const config = await resolveConfig(getFlag(values, "project"));
  const item = await getWorkItemByIid(config, iid);
  const validated = validateDuration(dur);
  const summary = getFlag(values, "summary");

  await updateWorkItem(config, {
    id: item.id,
    timeTrackingWidget: {
      timelog: {
        timeSpent: validated,
        ...(summary ? { summary } : {}),
      },
    },
  });

  console.log(
    `${green("Time logged")} on ${cyan("#" + item.iid)}: ${bold(validated)}`
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
    "init", "config", "global", "whoami", "projects", "use", "search", "create", "list",
    "view", "update", "comment", "close", "reopen", "estimate", "spend", "completion",
    // aliases
    "i", "cfg", "s", "p", "co", "cr", "u", "v", "l", "ls",
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

      case "search":
        await cmdSearch(rest);
        break;

      case "create":
        await cmdCreate(rest);
        break;

      case "list":
        await cmdList(rest);
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
