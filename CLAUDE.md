# CLAUDE.md

`glw` — терминальный CLI для работы с задачами GitLab (work items) через GraphQL API. Bun + TypeScript, **ноль runtime-зависимостей** — это инвариант: Bun исполняет TS нативно, флаги парсятся `node:util parseArgs`, HTTP — встроенный `fetch`. Не добавляй npm-зависимости.

## Обязательные проверки перед завершением любой задачи

```bash
bun run check          # tsc --noEmit — должен быть чистым
bun run lint           # oxlint
bun run format:check   # oxfmt: 4 пробела, одинарные кавычки, ширина 80
bun test               # все тесты зелёные, тесты не ходят в сеть
```

`oxfmt`/`oxlint` — dev-зависимости; runtime по-прежнему без зависимостей. Markdown форматтер не трогает (`.oxfmtrc.json`).

## ⚠️ Живой токен в рабочей директории

`.env` в корне может содержать **реальный** GitLab-токен, и любая команда `glw` (кроме `--help`) ударит по живому серверу. Во время разработки:

- `bun run src/index.ts <cmd> --help` — безопасно (help возвращается до загрузки конфига);
- **никогда** не запускай мутирующие команды (`create`, `update`, `close`, `comment`, `spend`, `estimate`) для проверки кода;
- читающие (`whoami`, `list`, `projects`) — только если это явно нужно и пользователь в курсе.

## Карта модулей

| Где | Что |
|---|---|
| `src/index.ts` | Точка входа: `--help`, поиск команды в реестре, единственное место, где ошибка превращается в `Error: …` и код выхода 1 |
| `src/commands/` | По файлу на команду (`estimate`/`spend` — `time.ts`). `registry.ts` — список команд, из него собираются общая справка и автодополнение; новая команда добавляется только туда. `create-plan.ts`/`create-batch.ts` и `update-input.ts` — логика `create`/`update` |
| `src/cli/` | Общее для команд: `args.ts` (строгий `parseFlags`, `intFlag`, `oneOf`), `selection.ts` (iid или фильтры + превью для `update`/`close`), `output.ts` (вывод списков, `forEachItem` для пачек), `prompt.ts` (подтверждение, пейджер), `context.ts` (конфиг с `--project`) |
| `src/api/` | GraphQL: `client.ts` (`gql`, `paginate`, `optionalArgs`, `checkPayload`), `work-item.ts` (тип узла и чтение виджетов, чистые фильтры), `work-items.ts` (запросы и мутации задач), резолверы имён → gid с кешами на процесс (`labels`, `users`, `statuses`, `item-types`, `projects`), `links.ts`, `todos.ts`, `time-tracking.ts` |
| `src/config/` | `load.ts` — слои конфига: `process.env` > локальные `.env`/`glw.config.json` > глобальные из `globalDir()` (только при `glw global on`); `global.ts` — глобальная папка и режим; `dotenv.ts` — разбор и правка `.env` |
| `src/inputfile.ts` | Файлы задач md/txt/json, мини-YAML шапка |
| `src/fields.ts` | Плоский вывод `--fields` |
| `src/format.ts` | ANSI-цвета (NO_COLOR/TTY), `isOpenState`, `secondsToHuman`, `chunk` |
| `src/cache.ts` | Кеш путей проектов для автодополнения |
| `src/errors.ts` | `CliError` — ошибка пользователя без стека |

Команда не вызывает `process.exit`: сбой — `throw`, частичный сбой пачки — `process.exitCode = 1` (через `forEachItem`). Флаги разбираются строго: неизвестный флаг — ошибка до загрузки конфига.

## Неочевидные инварианты GitLab GraphQL (не ломай)

