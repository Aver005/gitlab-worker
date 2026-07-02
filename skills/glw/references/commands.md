# glw — complete command & flag reference

Derived verbatim from `glw <cmd> --help` and `src/`. Every flag here exists in
the CLI. Global flags (where supported): `--project <ref>`, `--json`,
`--help`/`-h`. Example project paths are fictional (`acme/...`,
`gitlab.example.com`).

Config priority: `--project` flag > env (`GITLAB_URL`, `GITLAB_TOKEN`,
`GITLAB_PROJECT`) > `.env` in cwd > `glw.config.json`. `NO_COLOR` disables color.

---

## init — `glw init [token]` (alias `i`)

Creates `glw.config.json` template in cwd (left untouched if it already exists).
If a token arg is given, writes `GITLAB_TOKEN=<token>` to `.env` in cwd (creates
or replaces the line) and prints the masked token (first 8 chars + `...`). No
network. Does NOT require a configured project.

```bash
glw init                       # create config template only
glw init glpat-xxxxxxxxxxxx     # also write token to .env
```

`glw.config.json` shape:
```json
{ "url": "https://gitlab.example.com", "project": "acme/backend-api", "tokenEnv": "GITLAB_TOKEN" }
```

---

## whoami — `glw whoami [--json]`

Shows the authenticated user. No project required. JSON: `{"id","username","name"}`.

```bash
glw whoami
glw whoami --json
```

---

## projects — `glw projects [flags]` (alias `p`)

Lists projects you are a member of (id, full path, name). Current project marked
`*`. Caches paths to `~/.glw/projects.json` on success. No project required.

| Flag | Default | Meaning |
|---|---|---|
| `--search <q>` | — | filter by name |
| `--limit <n>` | 100 | max total to fetch |
| `--per-page <n>` | 30 | page size for interactive paging |
| `--sort az\|za` | az | sort by fullPath (also accepts asc/desc) |
| `--paginate` | — | force interactive paging (TTY only) |
| `--no-paginate` | — | disable paging |
| `--json` | — | JSON array; never paginates |

```bash
glw projects
glw projects --search backend --json
glw projects --limit 200 --sort za --no-paginate
```

---

## use — `glw use <project>`

Sets the default project, saved to `glw.config.json`. `<project>` = full path or
unique short name. No alias.

```bash
glw use backend-api
glw use acme/internal/backend-api
```

---

## search — `glw search [text] [flags]` (alias `s`)

Searches work items; **at least one filter required**. Multiple filters combine
with AND.

| Arg/Flag | Default | Meaning |
|---|---|---|
| `text` (positional) | — | title AND description contains |
| `--name <q>` | — | title contains (case-insensitive) |
| `--body <q>` | — | description contains (case-insensitive) |
| `--start_time <d>` / `--start <d>` | — | start date >= YYYY-MM-DD |
| `--state opened\|closed\|all` | opened | state filter |
| `--limit <n>` | 200 | max items to fetch |
| `--project <ref>` | — | override project |
| `--json` | — | JSON array output |

```bash
glw search "authentication"
glw search --name "auth" --body "JWT"
glw s --start_time 2026-01-01 --state all
glw search --name "refactor:" --limit 50 --json
```

---

## list — `glw list [flags]` (alias `l`, `ls`)

| Flag | Default | Meaning |
|---|---|---|
| `--state opened\|closed\|all` | opened | state filter |
| `--search <q>` | — | search query |
| `--assignee <u>` | — | filter by assignee (client-side; `@me` allowed) |
| `--label <l>` | — | filter by label (client-side) |
| `--limit <n>` | 50 | max results |
| `--project <path>` | — | override project |
| `--json` | — | JSON array output |

```bash
glw list
glw list --state all --search "refactor"
glw list --assignee @me --label bug --json
glw list --state closed --limit 100
```

---

## view — `glw view <iid> [--json] [--project <path>]` (alias `v`)

Shows one work item. JSON = single node with `widgets`.

```bash
glw view 42
glw view 42 --json
```

---

## create — `glw create <file> [flags]` (alias `cr`)

Creates a work item from `.md`, `.txt`, or `.json`. Flags override file
frontmatter/fields.

| Flag | Meaning |
|---|---|
| `--title <t>` | set/override title |
| `--label <l>` | add label (repeatable) |
| `--labels <csv>` | set labels as comma-separated list |
| `--assignee <u>` | assign (username or `@me`) |
| `--weight <n>` | set weight |
| `--start YYYY-MM-DD` | start date |
| `--due YYYY-MM-DD` | due date |
| `--estimate <dur>` | time estimate (e.g. `2h`) |
| `--status <name>` | status (e.g. `"In progress"`) |
| `--confidential` | mark confidential |
| `--type <name>` | work item type (default `Issue`) |
| `--project <path>` | override project |
| `--json` | JSON of created item |

**Input file — MD/txt frontmatter** (optional block between `---` lines). Keys:
`title`, `labels`, `assignees`/`assignee`, `weight`, `estimate`,
`start`/`start_date`, `due`/`due_date`, `status`, `confidential`, `type`. If the
frontmatter contains **none** of these keys (e.g. a GitLab template with
`name:`/`about:`), the entire file including `---` is treated as the body.

