# glw — intent → command cookbook (RU + EN)

Maps natural-language requests (Russian and English) to exact `glw` invocations.
`<iid>` = issue number; get it via `search`/`list` if the user gave content, not
a number. All bulk-by-filter operations follow the preview→confirm→`--yes`
protocol in SKILL.md. Example projects are fictional (`acme/...`).

Reminder: agents are non-TTY. Filter-based `update`/`close` REQUIRE `--yes`
(after previewing). `update --dry-run` previews; `close` has no dry-run — preview
with `search`/`list --json`.

---

## Discovery / setup

| Request (RU / EN) | Command |
|---|---|
| "кто я", "who am I", "проверь авторизацию" | `glw whoami --json` |
| "покажи мои проекты", "list projects" | `glw projects` |
| "найди проект backend", "find project backend" | `glw projects --search backend --json` |
| "переключись на проект backend-api", "use project X" | `glw use backend-api` |
| "задай токен", "set token" | `glw init <token>` (writes `.env`) |

## Viewing / searching

| Request | Command |
|---|---|
| "покажи задачу 42", "show issue 42" | `glw view 42 --json` |
| "мои открытые задачи", "my open issues" | `glw list --assignee @me --json` |
| "все закрытые задачи", "closed issues" | `glw list --state closed --json` |
| "найди задачи про авторизацию", "search auth" | `glw search "authentication" --json` |
| "задачи с 'refactor:' в названии", "titled refactor:" | `glw search --name "refactor:" --json` |
| "задачи с JWT в описании" | `glw search --body "JWT" --json` |
| "задачи начиная с 2026-01-01" | `glw search --start_time 2026-01-01 --json` |
| "задачи с меткой bug на мне" | `glw list --label bug --assignee @me --json` |
| "найди среди всех (вкл. закрытые)" | add `--state all` |

## Creating

| Request | Command |
|---|---|
| "создай задачу из issue.md", "create from file" | `glw create issue.md --json` |
| "...и назначь на меня" | `glw create issue.md --assignee @me --json` |
| "...с меткой urgent и весом 5" | `glw create issue.md --label urgent --weight 5 --json` |
| "...оценка 2 часа, дедлайн 31 июля" | `glw create issue.md --estimate 2h --due 2026-07-31 --json` |
| "...в статусе In progress" | `glw create issue.md --status "In progress" --json` |
| "...в другом проекте acme/web" | `glw create issue.md --project acme/web --json` |
| "создай конфиденциальную задачу" | `glw create issue.md --confidential --json` |

If the user provides issue text inline rather than a file, write it to a temp
`.md` (with frontmatter for structured fields) in the scratchpad, then
`glw create <that-file>`.

## Editing single issue

| Request | Command |
|---|---|
| "смени статус 42 на In progress" | `glw update 42 --status "In progress" --yes` |
| "назначь 42 на меня" | `glw update 42 --assignee @me --yes` |
| "назначь 42 на alice" | `glw update 42 --assignee alice --yes` |
| "убери исполнителя у 42" | `glw update 42 --assignee none --yes` |
| "добавь метку bug к 42" | `glw update 42 --add-label bug --yes` |
| "убери метку in-progress у 42" | `glw update 42 --remove-label in-progress --yes` |
| "поставь метки bug,v2 (заменив все)" | `glw update 42 --labels "bug,v2" --yes` |
| "вес 5 у 42" | `glw update 42 --weight 5 --yes` |
| "убери вес у 42" | `glw update 42 --weight none --yes` |
| "дедлайн 42 = 1 августа" | `glw update 42 --due 2026-08-01 --yes` |
| "убери дедлайн и дату старта у 42" | `glw update 42 --due none --start none --yes` |
| "переименуй 42" | `glw update 42 --title "New title" --yes` |
| "замени описание 42 из файла" | `glw update 42 --body-file body.md --yes` |

## Editing multiple explicit issues

| Request | Command |
|---|---|
| "метка bug и вес 5 задачам 42,43,44" | `glw update 42 43 44 --add-label bug --weight 5 --yes` |
| "переоткрой 42,43" | `glw reopen 42 43` |

