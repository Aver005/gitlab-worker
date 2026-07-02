# CLAUDE.md

`glw` — терминальный CLI для работы с задачами GitLab (work items) через GraphQL API. Bun + TypeScript, **ноль runtime-зависимостей** — это инвариант: Bun исполняет TS нативно, флаги парсятся `node:util parseArgs`, HTTP — встроенный `fetch`. Не добавляй npm-зависимости.

## Обязательные проверки перед завершением любой задачи

```bash
bun run check   # tsc --noEmit — должен быть чистым
bun test        # все тесты зелёные, тесты не ходят в сеть
```

## ⚠️ Живой токен в рабочей директории

`.env` в корне может содержать **реальный** GitLab-токен, и любая команда `glw` (кроме `--help`) ударит по живому серверу. Во время разработки:

- `bun run src/index.ts <cmd> --help` — безопасно (help возвращается до загрузки конфига);
- **никогда** не запускай мутирующие команды (`create`, `update`, `close`, `comment`, `spend`, `estimate`) для проверки кода;
- читающие (`whoami`, `list`, `projects`) — только если это явно нужно и пользователь в курсе.

## Карта модулей

| Файл | Ответственность |
|---|---|
| `src/index.ts` | Диспетчер команд, алиасы, парсинг флагов, интерактив (confirm, пейджер) |
| `src/api.ts` | Все GraphQL-операции и резолверы имён → gid (labels/users/statuses/types/projects) с per-process кешами; чистые функции `pickProject`, `matchesSearch` |
| `src/gql.ts` | GraphQL-клиент: POST `{url}/api/graphql`, `Authorization: Bearer` |
| `src/config.ts` | Конфиг: `process.env` > локальный `.env` > локальный `glw.config.json` > глобальные `.env`/`glw.config.json` из `globalDir()` (`%APPDATA%/glw`, POSIX `~/.config/glw`) — глобальный слой активен только при `glw global on` (`settings.json` там же); `loadConfig(override?, requireProject)` |
| `src/inputfile.ts` | Парсинг md/txt/json файлов задач, мини-YAML frontmatter |
| `src/format.ts` | ANSI-цвета (NO_COLOR/TTY-aware), `isOpenState`, `secondsToHuman`, `chunk` |
| `src/cache.ts` | Кеш путей проектов `<globalDir>/projects.json` для shell-автокомплита (читает и легаси `~/.glw/`; best-effort, ошибки записи молча глотаются) |

## Неочевидные инварианты GitLab GraphQL (не ломай)

- Используется **только GraphQL Work Items API** (`workItemCreate`/`workItemUpdate`) — статусы задач (To do / In progress / Done) существуют только там, в REST v4 их нет. Не переводи на REST.
- Аргумент `state` в списках — enum `IssuableState` с **lowercase**-значениями (`opened`/`closed`); а вот `WorkItem.state` в ответах — `OPEN`/`CLOSED`. Сравнивай через `isOpenState`.
- `WorkItemUpdateInput.labelsWidget` умеет только `addLabelIds`/`removeLabelIds` — операция «установить метки» реализована как диff с текущими.
- `--estimate` и `--spend` в одном вызове должны попадать в **один** объект `timeTrackingWidget` (см. `buildUpdateInput`), иначе одно затрёт другое.
- Резолв статуса: сначала список с сервера (могут быть кастомные), затем фолбэк на системные gid `gid://gitlab/WorkItems::Statuses::SystemDefined::Status/1..5` (To do, In progress, Done, Won't do, Duplicate).
- `iids` в GraphQL-запросах — массив **строк**.
- В create-input включаются только те виджеты, которые пользователь реально задал.

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