```markdown
---
title: Implement authorization
labels: backend, security
assignee: johndoe
weight: 8
estimate: 3h
due: 2026-07-31
status: To do
---

## Description
Implement JWT authorization.
```

**Input file — JSON**:
```json
{
  "title": "Task name", "description": "Body",
  "labels": ["bug","v2"], "assignees": ["alice"],
  "weight": 5, "estimate": "2h",
  "start": "2026-07-01", "due": "2026-07-31",
  "status": "To do", "type": "Issue"
}
```

```bash
glw create issue.md
glw create issue.md --title "Other title" --assignee @me --label urgent
glw create issue.json --project acme/other-project --json
```

---

## update — `glw update [iid...] [selection] [fields] [--yes] [--dry-run]` (alias `u`)

Updates one or more work items. **Selection** = positional iids OR filters.
**Fields** are what to change.

Selection:
| Flag | Meaning |
|---|---|
| positional `iid...` | specific issues |
| `--search <q>` | filter by search query |
| `--filter-assignee <u>` | filter by assignee |
| `--filter-label <l>` | filter by label |
| `--state <s>` | state filter (default opened) |

Field flags:
| Flag | Meaning |
|---|---|
| `--title <t>` | set title |
| `--body <text>` | set description |
| `--body-file <f>` | set description from file |
| `--status <name>` | set status |
| `--assignee <u\|none>` | set assignee (username, `@me`, or `none` to clear) |
| `--labels <csv>` | **set** labels, replacing all |
| `--add-label <l>` | add label (repeatable) |
| `--remove-label <l>` | remove label (repeatable) |
| `--weight <n\|none>` | set weight, or `none` to clear |
| `--start <date\|none>` | start date, or `none` to clear |
| `--due <date\|none>` | due date, or `none` to clear |
| `--estimate <dur>` | set time estimate |
| `--spend <dur>` | log time spent |
| `--summary <s>` | summary for the time log |
| `--yes` | skip confirmation (REQUIRED non-TTY on filter selection) |
| `--dry-run` | preview matched items; make no changes |
| `--project <path>` | override project |

Do NOT combine `--labels` (set) with `--add-label`/`--remove-label`.

```bash
glw update 42 --status "In progress" --assignee @me --yes
glw update 42 43 44 --add-label bug --weight 5 --yes
glw update --search "refactor:" --status "In progress" --dry-run   # preview
glw update --search "refactor:" --status "In progress" --yes       # execute
glw update 42 --add-label "ready for review" --remove-label in-progress --yes
glw update 42 --due 2026-08-01 --start 2026-07-15 --yes
glw update 42 --weight none --assignee none --yes
```

---

## close — `glw close [iid...] [selection] [--comment <text>] [--yes]`

Closes work items. Selection (when no iids): `--search <q>`,
`--filter-assignee <u>`, `--filter-label <l>`, `--state <s>` (default opened).
Options: `--comment "<text>"` (added before closing), `--yes`. **No `--dry-run`**
— preview a filter with `search`/`list --json` first.

```bash
glw close 42
glw close 42 --comment "Done in MR !123"
glw close --filter-assignee @me --yes
glw close --filter-label obsolete --yes
```

---

## reopen — `glw reopen <iid...> [--project <path>]`

Reopens closed work items. iids only (no filter selection).

```bash
glw reopen 42
glw reopen 42 43 44
```

---

## comment — `glw comment <iid> [text] [--file <f>] [--internal]` (alias `co`)

Adds a comment. Body from positional `text` or `--file`. `--internal` = internal
(confidential) note.

```bash
glw comment 42 "Verified, works correctly"
glw comment 42 --file notes.txt
glw comment 42 "Internal remark" --internal
```

---

## estimate — `glw estimate <iid> <dur>`

Sets the time estimate.

```bash
glw estimate 42 2h
glw estimate 42 1h30m
glw estimate 42 3d
```

---

## spend — `glw spend <iid> <dur> [--summary <s>]`

Logs time spent.

```bash
glw spend 42 1h
glw spend 42 30m --summary "code review"
```

---

## completion — `glw completion <shell>`

Prints a shell completion script. `<shell>` = `bash` | `zsh` | `powershell`.
With no argument or `--help`, prints setup instructions.

```bash
glw completion bash
glw completion powershell
```

---

## Durations & statuses

- **Duration** (estimate/spend/`--estimate`/`--spend`): `\d+[wdhm]` combinations —
  `2h`, `30m`, `1h30m`, `3d`, `1w2d3h`. Bad input →
  `Invalid duration "<x>". Use format like "2h", "1h30m", "3d", "1w2d3h"`.
- **System statuses**: `To do`, `In progress`, `Done`, `Won't do`, `Duplicate`
  (case-insensitive; `wont do` also maps to Won't do). Projects may define
  custom statuses; the server list takes precedence. Bad name →
  `Status "<x>" not found. Available: <list>` — pick from that list.
