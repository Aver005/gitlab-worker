<div align="center">

# ⚡ glw

### Задачи GitLab, не выходя из терминала

Создавайте задачи из markdown-файлов, редактируйте любые поля одной строкой,<br>
ведите учёт времени и закрывайте десятки задач разом.

[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.3-f9f1e1?logo=bun&logoColor=f9f1e1&labelColor=14151a)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white&labelColor=14151a)](https://www.typescriptlang.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-22c55e?labelColor=14151a)](package.json)
[![Tests](https://img.shields.io/badge/tests-66%20passed-22c55e?labelColor=14151a)](tests)
[![GitLab GraphQL](https://img.shields.io/badge/GitLab-GraphQL%20Work%20Items-fc6d26?logo=gitlab&labelColor=14151a)](https://docs.gitlab.com/ee/api/graphql/)
[![Agent Skill](https://img.shields.io/badge/skills.sh-glw-8b5cf6?labelColor=14151a)](https://skills.sh)

[Быстрый старт](#-быстрый-старт) •
[Возможности](#-возможности) •
[Массовые операции](#-массовые-операции) •
[AI-агенты](#-для-ai-агентов) •
[Справочник](#-справочник)

</div>

---

```console
$ glw update --search "refactor:" --status "In progress" --dry-run

Found 4 work item(s):

  #38 [opened] refactor: вынести API-клиент в отдельный модуль (backend) @alice
  #41 [opened] refactor: упростить конфигурацию окружений (devops) @bob
  #45 [opened] refactor: убрать дублирование в тестах (tests)
  #47 [opened] refactor: типизация ответов GraphQL (backend) @alice

$ glw update --search "refactor:" --status "In progress" --yes
Updated #38 refactor: вынести API-клиент в отдельный модуль
Updated #41 refactor: упростить конфигурацию окружений
Updated #45 refactor: убрать дублирование в тестах
Updated #47 refactor: типизация ответов GraphQL
```

## ✨ Возможности

| | |
|---|---|
| 📝 **Задачи из markdown** | Пишете обычный `.md` с YAML-шапкой — получаете оформленную задачу |
| 🔧 **Все поля задачи** | Название, описание, статус, исполнитель, метки, вес, даты, время |
| 🔥 **Массовые операции** | Выборка фильтром → превью → одно подтверждение → готово |
| ⏱️ **Учёт времени** | `glw estimate 42 2h`, `glw spend 42 1h30m --summary "ревью"` |
| 🔍 **Умный поиск** | По названию, описанию, датам — фильтры комбинируются |
| 🌍 **Глобальное окружение** | Один конфиг в `%APPDATA%/glw` — работает из любой папки |
| ⌨️ **Автодополнение** | bash / zsh / PowerShell, включая пути проектов |
| 🤖 **Agent Skill в комплекте** | AI-агенты управляют вашим бэклогом по навыку из коробки |
| 🚀 **Ноль зависимостей** | Bun + TypeScript, нативный fetch — нечему ломаться |
| 📊 **Статусы Work Items** | GraphQL API: `To do` / `In progress` / `Done` — то, чего нет в REST |

## 🚀 Быстрый старт

```bash
# 1. Установить
bun install && bun link

# 2. Подключить GitLab (токен: Settings → Access Tokens, scope "api")
glw config url https://gitlab.example.com
glw config token glpat-xxxxxxxxxxxxxxxx

# 3. Выбрать проект
glw projects            # что мне доступно?
glw use backend-api     # достаточно короткого имени

# 4. Поехали
glw whoami
glw list
```

<details>
<summary><b>💡 Хочу один конфиг для всех папок</b></summary>

<br>

```bash
glw global on           # включить глобальный режим
glw init glpat-xxx      # конфиг и токен лягут в %APPDATA%/glw (~/.config/glw на POSIX)
```

Теперь `glw` работает из любой директории. Локальные конфиги в папках проектов по-прежнему главнее (как у git: local > global). Подробности — в [справочнике](#-справочник).

</details>

## 📋 Повседневная работа

**Создать задачу из файла:**

```markdown
---
title: Реализовать авторизацию
labels: backend, security
assignee: @me
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
```

Нет шапки? Заголовком станет первый `# заголовок`. Подойдёт и `.txt`, и `.json`.

**Смотреть, менять, закрывать:**

```bash
glw list --assignee @me                        # мои открытые задачи
glw view 42                                    # всё о задаче #42
glw update 42 --status "In progress" --weight 5
glw update 42 --due none                       # "none" очищает поле
glw comment 42 "Проверено, работает"
glw close 42 --comment "Реализовано в MR !123"
```

**Учёт времени:**

```bash
glw estimate 42 2h
glw spend 42 1h30m --summary "code review"
```

**Искать:**

```bash
glw search "авторизация"                       # по названию и описанию
glw s --name auth --state all                  # алиас + только название
```

## 🔥 Массовые операции

Выбор фильтром, превью перед изменением, подтверждение — случайно снести полбэклога не выйдет:

```bash
# Что попадёт под изменение? (ничего не меняет)
glw update --search "refactor:" --status Done --dry-run

# Перевести все "refactor:" в In Progress
glw update --search "refactor:" --status "In progress"

# Закрыть всё, что назначено на меня
glw close --filter-assignee @me

# Для скриптов и CI — пропустить подтверждение
glw close --filter-label obsolete --yes
```

Без TTY (CI, скрипты) команда без `--yes` безопасно отменится сама.

## 🤖 Для AI-агентов

В комплекте — готовый **Agent Skill** ([`skills/glw/`](skills/glw)): Claude Code, Cursor, Codex и другие агенты управляют вашим бэклогом по естественно-языковым запросам — «закрой все мои задачи», «поставь 2 часа на #42».

```bash
npx skills add Aver005/gitlab-worker
```

Навык учит агента проверять окружение, безопасно выполнять массовые операции (превью → подтверждение) и разбирать ошибки. Технические детали для разработки — в [CLAUDE.md](CLAUDE.md).

## 📖 Шпаргалка

| Команда | Алиас | Что делает |
|---|:---:|---|
| `glw init [token]` | `i` | Создать конфиг; с токеном — записать его в `.env` |
| `glw config [key] [value]` | `cfg` | Показать/изменить настройки (`url`, `project`, `tokenEnv`, `token`) |
| `glw global on\|off` | | Общее окружение из `%APPDATA%/glw` для всех папок |
| `glw whoami` | | Кто я (проверка подключения) |
| `glw projects` | `p` | Мои проекты |
| `glw use <проект>` | | Выбрать проект по умолчанию |
| `glw list` | `l` `ls` | Список задач |
| `glw view <iid>` | `v` | Подробности задачи |
| `glw search <...>` | `s` | Поиск задач по фильтрам |
| `glw create <файл>` | `cr` | Создать задачу из файла |
| `glw update <iid...>` | `u` | Изменить поля задач(и) |
| `glw comment <iid>` | `co` | Добавить комментарий |
| `glw close [iid...]` | | Закрыть задачи |
| `glw reopen <iid...>` | | Переоткрыть задачи |
| `glw estimate <iid> <dur>` | | Оценка времени |
| `glw spend <iid> <dur>` | | Залогировать время |
| `glw completion <shell>` | | Скрипт автодополнения |

У каждой команды есть `--help` с полным списком флагов.

## 📚 Справочник

<details>
<summary><b>⚙️ Настройка и приоритет параметров</b></summary>

<br>

Откуда берутся параметры (по убыванию приоритета):

1. Флаг `--project` у конкретной команды
2. Переменные окружения: `GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_PROJECT`
3. Файл `.env` в текущей директории
4. `glw.config.json` в текущей директории
5. Глобальные `.env` и `glw.config.json` из `%APPDATA%/glw/` — если включён глобальный режим

Пример `glw.config.json`:

```json
{
  "url": "https://gitlab.example.com",
  "project": "acme/internal/backend-api",
  "tokenEnv": "GITLAB_TOKEN"
}
```

`glw init [token]` создаёт этот файл (существующий не трогает), а с аргументом-токеном записывает `GITLAB_TOKEN=<token>` в `.env`. Токен нужен с областью доступа **`api`**: `https://ваш-gitlab/-/user_settings/personal_access_tokens`.

**Просмотр и правка** — `glw config` (алиас `cfg`):

```bash
glw config                                   # показать итоговую конфигурацию (токен замаскирован)
glw config url https://gitlab.example.com    # задать значение
glw config token glpat-xxx                   # токен уходит в .env, а не в json
glw cfg url                                  # прочитать одно значение
glw config project --unset                   # удалить ключ
```

**Выбор проекта**: везде, где принимается проект (`glw use`, `--project`), можно передавать полный путь (`acme/internal/backend-api`) или уникальное короткое имя (`backend-api`) — оно ищется среди ваших проектов: точный путь → точное имя → последний сегмент пути → уникальная подстрока. При неоднозначности `glw` покажет кандидатов.

</details>

<details>
<summary><b>🌍 Глобальное окружение — <code>glw global</code></b></summary>

<br>

```bash
glw global on        # включить; локальный конфиг из текущей папки скопируется в %APPDATA%/glw/, если там пусто
glw init glpat-xxx   # при включённом режиме init пишет сразу в %APPDATA%/glw/
glw global status    # что включено и какие файлы есть
glw global off       # вернуться к локальным конфигам
```

При включённом режиме `glw` работает из любой директории. Локальные файлы по-прежнему главнее: если в папке проекта лежит свой `glw.config.json` или `.env` — используются они (как у git: local > global). `glw use` без локального конфига сохраняет проект в глобальный. Команды `init` и `config` пишут в глобальную папку автоматически (`--local`/`--global` задают цель явно). На POSIX-системах глобальная папка — `~/.config/glw/`.

</details>

<details>
<summary><b>📃 <code>glw projects</code> — пагинация и сортировка</b></summary>

<br>

| Флаг | По умолчанию | Описание |
|------|:---:|----------|
| `--search <q>` | — | Фильтр по имени |
| `--limit <n>` | 100 | Сколько проектов загрузить максимум |
| `--per-page <n>` | 30 | Размер страницы интерактивной пагинации |
| `--sort az\|za` | `az` | Сортировка по пути (принимает и `asc`/`desc`) |
| `--paginate` / `--no-paginate` | авто | Принудительно включить/выключить пагинацию |
| `--json` | — | JSON-вывод (без пагинации) |

Пагинация включается автоматически, когда вывод — терминал и результатов больше `--per-page`. Текущий проект помечен `*`. Успешный вызов обновляет кэш путей для автодополнения (`%APPDATA%/glw/projects.json`).

</details>

<details>
<summary><b>🔍 <code>glw search</code> — фильтры</b></summary>

<br>

Требуется хотя бы один фильтр; все условия объединяются через AND.

| Флаг | По умолчанию | Описание |
|------|:---:|----------|
| `text` (позиционный) | — | Вхождение в заголовок или описание |
| `--name <q>` | — | Заголовок содержит строку (без учёта регистра) |
| `--body <q>` | — | Описание содержит строку |
| `--start_time <d>` / `--start <d>` | — | Дата начала ≥ `YYYY-MM-DD` |
| `--state <s>` | `opened` | `opened` \| `closed` \| `all` |
| `--limit <n>` | 200 | Максимум загружаемых задач |

```bash
glw search --name "auth" --body "JWT" --start_time 2026-01-01
glw s "bug" --state all --json
```

</details>

<details>
<summary><b>✏️ <code>glw update</code> / <code>glw close</code> — выборка и поля</b></summary>

<br>

**Выборка**: явные номера (`glw update 42 43`) **или** фильтры `--search <q>`, `--filter-assignee <u|@me>`, `--filter-label <l>`, `--state <s>`. При выборке фильтрами показывается список совпадений и запрашивается подтверждение (пропускается с `--yes`); `--dry-run` — только показать.

**Поля**: `--title`, `--body` / `--body-file <f>`, `--status <имя>`, `--assignee <u|@me|none>`, `--labels <csv>` (заменить все), `--add-label` / `--remove-label` (повторяемые), `--weight <n|none>`, `--start <дата|none>`, `--due <дата|none>`, `--estimate <dur>`, `--spend <dur>` (+ `--summary`). Значение `none` очищает поле.

При ошибке на отдельной задаче массовая операция продолжается, код выхода будет ненулевым.

`glw close` использует те же фильтры; `--comment "<текст>"` добавит комментарий перед закрытием. `glw list`: `--state`, `--search`, `--assignee`, `--label`, `--limit` (по умолчанию 50), `--json`.

</details>

<details>
<summary><b>📄 Форматы: файлы задач, длительности, статусы</b></summary>

<br>

**Длительности** (estimate/spend): `2h`, `30m`, `1h30m`, `3d`, `1w2d3h`.

**Статусы**: `To do`, `In progress`, `Done`, `Won't do`, `Duplicate` (регистр не важен; проект может определять свои — при опечатке `glw` покажет доступные).

**Файл задачи (`glw create`)** — `.md`/`.txt` с YAML-шапкой между `---`. Ключи: `title`, `labels`, `assignees`/`assignee`, `weight`, `estimate`, `start`/`start_date`, `due`/`due_date`, `status`, `confidential`, `type`. Если в шапке нет ни одного известного ключа (например, это шаблон GitLab с `name:`/`about:`) — весь файл, включая `---`-блок, станет описанием задачи.

`.json`-файл: те же поля плюс `description`/`body`:

```json
{
  "title": "Название задачи",
  "description": "Описание",
  "labels": ["bug", "v2"],
  "assignees": ["alice"],
  "weight": 5,
  "estimate": "2h",
  "due": "2026-07-31",
  "status": "To do"
}
```

</details>

<details>
<summary><b>⌨️ Автодополнение в шелле</b></summary>

<br>

```bash
# bash — в ~/.bashrc:
eval "$(glw completion bash)"

# zsh — в ~/.zshrc:
eval "$(glw completion zsh)"
```

```powershell
# PowerShell — в $PROFILE:
glw completion powershell | Out-String | Invoke-Expression
```

Дополняются имена команд/алиасов и пути проектов после `use` и `--project` (из кэша `%APPDATA%/glw/projects.json`, который наполняется командами `glw projects` и `glw use`).

</details>

<details>
<summary><b>🌐 Переменные окружения и глобальные флаги</b></summary>

<br>

| Переменная | Описание |
|---|---|
| `GITLAB_URL` | URL GitLab-инстанса |
| `GITLAB_TOKEN` | Personal Access Token (имя переменной настраивается через `tokenEnv`) |
| `GITLAB_PROJECT` | Путь к проекту по умолчанию |
| `NO_COLOR` | Отключить цветной вывод |

Глобальные флаги: `--project <ref>` (путь или короткое имя), `--json`, `--help`/`-h`.

</details>

---

<div align="center">

**[⬆ Наверх](#-glw)**

Сделано на [Bun](https://bun.sh) · GraphQL Work Items API · Ноль зависимостей

</div>
