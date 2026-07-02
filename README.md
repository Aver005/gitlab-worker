# glw — GitLab Work Items CLI

CLI-инструмент для управления задачами (work items) в GitLab через GraphQL API. Требует Bun v1.3+.

## Установка

```bash
# Клонировать или разместить в удобной директории, затем:
bun install

# Вариант 1: глобальная ссылка (рекомендуется)
bun link

# Вариант 2: запуск напрямую
bun run src/index.ts <команда>
```

## Настройка

### 1. Создать конфиг-файл и задать токен

```bash
# Создать glw.config.json и записать токен в .env одной командой:
glw init glpat-xxxxxxxxxxxxxxxx

# Или только создать конфиг (токен задать вручную позже):
glw init
```

Команда `glw init [token]`:
- Создаёт `glw.config.json` в текущей директории (если файл уже есть — оставляет нетронутым).
- Если передан токен — записывает `GITLAB_TOKEN=<token>` в файл `.env` в текущей директории (создаёт файл, если нет; заменяет существующую строку).
- Выводит замаскированный токен: первые 8 символов + `...`.

Пример `glw.config.json`:

```json
{
  "url": "https://gitlab.example.com",
  "project": "namespace/project-name",
  "tokenEnv": "GITLAB_TOKEN"
}
```

### 2. Создать Personal Access Token

Откройте в браузере:
```
https://ваш-gitlab/-/user_settings/personal_access_tokens
```

Создайте токен с областью доступа **`api`**.

### 3. Установить токен

Быстрый способ — через `glw init`:

```bash
glw init glpat-xxxxxxxxxxxxxxxx
```

Или вручную задать переменную окружения:

```bash
export GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxx"
```

Или добавить в `.env` в текущей директории:

```
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxx
```

### Приоритет параметров

1. Флаг `--project` (наивысший приоритет)
2. Переменные окружения (`GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_PROJECT`)
3. Файл `.env` в текущей директории
4. `glw.config.json`

Проект не обязательно вписывать руками: `glw projects` покажет доступные, `glw use <имя>` сохранит выбранный в конфиг.

## Алиасы команд

| Алиас | Команда  |
|-------|----------|
| `i`   | `init`   |
| `s`   | `search` |
| `p`   | `projects` |
| `l`, `ls` | `list` |
| `v`   | `view`   |
| `cr`  | `create` |
| `u`   | `update` |
| `co`  | `comment` |

Команда `use` не имеет однобуквенного алиаса (`u` занята командой `update`).

## Автодополнение в шелле

### Bash

```bash
# Добавить в ~/.bashrc:
eval "$(glw completion bash)"
```

### Zsh

```bash
# Добавить в ~/.zshrc:
eval "$(glw completion zsh)"
```

### PowerShell

```powershell
# Добавить в $PROFILE:
glw completion powershell | Out-String | Invoke-Expression
```

Автодополнение поддерживает: имена команд и алиасов (первое слово), пути к проектам после `use` и `--project` (из локального кэша `~/.glw/projects.json`).

Кэш проектов обновляется автоматически при каждом успешном вызове `glw projects`.

## Команды

### `glw whoami`

Показывает текущего аутентифицированного пользователя. Не требует настроенного проекта.

```bash
glw whoami
glw whoami --json
```

### `glw projects`

Список проектов, в которых вы состоите. Текущий проект помечен `*`. После успешного запроса кэширует список путей в `~/.glw/projects.json`.

```bash
glw projects
glw projects --search backend
glw projects --json

# Пагинация и сортировка
glw projects --limit 200 --per-page 20 --sort za
glw projects --paginate          # принудительная интерактивная пагинация
glw projects --no-paginate       # вывести всё без пагинации
```

Флаги:

| Флаг | По умолчанию | Описание |
|------|-------------|----------|
| `--search <q>` | — | Фильтр по имени |
| `--limit <n>` | 100 | Максимальное количество проектов для загрузки |
| `--per-page <n>` | 30 | Размер страницы для интерактивной пагинации |
| `--sort az\|za` | `az` | Сортировка по fullPath; принимает также `asc`/`desc` |
| `--paginate` | — | Принудительная интерактивная пагинация |
| `--no-paginate` | — | Отключить пагинацию |
| `--json` | — | JSON-вывод (без пагинации) |

Интерактивная пагинация включается автоматически, если stdout является TTY и результатов больше, чем `--per-page`.

### `glw use <project>`

Устанавливает проект по умолчанию (сохраняется в `glw.config.json`). Принимает полный путь или уникальное короткое имя.

```bash
glw use backend-api
glw use acme/internal/backend-api
```

### `glw search`

Поиск задач с фильтрами. Требует хотя бы один фильтр.

```bash
# Поиск по тексту (в заголовке и описании)
glw search "authentication"
glw s "JWT"

# По заголовку
glw search --name "auth module"

# По описанию
glw search --body "JWT token"

# По дате начала
glw search --start_time 2026-01-01
glw search --start 2026-01-01   # алиас --start_time

# Комбинирование фильтров (все условия AND)
glw search --name "auth" --body "JWT" --start_time 2026-01-01

# По состоянию и с JSON-выводом
glw search "bug" --state all --json

# С лимитом
glw search --name "refactor" --limit 50
```

Флаги:

| Флаг | По умолчанию | Описание |
|------|-------------|----------|
| `text` (позиционный) | — | Поиск в заголовке и описании |
| `--name <q>` | — | Заголовок содержит строку (регистр не важен) |
| `--body <q>` | — | Описание содержит строку (регистр не важен) |
| `--start_time <d>` / `--start <d>` | — | Дата начала >= YYYY-MM-DD |
| `--state <s>` | `opened` | `opened` \| `closed` \| `all` |
| `--limit <n>` | 200 | Максимум загружаемых задач |
| `--project <ref>` | — | Переопределить проект |
| `--json` | — | JSON-вывод |

### `glw list`

Выводит список задач.

```bash
# Открытые задачи (по умолчанию)
glw list

# Все задачи с поиском
glw list --state all --search "refactor"

# Только задачи конкретного пользователя с меткой
glw list --assignee @me --label "bug"

# Закрытые, лимит 100
glw list --state closed --limit 100

# JSON-вывод
glw list --json
```

### `glw view <iid>`

Подробная информация о задаче.

```bash
glw view 42
glw view 42 --json
```

### `glw create <file>`

Создаёт задачу из файла (`.md`, `.txt`, `.json`).

**Пример файла `issue.md`:**

```markdown
---
title: Реализовать авторизацию
labels: backend, security
assignee: johndoe
weight: 8
estimate: 3h
due: 2026-07-31
status: To do
---

## Описание

Нужно реализовать JWT-авторизацию.
```

```bash
glw create issue.md

# С переопределением флагами
glw create issue.md --title "Другой заголовок" --assignee @me --label urgent

# Другой проект
glw create issue.md --project acme/other-project
```

### `glw update`

Обновляет одну или несколько задач.

```bash
# По номеру задачи
glw update 42 --status "In progress" --assignee @me

# По нескольким номерам
glw update 42 43 44 --label bug --weight 5

# По поиску — показывает совпадения и запрашивает подтверждение
glw update --search "refactor:" --status "In progress" --yes

# Изменить только метки
glw update 42 --add-label "ready for review" --remove-label "in-progress"

# Установить/снять дату
glw update 42 --due "2026-08-01" --start "2026-07-15"
glw update 42 --due none  # убрать дату

# Установить вес (или убрать)
glw update 42 --weight 5
glw update 42 --weight none

# Предварительный просмотр без применения
glw update --search "old:" --title "new title" --dry-run
```

### `glw close`

Закрывает задачи.

```bash
# По номеру
glw close 42

# С комментарием
glw close 42 --comment "Реализовано в MR !123"

# По фильтру (с подтверждением)
glw close --filter-assignee @me --yes

# Закрыть все задачи с меткой
glw close --filter-label "obsolete" --yes
```

### `glw reopen`

Переоткрывает задачи.

```bash
glw reopen 42
glw reopen 42 43 44
```

### `glw comment <iid>`

Добавляет комментарий к задаче.

```bash
# Текст в аргументе
glw comment 42 "Проверено, работает корректно"

# Из файла
glw comment 42 --file notes.txt

# Внутренняя заметка (confidential note)
glw comment 42 "Внутреннее замечание" --internal
```

### `glw estimate <iid> <dur>`

Устанавливает оценку времени.

```bash
glw estimate 42 2h
glw estimate 42 1h30m
glw estimate 42 3d
```

### `glw spend <iid> <dur>`

Логирует затраченное время.

```bash
glw spend 42 1h
glw spend 42 30m --summary "code review"
glw spend 42 2h --summary "рефакторинг контроллера"
```

### `glw completion <shell>`

Выводит скрипт автодополнения для указанного шелла.

```bash
glw completion bash
glw completion zsh
glw completion powershell
```

## Форматы продолжительности

Используются форматы GitLab: `2h`, `30m`, `1h30m`, `3d`, `1w2d3h`.

## Формат входных файлов

### Markdown / txt с YAML-фронтматтером

Опциональный блок фронтматтера между строками `---`. Поддерживаемые ключи:
`title`, `labels`, `assignees` / `assignee`, `weight`, `estimate`,
`start` / `start_date`, `due` / `due_date`, `status`, `confidential`, `type`.

Если фронтматтер не содержит ни одного из поддерживаемых ключей (например, шаблоны GitLab-ишью с `name:`, `about:`), то весь файл включая блок `---` считается телом задачи.

### JSON

```json
{
  "title": "Название задачи",
  "description": "Описание",
  "labels": ["bug", "v2"],
  "assignees": ["alice"],
  "weight": 5,
  "estimate": "2h",
  "start": "2026-07-01",
  "due": "2026-07-31",
  "status": "To do",
  "type": "Issue"
}
```

## Переменные окружения

| Переменная | Описание |
|---|---|
| `GITLAB_URL` | URL GitLab-инстанса |
| `GITLAB_TOKEN` | Personal Access Token (имя можно изменить через `tokenEnv`) |
| `GITLAB_PROJECT` | Путь к проекту (например, `group/project`) |
| `NO_COLOR` | Отключить цветной вывод |

Все переменные также можно задать в файле `.env` в текущей директории (реальные переменные окружения имеют приоритет).

## Глобальные флаги

- `--project <ref>` — переопределить проект для одной команды: полный путь (`group/project`) или уникальное короткое имя (например, `--project backend-api`)
- `--json` — машиночитаемый JSON-вывод (где поддерживается)
- `--help`, `-h` — справка по команде
