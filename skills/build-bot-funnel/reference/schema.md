# Формат графа `zaytsv-bot-graph`

## Контейнер импорта
```json
{
  "format": "zaytsv-bot-graph",
  "version": 1,
  "name": "Название воронки",
  "nodes": [ /* TgNode[] */ ],
  "edges": [ /* TgEdge[] */ ],
  "canvasMeta": {}
}
```
При заливке через MCP в `update_graph` передаются только `nodes`, `edges`, `canvasMeta`, `name`.

## Узел (TgNode)
```json
{ "id": "<uuid>", "type": "<NodeType>", "config": { ... }, "position": { "x": 0, "y": 0 } }
```
- `id` — валидный UUID (8-4-4-4-12), уникальный.
- `position` — раскладка на холсте (слева направо: шаг x ≈ 420; ветки разносим по y).

## Ребро (TgEdge) — «стрелка»
```json
{ "id": "<uuid|строка>", "sourceNodeId": "<uuid>", "sourceHandle": "next", "targetNodeId": "<uuid>" }
```
`sourceHandle` — какой выход узла используется (см. ниже).

## Типы узлов (NodeType) и их config

### Триггеры (точки входа, корневые)
- `TRIGGER_COMMAND` — `{ "isRoot": true, "command": "start" }` (команда без `/`). Первый — с `isRoot:true`.
- `TRIGGER_CALLBACK` — `{ "matchMode": "EQUALS"|"STARTS_WITH", "value": "<callback_data>" }`
- `TRIGGER_TEXT` — `{ "matchMode": "ANY"|"EQUALS"|"CONTAINS"|"REGEX", "value": "..." }`
- `BROADCAST_FILTER` — режим рассылки (если есть — единственный триггер).

### Сообщения
- `SEND_MESSAGE` —
  ```json
  { "_title": "Заголовок узла", "parseMode": "PLAIN"|"HTML"|"MARKDOWN",
    "text": "Текст сообщения",
    "cards": [ { "id": "c1", "type": "text", "text": "Текст сообщения" } ],
    "buttons": [ [ { "text": "Кнопка", "kind": "CALLBACK"|"URL", "value": "data|url" } ] ] }
  ```
  ВСЕГДА заполняй и `text`, и `cards[0].text` одинаково. `buttons` — массив рядов (каждый ряд — массив кнопок).
- `SEND_PHOTO` — `{ "photoUrl": "https://...", "text": "подпись (необязательно)" }`