- Используется **только GraphQL Work Items API** (`workItemCreate`/`workItemUpdate`) — статусы задач (To do / In progress / Done) существуют только там, в REST v4 их нет. Не переводи на REST.
- Аргумент `state` в списках — enum `IssuableState` с **lowercase**-значениями (`opened`/`closed`); а вот `WorkItem.state` в ответах — `OPEN`/`CLOSED`. Сравнивай через `isOpenState`.
- `WorkItemUpdateInput.labelsWidget` умеет только `addLabelIds`/`removeLabelIds` — операция «установить метки» реализована как диff с текущими.
- `--estimate` и `--spend` в одном вызове должны попадать в **один** объект `timeTrackingWidget` (см. `buildTimeTrackingWidget`), иначе одно затрёт другое.
- В `WorkItemCreateInput` **нет** `timeTrackingWidget` (сервер отвечает «Field is not defined»). Оценка и списание при `create` уходят вторым запросом `workItemUpdate`; тип `WorkItemCreateInput` этого поля не содержит, чтобы ошибку нельзя было вернуть.
- Резолв статуса: сначала список с сервера (могут быть кастомные), затем фолбэк на системные gid `gid://gitlab/WorkItems::Statuses::SystemDefined::Status/1..5` (To do, In progress, Done, Won't do, Duplicate).
- `iids` в GraphQL-запросах — массив **строк**.
- В create-input включаются только те виджеты, которые пользователь реально задал.
- **Иерархия** (parent/child) задаётся через `hierarchyWidget` в `workItemUpdate`: `{ parentId }` (null очищает) на потомке или `{ childrenIds }` на родителе. **Связи** related/blocks/blocked-by — это **отдельные** мутации `workItemAddLinkedItems`/`workItemRemoveLinkedItems` (не виджет update), `linkType`-enum `RELATED`/`BLOCKS`/`BLOCKED_BY` описывает связь ОТ `id` К `workItemsIds`.
- `mine` идёт через `currentUser.workItems(assigneeUsernames: [me])` (с 17.10, помечено как Experiment) — сервер фильтрует сам, по всем проектам. Резолвер требует хотя бы один фильтр, `assigneeUsernames` его закрывает.
- `todos`: у `Todo` читай `targetEntity`, а не `target` — `target` устарел с 17.4 и может прийти `null`, хотя в схеме он ненулевой. `state` у `Issue`/`WorkItem`/`MergeRequest` — разные enum'ы, в одном выборе их нельзя смешать без алиасов (`issueState`/`workItemState`/`mrState`). `TodoStateEnum` — lowercase (`pending`/`done`).
- Виджет `LINKED_ITEMS` на этом инстансе отдаёт только счётчики (`blocked`/`blockedByCount`/`blockingCount`), без списка связанных — не полагайся на список при чтении.

## Поведенческие инварианты CLI

- Интерактивное подтверждение bulk-операций **автоматически отклоняется** при не-TTY stdin — скрипты и агенты обязаны передавать `--yes`.
- Bulk-выборка: серверные фильтры `search`/`state` + клиентская фильтрация assignee/labels (устойчивость к версиям GitLab).
- При per-item ошибке в bulk команда продолжает остальные и завершается с ненулевым кодом.
- Frontmatter в файле задачи признаётся только при наличии хотя бы одного известного ключа — иначе весь файл (включая `---`-блок GitLab-шаблона) уходит в описание. Это покрыто тестами, не упрощай.
- Глобальный режим (`glw global on`) — это **фолбэк**, а не замена: локальные `.env`/`glw.config.json` в cwd всегда приоритетнее глобальных (семантика git local > global). `glw use` пишет в глобальный конфиг только когда локального файла нет и режим включён.

## Правила репозитория

- **Никаких реальных имён компаний/инстансов** в git-видимых файлах — только плейсхолдеры `acme/...`, `gitlab.example.com`. `.dev/` (сырые перехваты API) в `.gitignore` и должен там оставаться.
- Новая чистая логика — выноси в экспортируемые чистые функции и покрывай юнит-тестами (см. `pickProject`, `matchesSearch`, `parseDotEnv`, `chunk`).
- Меняешь поверхность команд (флаги/команды) — синхронно обнови **три** места: `--help`-тексты, `README.md`, навык `skills/glw/`.
- Формат коммитов: `.trae/rules/git-commit-message.md` (Conventional Commits + emoji). Не коммить без явной просьбы.

## Документация

- `README.md` — пользовательская, на русском.
- `skills/glw/SKILL.md` — навык, обучающий агентов пользоваться `glw` (preflight, bulk-протокол, маппинг намерений на команды). Для автоподхвата Claude Code копируется в `.claude/skills/`.
