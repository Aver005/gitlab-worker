---
name: glw
description: >-
  Operate the `glw` GitLab work-items CLI to manage issues/work items from
  natural-language requests: create/view/update/close/reopen issues, set
  status/assignee/labels/weight/dates, add comments, track time
  (estimate/spend), search and bulk-edit by filter, and switch projects. Use
  whenever the user wants to manage GitLab issues or work items, create/update/
  close issues, do time tracking, run bulk issue operations, or explicitly says
  "через glw" / "using glw".
---

# glw — GitLab Work Items CLI

`glw` manages GitLab **work items** (issues) via the GraphQL API. Bun runtime,
Windows/POSIX. You translate a user's natural-language request into exact `glw`
commands, preview any bulk change, execute, and report results.

## Invocation

Preferred: `glw <command> [flags]` (if linked via `bun link`).
Fallback if `glw` is not on PATH: `bun run src/index.ts <command> [flags]` from
the repo root. Everything below uses `glw`; substitute the fallback verbatim.

Aliases: `i`=init, `cfg`=config, `s`=search, `p`=projects, `l`/`ls`=list,
`v`=view, `cr`=create, `u`=update, `co`=comment. (`use` has no alias.)

## 1. Preflight (run once per session before mutations)

Do these in order. Stop and ask the user only if a step fails and you cannot
self-correct.

1. **Tool available** — `glw --help`. If "command not found", switch to
   `bun run src/index.ts --help` from the repo root for all subsequent calls.
2. **Auth** — `glw whoami --json`. Success prints `{"id","username","name"}`;
   note the username (used for "me"/"на мне"). Failure → see auth errors below.
3. **Project set** — only needed for project-scoped commands (everything except
   `whoami`, `projects`, `use`, `init`, `completion`). A quick probe:
   `glw list --limit 1 --json`. If it errors with "GitLab project not
   configured", resolve the project (see below) before proceeding.

### Config / auth error messages and fixes

The CLI reads config in priority order: `--project` flag > env
(`GITLAB_URL`/`GITLAB_TOKEN`/`GITLAB_PROJECT`) > `.env` in cwd >
`glw.config.json` in cwd > global `.env`/`glw.config.json` from `%APPDATA%/glw`
(POSIX: `~/.config/glw`) — the global layer applies only when enabled via
`glw global on` (check: `glw global status`). Exact errors:

Inspect the effective config safely (no network, never throws):
`glw config` (alias `cfg`) — shows url/project/tokenEnv/masked token/global
mode. Individual values: `glw config url`, etc.

- `GitLab URL not configured.` → ask the user for the URL, then
  `glw config url <url>`. Do not guess a URL.
- `GitLab access token not configured.` → user runs `glw config token <token>`
  or `glw init <token>` (both write `GITLAB_TOKEN` to `.env`). Never fabricate
  a token.
- `GitLab project not configured.` → run `glw projects` to list, then
  `glw use <name>` to persist, or pass `--project <ref>` per command.

## 2. CRITICAL agent gotcha — non-TTY auto-declines confirmation

The interactive confirmation prompt returns **false when stdin is not a TTY**
(`if (!process.stdin.isTTY) return false`). Agents run non-TTY, so any
`update`/`close` **by selection filter** (no explicit iids) will silently abort
("Aborted.") unless you pass `--yes`.

Protocol — never `--yes` blindly on an unpreviewed filter:

- **`update` by filter**: first run the *identical* command with `--dry-run`
  (no `--yes`). It prints the matched items without changing anything. Show the
  user the count + list. Then re-run replacing `--dry-run` with `--yes`.
- **`close` by filter**: `--dry-run` is NOT a close flag. Preview by running the
  equivalent `glw search`/`glw list --json` with the same filter first, show the
  matched items, then run `glw close ... --yes`.
- **Explicit iids** (`glw update 42 43 ...`, `glw close 42`): still prompt-gated
  when >0 items, so pass `--yes` for non-interactive runs. These are already
  scoped, so no separate preview is required beyond confirming the iids.

