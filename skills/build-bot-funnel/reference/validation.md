# Правила валидатора (GraphValidator) — чтобы граф публиковался

Источник истины: `zaytsvBackend/.../service/bot/GraphValidator.java`. При `publish` бэкенд возвращает `errors: [{ nodeId, code, message }]`. Ниже — что проверяется и как не нарваться.

## Коды ошибок и условия

### `SEND_NO_TEXT` — «Пустое сообщение — добавьте текст или картинку»
`SEND_MESSAGE` считается пустым, если **`config.text` пустой/из пробелов И `config.photoUrl` пустой**.
- Бэкенд читает плоское `config.text` (НЕ `cards`).
- Но редактор при сохранении пересобирает `text` из карточек через `cardsToLegacy`: берёт **первую карточку `type:"text"` с непустым `text`** (или `image.url`→`photoUrl`).
- ⇒ ВСЕГДА заполняй и `config.text`, и `cards[0]` (тип `text`, непустой `text`). Тогда оба пути дают непустой текст.
- Кнопок недостаточно: сообщение только с `buttons` — пустое.
- Пробелы/таб/перенос строки = пусто (`.isBlank()`).

### Длина текста
- `text` ≤ 4096; если есть `photoUrl` (подпись) — ≤ 1024 (`SEND_TOO_LONG`).
- При `parseMode:"HTML"` — текст должен быть безопасным Telegram-HTML, иначе `HTML_NOT_SAFE`. Разрешены только `b,strong,i,em,u,ins,s,strike,del,code,pre,a[href],tg-spoiler,br`. Если не уверен — `PLAIN`.

### `SEND_MESSAGE` в режиме «Вопрос» (`awaitReply:true`)
- `saveTo` обязателен и матчит `[a-z_][a-z0-9_]{0,63}` (`SEND_BAD_SAVE_TO`).
- При `validator:"REGEX"` — `regex` непустой и компилируется (`SEND_BAD_REGEX`).

### Триггеры и достижимость
- Нужен **хотя бы один корневой `TRIGGER_*`** без входящих рёбер.
- Если есть `BROADCAST_FILTER` — он должен быть единственным триггером.
- **Все нелистовые узлы достижимы** от какого-либо триггера. Недостижимый узел = ошибка.

### Циклы
- **Синхронных циклов нет.** Цикл допустим только если проходит через `ASK_QUESTION`, `DELAY` или `SCHEDULE` (узлы, которые «ждут»).

