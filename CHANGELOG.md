# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

### Добавлено

- `mine` — задачи, назначенные на текущего пользователя, во всех доступных
  проектах одним запросом к серверу (`currentUser.workItems`, GitLab 17.10+).
  Не требует проекта по умолчанию; `--state`, повторяемый `--label`, `--limit`,
  `--fields`, `--json`; вывод сгруппирован по проектам
- `todos` — GitLab To-Do List: `--state pending|done|all`, `--project`,
  `--limit`, `--json` с плоскими объектами. `todos done <id...>` отмечает
  записи сделанными, `todos done --all` — все ожидающие, с подтверждением
  (`--yes` для скриптов)
- Поле `project` в `--fields` — полный путь проекта задачи

### Изменено

- `list`, `search`, `view`, `create` в `--json` отдают ещё и
  `namespace.fullPath`

## [1.2.0] — 2026-10-19

### Добавлено

- `--date YYYY-MM-DD` у `spend` и `update --spend` — списание времени задним
  числом (поле `spentAt` в `timelog`; уходит как полдень UTC, чтобы день не
  сдвигался в часовом поясе пользователя)
- Списание времени при `create`: ключи `spend`, `spend_date`, `spend_summary`
  во frontmatter и JSON, флаги `--spend`, `--date`, `--summary`. Уходит тем же
  вторым запросом, что и оценка
- `labels` — метки проекта вместе с унаследованными от групп, по алфавиту;
  `--search`, `--limit`, `--json`
- Предупреждение в stderr, если в одном наборе меток (`create`, `update
  --labels/--add-label`) две scoped-метки одной области, например
  `component::backend` и `component::frontend`: GitLab молча оставляет одну
- `create --dry-run` — итоговые поля без отправки, со списком того, что
  переопределено флагами. Метки, исполнители, статус и тип проверяются на
  сервере запросами на чтение; все ошибки (включая длительности и даты)
  выводятся разом, код выхода 1. `--json` отдаёт разобранный файл, итоговые
  поля и готовый `workItemCreateInput`
- `--fields <csv>` у `list`, `search`, `view` — плоский вывод выбранных полей
  (`iid`, `title`, `state`, `status`, `labels`, `assignees`, `weight`, `start`,
  `due`, `estimate`, `spent`, `url`, `description`, `id`): таблица или, с
  `--json`, объекты без разбора массива `widgets`
- Пакетное создание: `create a.md b.md …` или `create <каталог>` — по задаче
  на файл. Каталог берётся без подкаталогов, в естественном порядке, с
  подтверждением (`--yes` для скриптов). Ошибка в одном файле не
  останавливает остальные; в конце таблица «файл → #iid или ошибка» и код
  выхода 1 при сбоях. Работают `--dry-run` и `--json` (`[{ file, item?, error? }]`)

### Изменено

- `create --json` отдаёт полный узел задачи с виджетами (как `view --json`):
  к прежним `id/iid/title/state/webUrl` добавился массив `widgets`, так что
  метки, даты, вес и оценку можно проверить без отдельного `view`
- Предупреждение о неизвестном ключе frontmatter называет файл
- `create` проверяет всё до отправки и сообщает обо всех ошибках сразу, а не
  о первой; `--weight` должен быть целым числом, `start`/`due` — настоящей
  датой `YYYY-MM-DD`

### Исправлено

- `create` с `estimate` (во frontmatter или флагом) падал с ошибкой
  `timeTrackingWidget ... is not defined on WorkItemCreateInput`: GitLab не
  принимает учёт времени при создании. Теперь задача создаётся без оценки, а
  оценка ставится вторым запросом в той же команде. Если второй запрос не
  прошёл, команда сообщает номер созданной задачи и завершается с кодом 1

[1.2.0]: https://github.com/Aver005/gitlab-worker/releases/tag/v1.2.0

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
