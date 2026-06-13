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
{ "id": "<uuid>", "sourceNodeId": "<uuid>", "sourceHandle": "next", "targetNodeId": "<uuid>" }
```
`sourceHandle` — какой выход узла используется (см. ниже).
- `id`, `sourceNodeId`, `targetNodeId` — **валидные UUID** (бэкенд десериализует их как `java.util.UUID`; короткая строка вроде `"m1"` → HTTP 400 при заливке). `id` уникален среди рёбер.

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
    "buttons": [ [ { "text": "Кнопка", "kind": "CALLBACK"|"URL", "value": "<url для URL; ПУСТО для CALLBACK>", "color": "", "track": true } ] ] }
  ```
  ВСЕГДА заполняй и `text`, и `cards[0].text` одинаково. `buttons` — массив рядов (каждый ряд — массив кнопок).
  - `parseMode:"HTML"` (дефолт редактора) — текст должен быть **безопасным Telegram-HTML**: разрешены только `b,strong,i,em,u,ins,s,strike,del,code,pre,a[href],tg-spoiler,br`. Любой другой тег/атрибут → ошибка публикации `HTML_NOT_SAFE`. Не уверен — ставь `PLAIN`.
  - **Кнопки-выборы (`kind:"CALLBACK"`)**: `value` ОСТАВЛЯЙ ПУСТЫМ (`""`). Бот сам сгенерит `callback_data` вида `n:<id узла>:<индекс>`, а переход задаётся ребром `btn_N` от кнопки. **Непустой `value`** трактуется как legacy-`callback_data` для отдельного узла `TRIGGER_CALLBACK` (у такой кнопки ребра `btn_N` быть не должно) — если поставить `value` обычной кнопке-выбору, переход по `btn_N` **сломается** (нажатие → `NO_MATCH`).
  - **Кнопки-ссылки (`kind:"URL"`)**: `value` = URL. Могут иметь `"track": true` — клики считаются, и на такой шаг можно сослаться из условия `LINK_CLICKED` (см. ниже).
  - **`color`** (опционально, и у CALLBACK, и у URL) — только стили, которые рендерит Telegram (как в основном боте / pengrad `ButtonStyle`): `""`=по умолчанию, `"#2EA6FF"`=primary (синий), `"#34C759"`=success (зелёный), `"#FF3B30"`=danger (красный). Других цветов нет.
  - **Режим «Вопрос» (`awaitReply: true`)** — сообщение задаёт вопрос и ждёт ответ (паркуется как `ASK_QUESTION`). Доп. поля: `"saveTo":"name"` (обязателен, `[a-z_][a-z0-9_]{0,63}`), `"inputKind":"TEXT"|"PHOTO"|"DOCUMENT"|"CONTACT"|"LOCATION"`, `"validator":"ANY"|"PHONE"|"EMAIL"|"REGEX"`, `"regex":"..."`, `"retryText":"..."`, `"maxAttempts":3`. Выходы — `valid` / `invalid` (как у `ASK_QUESTION`), плюс `btn_N` для кнопок.
- `SEND_PHOTO` — `{ "photoUrl": "https://...", "caption": "подпись (необязательно, ≤1024)" }`