## 3. Output parsing — use `--json`, never scrape human output

For anything you must reason over (counts, iids, statuses, assignees), pass
`--json`. Human output is colored and for showing the user only; do not parse
it. Supported on: `whoami`, `projects`, `search`, `list`, `view`, `create`.

JSON shape (verified against `src/api.ts`):

- `list`/`search` → a JSON **array** of work-item nodes. `view`/`create` → a
  single node.
- Node top-level: `{ "id", "iid", "title", "state", "webUrl", "widgets": [...] }`.
  **`iid` is a string** (e.g. `"42"`); `state` is `"opened"`/`"closed"`.
- Fields live in the `widgets` array, each keyed by `type`:
  - `DESCRIPTION` → `description`
  - `ASSIGNEES` → `assignees.nodes[]` (`{id,username,name}`)
  - `LABELS` → `labels.nodes[]` (`{id,title}`)
  - `STATUS` → `status` (`{id,name}` or `null`)
  - `WEIGHT` → `weight` (number or `null`)
  - `START_AND_DUE_DATE` → `startDate`, `dueDate` (or `null`)
  - `TIME_TRACKING` → `timeEstimate`, `totalTimeSpent` (seconds)

To get an assignee's username: find the widget with `type == "ASSIGNEES"`, read
`assignees.nodes[0].username`. `whoami --json` → `{id,username,name}`.

## 4. Intent → command mapping (canonical)

Full flag reference: `references/commands.md`. Intent cookbook (RU+EN phrasings):
`references/recipes.md`. Summary:

- **Create from file**: `glw create <file>` (.md/.txt/.json). MD/txt supports a
  YAML frontmatter block between `---` lines with keys: `title`, `labels`,
  `assignees`/`assignee`, `weight`, `estimate`, `start`/`start_date`,
  `due`/`due_date`, `status`, `confidential`, `type`. If frontmatter has none of
  these keys, the whole file (incl. `---`) is treated as the body. Flags
  override frontmatter: `--title --label(repeatable) --labels(csv) --assignee
  --weight --start --due --estimate --status --confidential --type`.
- **Edit fields** (`glw update`): `--title --body --body-file --status
  --assignee --labels(set,csv) --add-label(repeatable) --remove-label
  --weight --start --due --estimate --spend --summary`. Clear a field with the
  literal `none`: `--assignee none`, `--weight none`, `--start none`,
  `--due none`.
- **Comment**: `glw comment <iid> "text"` or `--file <f>`; `--internal` for a
  confidential note.
- **Close/reopen**: `glw close <iid...>` (optional `--comment "..."`);
  `glw reopen <iid...>`.
- **Search** (≥1 filter required): positional `text` = title AND description;
  `--name` title-only; `--body` description-only; `--start_time`/`--start`
  `YYYY-MM-DD` >=; multiple filters combine with **AND**; `--state
  opened|closed|all` (default opened); `--limit` (default 200).
- **List**: `--state --search --assignee --label --limit`(default 50).
- **Projects**: `glw projects [--search]` to discover; `glw use <name>` to set
  default; `--project <ref>` per command. `<ref>` = full `group/project` path
  or a unique short name.
- **Statuses**: system names are `To do`, `In progress`, `Done`, `Won't do`,
  `Duplicate` (case-insensitive; server may define custom ones). Quote names
  with spaces.
- **Duration** format (estimate/spend): `\d+[wdhm]` combos — `2h`, `30m`,
  `1h30m`, `3d`, `1w2d3h`.
- **Time tracking**: `glw estimate <iid> <dur>`; `glw spend <iid> <dur>
  [--summary "..."]`. Also settable via `update --estimate`/`--spend`.

## 5. Bulk operation protocol (imperative)

1. **Resolve scope.** If the user named issues by content/attribute, do NOT
   guess iids — build a selection filter or `search` first.
2. **Preview.** `update`→ run with `--dry-run`. `close`→ run
   `search`/`list --json` with the same filter. Never skip.