### Per-node конфиг
- `TRIGGER_COMMAND`: `command` обязателен.
- `TRIGGER_CALLBACK`: `value` обязателен; `matchMode` ∈ {EQUALS, STARTS_WITH}.
- `TRIGGER_TEXT`: `matchMode` ∈ {ANY,EQUALS,CONTAINS,REGEX}; для не-ANY нужен `value`.
- `ASK_QUESTION`: `promptText` обязателен (`ASK_NO_PROMPT`); `saveTo` ∈ `[a-z_][a-z0-9_]{0,63}` (`ASK_BAD_SAVE_TO`); при `validator:"REGEX"` — валидный `regex` (`ASK_BAD_REGEX`).
- `BRANCH`: ≥1 case (`BRANCH_NO_CASES`); вне `abTest` — непустое валидное `expression` (`BRANCH_EMPTY_EXPR`/`BRANCH_BAD_EXPR`) и подключённое ребро `case_<id>` (`BRANCH_CASE_UNCONNECTED`; `disabled:true` — если ветка намеренно пустая). В `abTest:true` рёбра нужны только у первых двух case.
- `CONDITION`: `match` ∈ {ALL, ANY} (`CONDITION_BAD_MATCH`); ≥1 элемент в `conditions` (`CONDITION_EMPTY`). Для `kind:"TAG"` — `value` ∈ `[a-z0-9_-]{1,64}` (`CONDITION_BAD_TAG`); для `kind:"VARIABLE"` — `key` ∈ `[a-z_][a-z0-9_]{0,63}` (`CONDITION_BAD_KEY`). Остальные `kind` (UTM/NAME/EMAIL/PHONE/USERNAME/SUBSCRIBED/LINK_CLICKED/CURRENT_*/DAY_OF_WEEK) бэкенд проверяет в рантайме — некорректный `kind`/`op`, нечисловой `key` у `SUBSCRIBED` или `key` у `LINK_CLICKED` без отслеживаемой кнопки молча дают `false` (выход `no`), публикацию не блокируют. Список `kind`/`op` — в schema.md.
- `CALL_WEBHOOK`: `url` обязателен (`WEBHOOK_NO_URL`), http(s):// (`WEBHOOK_BAD_SCHEME`).
- `DELAY`: `kind` ∈ {FIXED,UNTIL,TOMORROW} (`DELAY_BAD_KIND`). `FIXED` — `durationSec>0` (секунды) ИЛИ `duration>0` (+`unit` ∈ {MINUTES,HOURS,DAYS}), иначе `DELAY_BAD_DURATION`. `TOMORROW` — `time` = `HH:mm` (`DELAY_BAD_TIME`). `UNTIL` — `isoTimestamp` (ISO-8601 UTC; рантайм читает только его, не `isoDate`+`time`).
- `SET_VARIABLE`: `key` ∈ `[a-z_][a-z0-9_]{0,63}` (`VAR_BAD_KEY`). `ADD_TAG`/`REMOVE_TAG`: `tag` ∈ `[a-z0-9_-]{1,64}` (`TAG_BAD_NAME`).
- `FORMULA`: `expression` непустой (`FORMULA_NO_EXPRESSION`); `saveTo` ∈ var-формат (`FORMULA_BAD_SAVE_TO`).
- `SCHEDULE`: `isoDate` = валидная `YYYY-MM-DD` (`SCHEDULE_BAD_DATE`); `time` = `HH:mm` (`SCHEDULE_BAD_TIME`).
- `ACTIONS`: непустой `actions[]` (`ACTIONS_EMPTY`); каждый `kind` — из допустимого списка (`ACTION_UNKNOWN_KIND`, список — в schema.md); per-kind: `tag` (`ACTION_BAD_TAG`), `set_field.key` (`ACTION_BAD_KEY`), `url` у `external_request`/`subscriber_webhook` (`ACTION_BAD_URL`).
- `AI_REPLY`: `userPromptTemplate` непустой (`AI_NO_PROMPT`); `temperature` ∈ [0.0, 2.0] (`AI_BAD_TEMPERATURE`); нужен `sendToUser:true` ИЛИ `saveTo` (`AI_NO_OUTPUT`).
- `PAYMENT_LINK`: `paymentUrl` обязателен (`PAY_NO_URL`), http(s):// или `{{var.x}}` (`PAY_BAD_SCHEME`).
- Метки: `[a-z0-9_-]{1,64}`. Переменные: `[a-z_][a-z0-9_]{0,63}`.

## Рёбра
- `sourceNodeId` и `targetNodeId` должны указывать на существующие узлы (нет «висячих»).
- `sourceHandle` должен соответствовать типу узла-источника (см. schema.md).
- **Кнопка-выбор ↔ ребро `btn_N`**: у `CALLBACK`-кнопки, от которой идёт ребро `btn_N`, `value` ДОЛЖЕН быть пустым (`""`). Тогда бот рендерит навигационный `callback_data` `n:<id узла>:<индекс>` и маршрутизирует по `btn_N`. Непустой `value` рендерится как есть, не матчит навигационный формат → нажатие уходит в `NO_MATCH` (кнопка «не работает»). Непустой `value` уместен только для legacy-кнопки под отдельный узел `TRIGGER_CALLBACK` (без ребра `btn_N`).
- id узлов и рёбер — уникальны и **оба должны быть валидными UUID**: Jackson десериализует и `TgNode.id`, и `TgEdge.id`/`sourceNodeId`/`targetNodeId` как `java.util.UUID`. Короткая строка (`"m1"`, `"e1"`) → весь PUT падает с HTTP 400 (generic, без тела).