### Логика / ветвление
- `CONDITION` — проверка условий, выходы `yes` / `no`. `{ "match":"ALL"|"ANY", "conditions":[ { "kind":"...", "op":"...", "key":"...", "value":"..." } ] }`. `match:"ALL"` — все условия истинны; `"ANY"` — хотя бы одно. Полный список `kind`/`op`/полей — в разделе [«Условия CONDITION»](#условия-condition).
- `BRANCH` — `{ "cases":[ {"id":"c1","label":"...","expression":"var.x=='a'"} ], "hasDefault": false, "abTest": false }`. Выходы: `case_<id>` (+ `default`).
- `ASK_QUESTION` — вопрос со сбором ответа. `{ "promptText":"...","saveTo":"name","inputKind":"TEXT"|"PHOTO"|"DOCUMENT"|"CONTACT"|"LOCATION","validator":"ANY"|"PHONE"|"EMAIL"|"REGEX","regex":"...","retryText":"...","maxAttempts":3 }`. `inputKind` (по умолчанию `TEXT`) — что ждём в ответ (`CONTACT` → телефон, `LOCATION` → `lat,lon`, `PHOTO`/`DOCUMENT` → file_id). Выходы `valid` / `invalid`.
- `END` — `{}` (конец ветки). **Не добавляй `END`**: ветка и так завершается на узле без исходящих рёбер; явный «конец сценария» бесполезен и убран из палитры редактора. Тип оставлен лишь для совместимости со старыми графами.

### Тайминги
- `DELAY` — пауза. Три вида (`kind`):
  - **`FIXED`** («Отправить через»): `{ "kind":"FIXED", "durationSec": 86400 }` — `durationSec` в **секундах** (60 = 1 мин, 3600 = 1 час, 86400 = 1 сутки). Редактор также пишет `{ "kind":"FIXED", "duration": 24, "unit":"MINUTES"|"HOURS"|"DAYS" }` (минуты/часы/дни — чтобы не вбивать большие числа). Для генерации проще `durationSec`.
  - **`TOMORROW`** («Отправить завтра»): `{ "kind":"TOMORROW", "time":"18:00" }` — завтра в указанное время `HH:mm` (МСК), относительно момента, когда пользователь дошёл до узла.
  - **`UNTIL`** («Отправить в»): `{ "kind":"UNTIL", "isoTimestamp":"2026-06-25T15:00:00Z" }` — конкретный момент в ISO-8601 (UTC). ⚠️ Рантайм читает только `isoTimestamp`; пары `isoDate`+`time` НЕ работают.
- `SCHEDULE` — `{ "isoDate":"2026-06-25", "time":"18:00", "timezone":"Europe/Moscow" }`. Выходы `scheduled` / `past`.

### Состояние / действия
- `SET_VARIABLE` (`{ "key":"name", "value":"..." }`), `ADD_TAG`/`REMOVE_TAG` (`{ "tag":"lead" }`), `FORMULA` (`{ "expression":"...", "saveTo":"name" }`)
- `ACTIONS` — непустой пакет действий `{ "actions":[ { "kind":"...", ...поля } ] }`. Допустимые `kind` (иначе ошибка `ACTION_UNKNOWN_KIND`):
  - **метки/автоворонки**: `add_tag`, `remove_tag`, `autoflow_add`, `autoflow_remove` — поле `tag` (`[a-z0-9_-]{1,64}`)
  - **профиль**: `set_field` — `key` (`[a-z_][a-z0-9_]{0,63}`) + `value`; `subscribe`, `unsubscribe`
  - **HTTP**: `external_request`, `subscriber_webhook` — `url` (http/https) + `method`/`headersJson`/`bodyTemplate`
  - **уведомления**: `notify` (`text`), `subscriber_email` (`email`,`text`), `agent_chat`
  - **бот/шаг**: `stop_bot`, `delete_step_message`, `cancel_payment_subscription`
  - **интеграции**: `getcourse_send`, `getcourse_order`, `amocrm_send`, `amocrm_update`, `yametrika_event`, `gsheets_send`, `gsheets_get`, `gsheets_update`, `gsheets_write_cell`, `gsheets_read_cell`
  - **модерация группы**: `group_unban`, `group_kick`, `group_approve`, `group_decline`

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
| `SUBSCRIBED` | `SUBSCRIBED`, `NOT_SUBSCRIBED` | `key` — **числовой** id канала/группы (напр. `-1001234567890`); узнать числовой id подключённых каналов: `list_channels(botId)` | подписан ли пользователь на канал бота |
| `LINK_CLICKED` | `CLICKED`, `NOT_CLICKED` | `key` — **`id` узла-шага** с отслеживаемой URL-кнопкой (тот же UUID, что у `SEND_MESSAGE`) | кликал ли пользователь по ссылке этого шага |
| `CURRENT_DATE` | `BEFORE`, `AFTER`, `EQUALS` | `value` — дата `YYYY-MM-DD` | сегодняшнюю дату (МСК) |
| `CURRENT_TIME` | `BETWEEN` | `value`, `value2` — время `HH:mm` | текущее время в интервале (через полночь — если `value`>`value2`) |
| `DAY_OF_WEEK` | `IN` | `days` — массив из `MON`,`TUE`,`WED`,`THU`,`FRI`,`SAT`,`SUN` | день недели (МСК) |

Для `NOT_EMPTY`/`EMPTY` поле `value` не нужно. `UTM` без `key` всегда `false`.

**`SUBSCRIBED`** работает только если бот **админ** в канале/группе и канал «привязан» (бот узнаёт о членстве через хук `my_chat_member` — добавь бота в канал админом). `key` должен парситься в число, иначе условие = `false`. Профильные поля (`NAME`/`EMAIL`/`PHONE`) и UTM заполняются по ходу воронки (`ASK_QUESTION`→`saveTo`, диплинк-клик с UTM).

**`LINK_CLICKED`** проверяет факт клика по URL-кнопке конкретного шага. Чтобы условие работало: у нужного `SEND_MESSAGE` хотя бы одна кнопка `kind:"URL"` с `"track": true`, а в условии `key` = `id` этого узла-шага. Клик фиксируется через публичный редирект бота, поэтому условие имеет смысл ставить **после** `DELAY`/`ASK_QUESTION` (дай пользователю время кликнуть).

> **Платформа MAX.** Боты конструктора умеют работать и в мессенджере MAX. Там не поддерживаются `SUBSCRIBED`/`NOT_SUBSCRIBED` (нет членства в каналах) и reply-клавиатуры; публикация такого графа на MAX-бот вернёт **мягкие предупреждения** (не блокирует). Для Telegram-ботов всё работает как описано.

## Выходные хэндлы (`sourceHandle`) — шпаргалка
| Узел | Хэндлы |
|---|---|
| обычный поток | `next` |
| кнопки сообщения (`buttons`) | `btn_0`, `btn_1`, … (по индексу кнопки, плоско по всем рядам) |
| `CONDITION` | `yes`, `no` |
| `BRANCH` | `case_<id>`, `default` |
| `ASK_QUESTION` | `valid`, `invalid` |
| `SEND_MESSAGE` с `awaitReply:true` | `valid`, `invalid` (+ `btn_N` для кнопок) |
| `CALL_WEBHOOK` | `ok`, `error` |
| `SCHEDULE` | `scheduled`, `past` |
| `DELAY` | `next` |

## Подстановки в тексте
`{{from.first_name}}`, `{{from.username}}`, `{{var.<имя>}}`, либо `{Имя}` как плейсхолдер. Имена переменных/меток: `[a-z_][a-z0-9_]{0,63}` (var) и `[a-z0-9_-]{1,64}` (tag).