3. **Report to user** the matched **count** and a short list (iid + title).
4. **Sanity gate.** If the count is 0, or surprisingly large (e.g. a filter you
   expected to match a handful returns dozens), STOP and ask the user to confirm
   before mutating.
5. **Execute** the identical filter with `--yes` (for `update`, swap `--dry-run`
   for `--yes`).
6. **Report results per item.** The CLI continues past a per-item failure and
   prints `Failed #<iid>: <msg>`, then **exits non-zero** if any failed. Surface
   which succeeded and which failed; a non-zero exit with some successes is
   partial success, not total failure.

## 6. Error recovery

| Symptom (exact text fragment) | Cause | Action |
|---|---|---|
| `Project "<x>" is ambiguous. Matches:` + list | short name matches many | pick the intended full path from the list; if unclear, ask user; re-run with that path via `--project`/`use` |
| `No project matching "<x>" found among your memberships` | typo / not a member | run `glw projects --search <x>`; suggest correct name or ask |
| `Project not found: "<path>"` | wrong path or token access | verify path; check token scope |
| `Status "<x>" not found. Available: <list>` | bad status name | pick from the printed Available list (re-use exact casing) |
| `Unknown label(s): <names>` | label doesn't exist in project | there is NO "list labels" command; try different casing, or tell the user the label doesn't exist and ask them to create it in GitLab or supply the exact name |
| `User not found: "<u>"` | bad username | confirm username; `@me` for self |
| `Invalid duration "<x>". Use format like "2h"...` | bad duration | reformat to `\d+[wdhm]` |
| `Issue #<n> not found in project "<p>"` | wrong iid/project | `search` to find the real iid |
| `GitLab GraphQL error:` / `GitLab API error` / HTTP | server/auth/network | re-check token & url; report the message to user; do not retry blindly |
| `Aborted.` after a filter update | non-TTY declined confirm | you forgot `--yes` (after previewing) — re-run with it |

## 7. Anti-patterns (do not)

- Do **not** invent flags. Every flag must appear in `--help`/`commands.md`.
- Do **not** fall back to `glab`, raw GraphQL/REST `curl`, or `git` — only `glw`.
- Do **not** guess iids — `search`/`list` first.
- Do **not** run a bulk mutation without a preview.
- Do **not** parse colored human output — use `--json`.
- Do **not** combine `--labels` (set) with `--add-label`/`--remove-label` in one
  `update` call; pick set-mode OR add/remove-mode.
- Do **not** pass `--yes` to a filter you have not previewed.
- Do **not** run `glw init` casually — with a token arg it writes `.env`.

## 8. Worked examples (RU request → command sequence → report)

**A. "поменяй статус у всех задач с 'refactor:' в названии на In Progress"**
1. Preview: `glw update --search "refactor:" --status "In progress" --dry-run`
2. Report matched count + iids/titles to user.
3. Execute: `glw update --search "refactor:" --status "In progress" --yes`
4. Report per-item success/failure; note non-zero exit if any `Failed #`.

**B. "закрой все задачи на мне"**
1. `glw whoami --json` → get username (or use `@me`).
2. Preview: `glw list --assignee @me --state opened --json` → show count + list.
3. If count sane: `glw close --filter-assignee @me --yes`.
4. Report closed iids and any failures.

**C. "создай задачу из issue.md и поставь оценку 2 часа, назначь на меня"**
1. `glw create issue.md --assignee @me --estimate 2h --json`
2. Read `iid`/`webUrl` from JSON; report the new issue to the user.
   (If estimate must be separate: `glw estimate <iid> 2h`.)

**D. "добавь метку bug задачам 42, 43, 44 и вес 5"**
1. `glw update 42 43 44 --add-label bug --weight 5 --yes`
2. Report results per iid.

**E. "залогируй 1ч30м на задачу 42 с описанием code review"**
1. `glw spend 42 1h30m --summary "code review"`
2. Confirm logged.

**F. "убери исполнителя и дедлайн у задачи 42"**
1. `glw update 42 --assignee none --due none --yes`
2. Confirm cleared.