## Bulk by filter (PREVIEW FIRST)

| Request | Preview | Execute |
|---|---|---|
| "все задачи с 'refactor:' в названии → In Progress" | `glw update --search "refactor:" --status "In progress" --dry-run` | same, `--dry-run`→`--yes` |
| "закрой все задачи на мне" | `glw list --assignee @me --state opened --json` | `glw close --filter-assignee @me --yes` |
| "закрой все задачи с меткой obsolete" | `glw search --name "" ...` → better: `glw list --label obsolete --json` | `glw close --filter-label obsolete --yes` |
| "назначь все задачи с меткой backend на alice" | `glw update --filter-label backend --assignee alice --dry-run` | swap to `--yes` |
| "проставь вес 3 всем задачам про 'db'" | `glw update --search "db" --weight 3 --dry-run` | swap to `--yes` |
| "закрой все с комментарием" | `glw list --filter... --json` (preview) | `glw close --filter-label X --comment "..." --yes` |

## Comments

| Request | Command |
|---|---|
| "прокомментируй 42: ..." | `glw comment 42 "..."` |
| "добавь комментарий из файла" | `glw comment 42 --file notes.txt` |
| "внутренняя заметка к 42" | `glw comment 42 "..." --internal` |

## Time tracking

| Request | Command |
|---|---|
| "оценка 2 часа на 42" | `glw estimate 42 2h` |
| "оценка 1ч30м на 42" | `glw estimate 42 1h30m` |
| "залогируй 1 час на 42" | `glw spend 42 1h` |
| "залогируй 30м с описанием code review" | `glw spend 42 30m --summary "code review"` |
| "оценка 3 дня" | `glw estimate 42 3d` |

## Closing / reopening single

| Request | Command |
|---|---|
| "закрой 42" | `glw close 42` |
| "закрой 42 с комментом" | `glw close 42 --comment "Done in MR !123"` |
| "переоткрой 42" | `glw reopen 42` |

---

## Multi-step scenarios

**"Создай задачу, назначь на меня, поставь оценку 4ч и переведи в In Progress"**
1. `glw create issue.md --assignee @me --status "In progress" --estimate 4h --json`
2. Read `iid`/`webUrl` from JSON, report to user.
   (If a field can't be set at create time, follow up: `glw estimate <iid> 4h`,
   `glw update <iid> --status "In progress" --yes`.)

**"Найди задачу про логин и добавь к ней метку auth"**
1. `glw search "login" --json` → pick the intended node, read its `iid`.
2. If several match, show them and ask which. Then:
   `glw update <iid> --add-label auth --yes`.

**"Закрой все мои задачи со статусом Done"**
1. Preview: `glw list --assignee @me --state opened --json`, filter client-side
   for a `STATUS` widget `status.name == "Done"`; show matched iids.
2. There is no `--filter-status`; close by explicit iids:
   `glw close <iid1> <iid2> ... --yes` (iids are already scoped, but still pass
   `--yes` for non-TTY).

**"Перенеси все задачи с меткой sprint-1 на sprint-2"**
1. Preview: `glw update --filter-label sprint-1 --add-label sprint-2 --remove-label sprint-1 --dry-run`.
2. Report count/list; on confirm swap `--dry-run` → `--yes`.

**"Оцени все refactor-задачи в 2 часа и переведи в In Progress"**
1. `glw update --search "refactor" --estimate 2h --status "In progress" --dry-run`
2. Report; then swap to `--yes`.

---

## Русские названия статусов → флаг

Пользователь часто пишет статус по-русски. Сопоставление к системным именам:

| Говорит пользователь | `--status` |
|---|---|
| "в работу", "в процессе", "начать" | `"In progress"` |
| "к выполнению", "в бэклог", "todo" | `"To do"` |
| "готово", "выполнено", "закрыто как done" | `"Done"` |
| "не будем делать", "отклонить" | `"Won't do"` |
| "дубликат" | `"Duplicate"` |

If the project defines custom statuses, a wrong name prints
`Status "<x>" not found. Available: <list>` — re-run with an exact name from
that list.
