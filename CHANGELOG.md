# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [1.1.0] — 2026-07-03

### Добавлено

- `link <iid> <target...>` (алиас `ln`) — связи между задачами: `related`
  (по умолчанию), `blocks`, `blocked-by`; `--remove` убирает связь. Направление —
  ОТ `<iid>` К целям. Через мутации `workItemAddLinkedItems` /
  `workItemRemoveLinkedItems`
- `parent <iid...> --to <parent-iid|none>` — иерархия: установка/смена родителя
  (и, тем самым, добавление детей эпику), `--to none` отвязывает. Через
  `hierarchyWidget` в `workItemUpdate`
- `glw view` теперь показывает родителя, детей и счётчики блокировок; `--json`
  у `view` включает виджеты `HIERARCHY` и `LINKED_ITEMS`
- `--json` у `link` и `parent` для машиночитаемого вывода
- Чистые функции `parseLinkType` / `normalizeIid` (принимает `#42` и `42`) с
  юнит-тестами

[1.1.0]: https://github.com/Aver005/gitlab-worker/releases/tag/v1.1.0

## [1.0.0] — 2026-07-02

Первый стабильный релиз ⚡

### Задачи (work items)

- `create` — создание задач из `.md` / `.txt` / `.json` с YAML-шапкой (title, labels, assignees, weight, estimate, даты, статус, confidential, type); заголовок из первого `# H1`, корректная обработка GitLab-шаблонов с `name:`/`about:`
- `list`, `view`, `search` — списки, карточка задачи, поиск по названию/описанию/дате начала с AND-комбинированием фильтров
- `update` — все поля: title, body, статус, исполнитель, метки (set/add/remove), вес, даты, время; `none` очищает поле
- `close` / `reopen` / `comment` (включая internal-заметки)
- `estimate` / `spend` — учёт времени в формате GitLab (`2h`, `1h30m`, `1w2d3h`)
- Статусы Work Items (`To do`, `In progress`, `Done`, …) через GraphQL — то, чего нет в REST API

### Массовые операции

- Выборка фильтрами: `--search`, `--filter-assignee`, `--filter-label`, `--state`
- Защита от случайностей: превью совпадений, подтверждение, `--dry-run`, `--yes` для скриптов
- Продолжение при ошибке на отдельной задаче, ненулевой код выхода

### Конфигурация

- `init [token]` — конфиг + токен в `.env` одной командой
- `config` (`cfg`) — просмотр/правка `url`, `project`, `tokenEnv`, `token` в стиле git config
- `global on|off` — общее окружение в `%APPDATA%/glw` (POSIX: `~/.config/glw`), приоритет local > global
- Слои: `--project` → env → локальный `.env` → локальный конфиг → глобальные

### Проекты и UX

- `projects` — список членств с курсорной пагинацией, сортировкой и интерактивным пейджером
- `use` — выбор проекта по полному пути или уникальному короткому имени (fuzzy-резолв)
- Алиасы: `i`, `cfg`, `s`, `p`, `l`/`ls`, `v`, `cr`, `u`, `co`
- `completion` — автодополнение для bash/zsh/PowerShell с подстановкой путей проектов
- `--json` для машиночитаемого вывода, `NO_COLOR`, дружелюбные ошибки

### Для AI-агентов

- Agent Skill в `skills/glw/` (SKILL.md + справочник команд + рецепты RU/EN): preflight-проверки, безопасный протокол массовых операций, таблица восстановления после ошибок
- Установка: `npx skills add Aver005/gitlab-worker`

### Технически

- Bun + TypeScript (strict), **ноль runtime-зависимостей**
- GitLab GraphQL Work Items API (`workItemCreate` / `workItemUpdate`)
- 66 юнит-тестов, чистая типизация

[1.0.0]: https://github.com/Aver005/gitlab-worker/releases/tag/v1.0.0