## Жизненный цикл
- Статусы графа: `DRAFT` / `PUBLISHED`. Публикация заменяет активную опубликованную версию.
- Перед публикацией полезно прогнать `dry_run` (kind `command`/`callback`/`text`) — поймать рантайм-проблемы стартовой ветки.

## Платформенные правила — Instagram

Источник: `GraphValidator.platformErrors()` (Java). Коды — жёсткие ошибки, **блокируют публикацию** (`publish_graph` вернёт `errors[]`).

### `IG_NODE_UNSUPPORTED` — неподдерживаемый тип узла

Каждый узел в графе (включая черновые/неподключённые) должен быть из IG-allowlist. Всё остальное → ошибка.

Allowlist: `TRIGGER_IG_COMMENT`, `TRIGGER_IG_DM`, `TRIGGER_IG_STORY_REPLY`, `TRIGGER_IG_STORY_MENTION`, `SEND_MESSAGE`, `SEND_PHOTO`, `BRANCH`, `CONDITION`, `SET_VARIABLE`, `ADD_TAG`, `REMOVE_TAG`, `FORMULA`, `ASK_QUESTION`, `DELAY`, `END`.

Не в allowlist: `TRIGGER_COMMAND`, `TRIGGER_CALLBACK`, `TRIGGER_TEXT`, `BROADCAST_FILTER`, `SCHEDULE`, `ACTIONS`, `CALL_WEBHOOK`, `AI_REPLY`, `PAYMENT_LINK` — и любой другой тип.

> Бэкенд проверяет ВСЕ узлы, включая черновые (неподключённые), так как палитра редактора не даёт ставить неподдерживаемые узлы в IG-боте — поэтому их присутствие означает реальную ошибку (напр., импортированный/скопированный граф).

### `IG_DELAY_OVER_24H` — задержка больше 24 часов

Instagram доставляет сообщения только в течение **24 часов** после последнего входящего от пользователя.

Правило (зеркало `igDelaySeconds()` в Java):
- `kind != "FIXED"` (т.е. `TOMORROW` или `UNTIL`) → всегда ошибка (заведомо > 24ч).
- `kind == "FIXED"`:
  - `durationSec > 86400` → ошибка.
  - `duration` (число) + `unit` → пересчёт: `MINUTES` × 60, `HOURS` × 3600, `DAYS` × 86400; если результат > 86400 → ошибка.
  - `duration` без `unit` → считается в секундах; если > 86400 → ошибка.
  - Отсутствует и `durationSec`, и `duration` (malformed FIXED) → ошибка (не разрешаем молча).

### `IG_INPUT_UNSUPPORTED` — неподдерживаемый вид ответа

У `ASK_QUESTION`, `inputKind` ограничен: только `TEXT`, `EMAIL`, `PHONE`, `NUMBER`.

Не поддерживается: `CONTACT` (кнопка «Поделиться номером» недоступна в IG Messaging API), `LOCATION`, `PHOTO`, `DOCUMENT`.

`inputKind == null` (не задан) — допустимо (дефолт = текст).

---

## Локальная проверка
`node validate.mjs <import.json>` повторяет ключевые проверки: пустые сообщения с учётом `cardsToLegacy`, висячие рёбра, дубли id, достижимость от триггеров, длину текста, HTML-безопасность (эвристика по тегам), режим «Вопрос» (`awaitReply`→`saveTo`/`regex`), конфиг `DELAY`/`SCHEDULE`/`FORMULA`/`ACTIONS`/`AI_REPLY`/`PAYMENT_LINK`/триггеров, условия `CONDITION` (вкл. `LINK_CLICKED` со ссылкой на отслеживаемый шаг). Гонять перед каждой заливкой.

Для IG-ботов передавать `--platform=INSTAGRAM`:
```bash
node validate.mjs <import.json> --platform=INSTAGRAM
```
Добавляет проверки `IG_NODE_UNSUPPORTED`, `IG_DELAY_OVER_24H`, `IG_INPUT_UNSUPPORTED` поверх всех обычных.