### Логика / ветвление
- `CONDITION` — проверка условий, выходы `yes` / `no`. `{ "match":"ALL"|"ANY", "conditions":[ { "kind":"...", "op":"...", "key":"...", "value":"..." } ] }`. `match:"ALL"` — все условия истинны; `"ANY"` — хотя бы одно. Полный список `kind`/`op`/полей — в разделе [«Условия CONDITION»](#условия-condition).
- `BRANCH` — `{ "cases":[ {"id":"c1","label":"...","expression":"var.x=='a'"} ], "hasDefault": false, "abTest": false }`. Выходы: `case_<id>` (+ `default`).
- `ASK_QUESTION` — вопрос со сбором ответа. `{ "promptText":"...","saveTo":"name","validator":"ANY"|"PHONE"|"EMAIL"|"REGEX","regex":"...","retryText":"...","maxAttempts":3 }`. Выходы `valid` / `invalid`.
- `END` — `{}` (конец ветки).

### Тайминги
- `DELAY` — пауза:
  - фиксированная: `{ "kind":"FIXED", "durationSec": 86400 }`
  - до даты/времени: `{ "kind":"UNTIL", "isoDate":"2026-06-25", "time":"18:00" }`
- `SCHEDULE` — `{ "isoDate":"2026-06-25", "time":"18:00", "timezone":"Europe/Moscow" }`. Выходы `scheduled` / `past`.

### Состояние / действия
- `SET_VARIABLE`, `ADD_TAG`, `REMOVE_TAG`, `FORMULA` (`{ "expression":"...", "saveTo":"name" }`)
- `ACTIONS` — пакет действий: `{ "actions":[ { "kind":"add_tag","tag":"lead" }, { "kind":"notify","text":"..." }, { "kind":"set_field","key":"phone","value":"{{var.phone}}" }, { "kind":"external_request","url":"...","method":"POST","body":"..." } ] }`

### Внешнее / прочее
- `CALL_WEBHOOK` — `{ "url":"https://...", "method":"POST", "bodyTemplate":"{...}", "timeoutMs":5000 }`. Выходы `ok` / `error`.
- `AI_REPLY`, `PAYMENT_LINK`.

## Условия CONDITION

Каждый элемент `conditions[]` — `{ "kind", "op", ...поля }`. Любая внутренняя ошибка условия = `false` (узел уходит в `no`).

| `kind` | `op` (допустимые) | Поля | Что проверяет |
|---|---|---|---|
| `TAG` | `HAS`, `NOT_HAS` | `value` — метка `[a-z0-9_-]{1,64}` | есть ли у пользователя тег |
| `VARIABLE` | `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_EMPTY`, `EMPTY`, `GT`, `LT` | `key` — имя переменной `[a-z_][a-z0-9_]{0,63}`, `value` | значение переменной (`GT`/`LT` — числовое сравнение) |
| `UTM` | `EQUALS`, `CONTAINS`, `NOT_EMPTY`, `EMPTY` | `key` ∈ `source`/`medium`/`campaign`/`content`/`term`, `value` | UTM-метку клика (`utm_<key>`), регистронезависимо |
| `NAME` | `EQUALS`, `CONTAINS`, `NOT_EMPTY`, `EMPTY` | `value` | имя из профиля, регистронезависимо |
| `EMAIL` | `EQUALS`, `CONTAINS`, `NOT_EMPTY`, `EMPTY` | `value` | email из профиля |
| `PHONE` | `EQUALS`, `CONTAINS`, `NOT_EMPTY`, `EMPTY` | `value` | телефон из профиля |
| `USERNAME` | `EQUALS`, `CONTAINS` | `value` | @username пользователя Telegram |
| `SUBSCRIBED` | `SUBSCRIBED`, `NOT_SUBSCRIBED` | `key` — **числовой** id канала/группы (напр. `-1001234567890`) | подписан ли пользователь на канал бота |
| `CURRENT_DATE` | `BEFORE`, `AFTER`, `EQUALS` | `value` — дата `YYYY-MM-DD` | сегодняшнюю дату (МСК) |
| `CURRENT_TIME` | `BETWEEN` | `value`, `value2` — время `HH:mm` | текущее время в интервале (через полночь — если `value`>`value2`) |
| `DAY_OF_WEEK` | `IN` | `days` — массив из `MON`,`TUE`,`WED`,`THU`,`FRI`,`SAT`,`SUN` | день недели (МСК) |

Для `NOT_EMPTY`/`EMPTY` поле `value` не нужно. `UTM` без `key` всегда `false`.

**`SUBSCRIBED`** работает только если бот **админ** в канале/группе и канал «привязан» (бот узнаёт о членстве через хук `my_chat_member` — добавь бота в канал админом). `key` должен парситься в число, иначе условие = `false`. Профильные поля (`NAME`/`EMAIL`/`PHONE`) и UTM заполняются по ходу воронки (`ASK_QUESTION`→`saveTo`, диплинк-клик с UTM).

## Выходные хэндлы (`sourceHandle`) — шпаргалка
| Узел | Хэндлы |
|---|---|
| обычный поток | `next` |
| кнопки сообщения (`buttons`) | `btn_0`, `btn_1`, … (по индексу кнопки) |
| `CONDITION` | `yes`, `no` |
| `BRANCH` | `case_<id>`, `default` |
| `ASK_QUESTION` | `valid`, `invalid` |
| `CALL_WEBHOOK` | `ok`, `error` |
| `SCHEDULE` | `scheduled`, `past` |
| `DELAY` | `next` |

## Подстановки в тексте
`{{from.first_name}}`, `{{from.username}}`, `{{var.<имя>}}`, либо `{Имя}` как плейсхолдер. Имена переменных/меток: `[a-z_][a-z0-9_]{0,63}` (var) и `[a-z0-9_-]{1,64}` (tag).
