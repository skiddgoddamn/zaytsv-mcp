# zaytsv-bot-graph-mcp

[![CI](https://github.com/skiddgoddamn/zaytsv-bot-graph-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/skiddgoddamn/zaytsv-bot-graph-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/zaytsv-bot-graph-mcp.svg)](https://www.npmjs.com/package/zaytsv-bot-graph-mcp)
[![node](https://img.shields.io/node/v/zaytsv-bot-graph-mcp.svg)](https://nodejs.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MCP-сервер (+ скилл для Claude Code) для **сборки и публикации воронок/автоматизаций ботов (Telegram, MAX и Instagram)** в сервисе [zaytsv `/bots`](https://zaytsv.ru/bots): из текстового описания → валидный граф сценария → заливка и публикация через API.

- 🤖 **20 инструментов сборки/публикации**: `list_bots`, `list_graphs`, `list_channels`, `get_graph`, `create_graph`, `update_graph`, `edit_graph_live`, `patch_graph`, `dry_run`, `publish_graph`, `import_funnel`, `list_templates`, `create_graph_from_template`, `clone_graph`, `copy_graph`, `rename_graph`, `set_active_graph`, `delete_graph` (+ `setup`/`set_token`).
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
/plugin marketplace add skiddgoddamn/zaytsv-bot-graph-mcp
/plugin install zaytsv-bot-graph@zaytsv
```

Подтянутся и MCP-сервер `bot-graph`, и скилл `build-bot-funnel`. Проверить: `/mcp` и `/plugin`.

### Вариант B — как обычный MCP-сервер (Claude Code / Cursor / Windsurf / любой MCP-клиент)

Через `npx` без установки. Пример конфига (`.mcp.json` / настройки клиента):

```json
{
  "mcpServers": {
    "bot-graph": {
      "command": "npx",
      "args": ["-y", "zaytsv-bot-graph-mcp"],
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
| `get_graph(graphId)` | получить граф |
| `create_graph(botId, name)` | создать пустой граф (DRAFT) |
| `update_graph(graphId, graph\|nodes,edges)` | залить узлы/рёбра (PUT) |
| `dry_run(graphId, kind, value)` | прогон без публикации |
| `publish_graph(graphId)` | публикация (вернёт `errors[]` при провале) |
| `import_funnel(botId, name, graph)` | всё за раз: create → update → dry-run → publish |
| `list_templates()` | готовые шаблоны воронок |
| `create_graph_from_template(botId, templateId, name)` | граф из шаблона (DRAFT) |
| `clone_graph(graphId)` | копия графа в новый DRAFT |
| `rename_graph(graphId, name)` | переименовать сценарий |
| `set_active_graph(botId, graphId)` | переключить активный (живой) граф бота |
| `delete_graph(graphId)` | удалить граф (активный — нельзя, 409) |

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
git clone https://github.com/skiddgoddamn/zaytsv-bot-graph-mcp
cd zaytsv-bot-graph-mcp
ZAYTSV_MCP_TOKEN=zmcp_... node src/index.mjs   # стартует stdio MCP-сервер
```

Зависимостей нет — это голый JSON-RPC по stdio (протокол MCP `2024-11-05`).

## Безопасность

Токен = доступ к аккаунту по API. Не коммить его; держи в `env`. В конфигах храни ссылку `${ZAYTSV_MCP_TOKEN}`, не само значение.

## Лицензия

MIT — см. [LICENSE](LICENSE).
