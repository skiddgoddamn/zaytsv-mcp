# zaytsv-mcp

[![CI](https://github.com/skiddgoddamn/zaytsv-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/skiddgoddamn/zaytsv-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/zaytsv-mcp.svg)](https://www.npmjs.com/package/zaytsv-mcp)
[![node](https://img.shields.io/node/v/zaytsv-mcp.svg)](https://nodejs.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MCP-сервер (+ скилл для Claude Code) для **сборки и публикации воронок/автоматизаций ботов (Telegram, MAX и Instagram)** в сервисе [zaytsv `/bots`](https://zaytsv.ru/bots): из текстового описания → валидный граф сценария → заливка и публикация через API.

- 🤖 **30 инструментов сборки/публикации**: `list_bots`, `list_graphs`, `list_channels`, `get_graph`, `create_graph`, `update_graph`, `edit_graph_live`, `patch_graph`, `dry_run`, `publish_graph`, `import_funnel`, `list_templates`, `create_graph_from_template`, `clone_graph`, `copy_graph`, `rename_graph`, `set_active_graph`, `delete_graph`, `upload_file`, `list_files`, `delete_file`, `graph_analytics`, `list_bot_users`, `list_links` (+ `setup`/`set_token`).
- 📝 **Статьи блога** (тот же токен `zmcp_…`): `article_publish`, `article_update`, `article_list`, `article_get` — публикация статей в Markdown (как README на GitHub) в раздел **/articles**.
- 📎 **Медиа**: `upload_file` грузит фото/видео/документы в библиотеку **/bots/files** (до 50 МБ) и возвращает публичный URL — его вставляешь в медиа-карточку сценария.
- 🧠 **Скилл `build-bot-funnel`**: учит агента собирать корректный граф (типы узлов, ветки, кнопки, задержки) и проверять его перед публикацией. Поддерживает Telegram, MAX и Instagram.
- 📦 **Без зависимостей** — чистый Node ≥18, ставится и запускается сразу.

### Поддерживаемые платформы

| Платформа | Онбординг | Триггеры входа | Ограничения |
|---|---|---|---|
| **Telegram** | Токен бота (BotFather) | `/start`, команды, callback, текст, рассылки | Полный функционал |
| **MAX** | Токен бота (MAX Developer) | Команды, callback, текст | Без SUBSCRIBED/reply-клавиатур (мягкие предупреждения) |
| **Instagram** | OAuth в `/growth` (без токена) | Комментарий/Direct/Ответ на историю/Упоминание | Ограниченный набор узлов; DELAY ≤ 24ч; ASK_QUESTION только TEXT/EMAIL/PHONE/NUMBER/CONTACT (CONTACT = ручной ввод номера); без рассылок |

---

## Установка

### Вариант A — как плагин Claude Code (рекомендуется)

```text
/plugin marketplace add skiddgoddamn/zaytsv-mcp
/plugin install zaytsv-mcp@zaytsv
```

Подтянутся и MCP-сервер `bot-graph`, и скилл `build-bot-funnel`. Проверить: `/mcp` и `/plugin`.

### Вариант B — как обычный MCP-сервер (Claude Code / Cursor / Windsurf / любой MCP-клиент)

Через `npx` без установки. Пример конфига (`.mcp.json` / настройки клиента):

```json
{
  "mcpServers": {
    "zaytsv-mcp": {
      "command": "npx",
      "args": ["-y", "zaytsv-mcp"],
      "env": {
        "ZAYTSV_BASE_URL": "https://zaytsv.ru",
        "ZAYTSV_MCP_TOKEN": "zmcp_ваш_токен"
      }
    }
  }
}
```

См. также [`examples/.mcp.json`](examples/.mcp.json).

---

## Авторизация — персональный токен

Токен даёт **полный доступ** к управлению твоими ботами (как вход в аккаунт).

1. Залогинься на https://zaytsv.ru → открой **`/bots/mcp-tokens`**.
2. Создай токен → скопируй секрет `zmcp_...` (показывается один раз).
3. Передай токен любым способом:
   - **просто пришли его агенту в чат** — он вызовет инструмент `set_token` и сохранит токен в `~/.zaytsv-bot-graph/token` (применяется сразу, без рестарта), **или**
   - `env` в `.mcp.json` (Вариант B), **или**
   - переменной окружения: PowerShell `setx ZAYTSV_MCP_TOKEN "zmcp_..."`, bash `export ZAYTSV_MCP_TOKEN="zmcp_..."`.

Отозвать токен можно там же — доступ блокируется мгновенно.

> **Не знаешь, что делать?** Скажи агенту «настрой подключение» — он вызовет `setup`, объяснит шаги и попросит токен. Любой инструмент при отсутствии токена тоже вернёт пошаговую инструкцию.

> Дев-окружение: `ZAYTSV_BASE_URL=http://localhost:8066`.
> Fallback без токена: `ZAYTSV_SESSION_COOKIE` = значение куки `SESSION` из браузера.

---

## Использование

Опиши воронку словами — агент соберёт граф и (через MCP) опубликует:

> «Собери бота: `/start` → приветствие с кнопкой подписки на канал → вопрос с 3 кнопками (бизнес / эксперт / просто смотрю) → для каждой свою цепочку из 2 сообщений с задержкой 1 день → финал с регистрацией на вебинар. Залей в бота и опубликуй.»

Под капотом скилл соберёт `nodes/edges`, прогонит локальную проверку и вызовет `import_funnel` → создаст граф, зальёт узлы, прогонит `dry-run /start`, опубликует. При ошибках публикации — разберёт по `code`/`nodeId`, починит, повторит.

### Инструменты

| Tool | Назначение |
|---|---|
| `setup` | статус авторизации + пошаговая инструкция подключения |
| `set_token` | сохранить присланный токен `zmcp_…` (без env/рестарта) |
| `list_bots` | список ботов |
| `list_graphs(botId)` | графы (сценарии) бота |
| `list_channels(botId)` | каналы/группы, подключённые к боту (chatId для условия SUBSCRIBED) |
| `get_graph(graphId, [summary], [saveToFile])` | получить граф; `summary:true` — компактная сводка (id/type/title + рёбра), `saveToFile` — записать полный JSON на диск (для больших графов, чтобы не упереться в лимит токенов) |
| `create_graph(botId, name)` | создать пустой граф (DRAFT) |
| `update_graph(graphId, graphFile\|graph\|nodes,edges)` | залить узлы/рёбра (PUT); `graphFile` — путь к локальному JSON, граф не нужно слать инлайном |
| `edit_graph_live(graphId, graphFile\|graph\|nodes,edges)` | правка живого графа НА МЕСТЕ + авто-бэкап (рекомендуется для прода) |
| `patch_graph(graphId, replacements)` | строковые замены в JSON графа на сервере (для больших/живых графов) |
| `dry_run(graphId, kind, value)` | прогон без публикации |
| `publish_graph(graphId)` | публикация (вернёт `errors[]` при провале) |
| `import_funnel(botId, name, graphFile\|graph)` | всё за раз: create → update → dry-run → publish |
| `list_templates()` | готовые шаблоны воронок |
| `create_graph_from_template(botId, templateId, name)` | граф из шаблона (DRAFT) |
| `clone_graph(graphId)` | копия графа в новый DRAFT |
| `rename_graph(graphId, name)` | переименовать сценарий |
| `set_active_graph(botId, graphId)` | переключить активный (живой) граф бота |
| `delete_graph(graphId)` | удалить граф (активный — нельзя, 409) |
| `upload_file(path\|url)` | загрузить файл в /bots/files → публичный `url` для медиа-карточки |
| `list_files()` | файлы библиотеки /bots/files + использовано/лимит байт |
| `delete_file(id)` | удалить файл из /bots/files |
| `graph_analytics(graphId)` | прохождение сценария по узлам (где отваливается воронка) |
| `list_bot_users(botId)` | подписчики/лиды бота (постранично, поиск `query`) |
| `list_links(botId)` | стартовые трекинговые ссылки бота с UTM |
| `article_list()` | свои статьи блога (id, slug, title, просмотры) |
| `article_get(slug)` | статья по slug (Markdown content, excerpt, обложка) |
| `article_publish(content, title?)` | новая статья (Markdown; title из `# ...`, если не задан; 1-я картинка → OG) → id, slug, URL |
| `article_update(id, content, title?)` | обновить свою статью по id |

---

## Формат графа и проверка

Граф — контейнер `zaytsv-bot-graph` (`nodes[]` + `edges[]`). Полная схема узлов/хэндлов и правила валидатора — в скилле:
- [`skills/build-bot-funnel/reference/schema.md`](skills/build-bot-funnel/reference/schema.md)
- [`skills/build-bot-funnel/reference/validation.md`](skills/build-bot-funnel/reference/validation.md)

Локальная проверка графа перед заливкой:

```bash
# Telegram (по умолчанию)
node skills/build-bot-funnel/validate.mjs path/to/import.json
# Instagram-бот
node skills/build-bot-funnel/validate.mjs path/to/import.json --platform=INSTAGRAM
# MAX-бот
node skills/build-bot-funnel/validate.mjs path/to/import.json --platform=MAX
```

---

## Разработка

```bash
git clone https://github.com/skiddgoddamn/zaytsv-mcp
cd zaytsv-mcp
ZAYTSV_MCP_TOKEN=zmcp_... node src/index.mjs   # стартует stdio MCP-сервер
```

Зависимостей нет — это голый JSON-RPC по stdio (протокол MCP `2024-11-05`).

## Безопасность

Токен = доступ к аккаунту по API. Не коммить его; держи в `env`. В конфигах храни ссылку `${ZAYTSV_MCP_TOKEN}`, не само значение.

## Лицензия

MIT — см. [LICENSE](LICENSE).
