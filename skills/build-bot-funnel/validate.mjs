#!/usr/bin/env node
// Оффлайн-валидатор графа zaytsv-bot-graph. Без зависимостей.
// Использование:  node validate.mjs <path/to/import.json> [--platform=TELEGRAM|MAX|INSTAGRAM]
// Повторяет ключевые правила GraphValidator + cardsToLegacy редактора.

import { readFileSync } from "node:fs";

// Разобрать аргументы порядконезависимо: первый не-флаг = путь; --platform=... в любом месте
let path = "";
let platform = "TELEGRAM";
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--platform=([A-Za-z]+)$/);
  if (m) { platform = m[1].toUpperCase(); }
  else if (!arg.startsWith("--") && !path) { path = arg; }
}
if (!path) { console.error("Usage: node validate.mjs <import.json> [--platform=TELEGRAM|MAX|INSTAGRAM]"); process.exit(2); }
if (!["TELEGRAM", "MAX", "INSTAGRAM"].includes(platform)) {
  console.error(`❌ Неизвестная платформа: ${platform}. Допустимые: TELEGRAM, MAX, INSTAGRAM`);
  process.exit(2);
}

let g;
try { g = JSON.parse(readFileSync(path, "utf8")); }
catch (e) { console.error("❌ Не удалось прочитать/распарсить JSON:", e.message); process.exit(2); }

const nodes = Array.isArray(g.nodes) ? g.nodes : [];
const edges = Array.isArray(g.edges) ? g.edges : [];
const errors = [];
const warns = [];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAR_RE = /^[a-z_][a-z0-9_]{0,63}$/;
const TAG_RE = /^[a-z0-9_-]{1,64}$/;

// kind -> допустимые op (для подсказок; бэкенд блокирует только TAG/VARIABLE)
const COND_OPS = {
  TAG: ["HAS", "NOT_HAS"],
  VARIABLE: ["EQUALS", "NOT_EQUALS", "CONTAINS", "NOT_EMPTY", "EMPTY", "GT", "LT"],
  UTM: ["EQUALS", "CONTAINS", "NOT_EMPTY", "EMPTY"],
  NAME: ["EQUALS", "CONTAINS", "NOT_EMPTY", "EMPTY"],
  EMAIL: ["EQUALS", "CONTAINS", "NOT_EMPTY", "EMPTY"],
  PHONE: ["EQUALS", "CONTAINS", "NOT_EMPTY", "EMPTY"],
  USERNAME: ["EQUALS", "CONTAINS"],
  SUBSCRIBED: ["SUBSCRIBED", "NOT_SUBSCRIBED"],
  LINK_CLICKED: ["CLICKED", "NOT_CLICKED"],
  CURRENT_DATE: ["BEFORE", "AFTER", "EQUALS"],
  CURRENT_TIME: ["BETWEEN"],
  DAY_OF_WEEK: ["IN"],
};

// ACTIONS: допустимые kind (зеркало GraphValidator.KNOWN_ACTION_KINDS)
const ACTION_KINDS = new Set([
  "add_tag", "remove_tag", "set_field", "stop_bot", "delete_step_message",
  "subscribe", "unsubscribe", "autoflow_add", "autoflow_remove",
  "subscriber_webhook", "external_request", "notify",
  "subscriber_email", "agent_chat", "cancel_payment_subscription",
  "getcourse_send", "getcourse_order", "amocrm_send", "amocrm_update",
  "yametrika_event", "gsheets_send", "gsheets_get", "gsheets_update",
  "gsheets_write_cell", "gsheets_read_cell",
  "group_unban", "group_kick", "group_approve", "group_decline",
]);

// Telegram-safe HTML — разрешённые теги (эвристика; бэкенд использует jsoup-clean)
const HTML_OK_TAGS = new Set([
  "b", "strong", "i", "em", "u", "ins", "s", "strike", "del",
  "code", "pre", "a", "tg-spoiler", "br",
]);
const isHttp = (u) => /^https?:\/\//.test(String(u || ""));

// cardsToLegacy: текст = первая text-карточка с непустым text (или image.url -> photoUrl)
function cardsToLegacy(cards) {
  cards = Array.isArray(cards) ? cards : [];
  const firstImage = cards.find((c) => c && c.type === "image" && c.url);
  const firstText = cards.find((c) => c && c.type === "text" && c.text);
  const firstMedia = cards.find((c) => c && ["image", "video", "audio", "file"].includes(c.type) && c.text);
  let text, photoUrl;
  if (firstImage) { photoUrl = firstImage.url; text = firstImage.text || (firstText && firstText.text) || ""; }
  else if (firstText) { text = firstText.text; }
  else if (firstMedia) { text = firstMedia.text; }
  if (!text && !photoUrl) text = "";
  return { text: text || "", photoUrl: photoUrl || "" };
}
const blank = (s) => !s || !String(s).trim();

// --- id / структура ---
const ids = new Set();
for (const n of nodes) {
  if (!n || !n.id) { errors.push(`Узел без id: ${JSON.stringify(n).slice(0, 80)}`); continue; }
  if (ids.has(n.id)) errors.push(`Дубль id узла: ${n.id}`);
  ids.add(n.id);
  if (!UUID_RE.test(n.id)) errors.push(`id узла не UUID — бэкенд десериализует UUID, PUT даст HTTP 400: ${n.id} «${n.config?._title || n.type}»`);
}
const edgeIds = new Set();
for (const e of edges) {
  if (e.id && edgeIds.has(e.id)) errors.push(`Дубль id ребра: ${e.id}`);
  if (e.id) edgeIds.add(e.id);
  if (!e.id || !UUID_RE.test(e.id)) errors.push(`id ребра не UUID — бэкенд десериализует UUID, PUT даст HTTP 400: ${e.id}`);
  if (!ids.has(e.sourceNodeId)) errors.push(`Висячее ребро ${e.id}: нет sourceNodeId ${e.sourceNodeId}`);
  if (!ids.has(e.targetNodeId)) errors.push(`Висячее ребро ${e.id}: нет targetNodeId ${e.targetNodeId}`);
}

// --- per-node ---
const triggers = nodes.filter((n) => String(n.type).startsWith("TRIGGER") || n.type === "BROADCAST_FILTER");
if (triggers.length === 0) errors.push("Нет ни одного триггера (TRIGGER_*) — graph не опубликуется.");
const broadcast = nodes.filter((n) => n.type === "BROADCAST_FILTER");
if (broadcast.length && triggers.length > broadcast.length) errors.push("BROADCAST_FILTER должен быть единственным триггером.");

for (const n of nodes) {
  const c = n.config || {};
  const who = `«${c._title || n.id}» (${n.type})`;
  if (c.igReplyChannel != null && !["comment", "dm"].includes(String(c.igReplyChannel))) {
    warns.push(`${who}: igReplyChannel должен быть "comment" или "dm" (получено "${c.igReplyChannel}")`);
  }
  if (String(c.igReplyChannel) === "dm" && platform !== "INSTAGRAM") {
    warns.push(`${who}: igReplyChannel="dm" учитывается только у Instagram-ботов`);
  }
  switch (n.type) {
    case "SEND_MESSAGE": {
      const flat = !blank(c.text) || !blank(c.photoUrl);
      const lg = Array.isArray(c.cards) && c.cards.length ? cardsToLegacy(c.cards) : { text: c.text || "", photoUrl: c.photoUrl || "" };
      if (!flat) errors.push(`SEND_NO_TEXT: ${who} — пустой config.text/photoUrl.`);
      else if (blank(lg.text) && blank(lg.photoUrl)) errors.push(`SEND_NO_TEXT: ${who} — после cardsToLegacy текст пуст (нет text-карточки с содержимым).`);
      const t = String(c.text || "");
      const lim = !blank(c.photoUrl) ? 1024 : 4096;
      if (t.length > lim) errors.push(`SEND_TOO_LONG: ${who} = ${t.length} > ${lim}.`);
      // HTML-безопасность (эвристика по тегам)
      if (!blank(t) && String(c.parseMode || "").toUpperCase() === "HTML") {
        const bad = [...t.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)]
          .map((m) => m[1].toLowerCase()).filter((tag) => !HTML_OK_TAGS.has(tag));
        if (bad.length) errors.push(`HTML_NOT_SAFE: ${who} — неразрешённые теги: ${[...new Set(bad)].join(", ")}. Разрешено: ${[...HTML_OK_TAGS].join(",")}.`);
      }
      // режим «Вопрос»
      if (c.awaitReply === true) {
        if (!c.saveTo || !VAR_RE.test(c.saveTo)) errors.push(`SEND_BAD_SAVE_TO: ${who} — awaitReply требует saveTo ∈ [a-z_][a-z0-9_]{0,63}.`);
        if (c.validator === "REGEX") {
          if (blank(c.regex)) errors.push(`SEND_BAD_REGEX: ${who} — REGEX-валидатор требует непустой regex.`);
          else { try { new RegExp(c.regex); } catch (e) { errors.push(`SEND_BAD_REGEX: ${who} — ${e.message}.`); } }
        }
      }
      // Кнопки-выборы: если от кнопки идёт ребро btn_N, value ДОЛЖЕН быть пустым —
      // бот сам генерит callback_data n:<id>:<idx>; непустой value → нажатие даёт NO_MATCH.
      {
        const btnIdx = new Set(
          edges.filter((e) => e.sourceNodeId === n.id && /^btn_\d+$/.test(String(e.sourceHandle || "")))
               .map((e) => Number(String(e.sourceHandle).slice(4)))
        );
        (Array.isArray(c.buttons) ? c.buttons : []).flat().forEach((b, i) => {
          if (!b) return;
          if (String(b.kind) === "CALLBACK") {
            const hasVal = !blank(b.value);
            if (hasVal && btnIdx.has(i)) errors.push(`BTN_VALUE_WITH_EDGE: ${who} — кнопка-выбор #${i} («${b.text || ""}») имеет ребро btn_${i} и непустой value «${b.value}»; оставь value пустым, иначе нажатие даст NO_MATCH.`);
            else if (hasVal) warns.push(`${who}: у CALLBACK-кнопки #${i} непустой value «${b.value}» без ребра btn_${i} — это legacy-кнопка под TRIGGER_CALLBACK; для кнопки-выбора нужен пустой value + ребро btn_${i}.`);
          }
          if (b.color) {
            const cc = String(b.color).trim();
            const okColor = ["", "primary", "success", "danger"].includes(cc.toLowerCase())
              || ["#2EA6FF", "#34C759", "#FF3B30"].includes(cc.toUpperCase());
            if (!okColor) warns.push(`${who}: стиль кнопки #${i} «${b.color}» Telegram не рендерит — только ""(дефолт)/primary(#2EA6FF)/success(#34C759)/danger(#FF3B30).`);
          }
        });
      }
      break;
    }
    case "SEND_PHOTO":
      if (blank(c.photoUrl)) errors.push(`PHOTO_NO_URL: ${who} — нужен photoUrl.`);
      if (!blank(c.caption) && String(c.caption).length > 1024) errors.push(`PHOTO_CAPTION_TOO_LONG: ${who} — подпись > 1024.`);
      break;
    case "TRIGGER_COMMAND":
      if (blank(c.command)) errors.push(`${who}: нужен command.`);
      break;
    case "TRIGGER_CALLBACK":
      if (blank(c.value)) errors.push(`${who}: нужен value.`);
      if (c.matchMode && !["EQUALS", "STARTS_WITH"].includes(c.matchMode)) errors.push(`${who}: matchMode ∈ {EQUALS,STARTS_WITH}.`);
      break;
    case "TRIGGER_TEXT":
      if (c.matchMode && c.matchMode !== "ANY" && blank(c.value)) errors.push(`${who}: для matchMode≠ANY нужен value.`);
      break;
    case "ASK_QUESTION":
      if (blank(c.promptText)) errors.push(`${who}: нужен promptText.`);
      if (c.saveTo && !VAR_RE.test(c.saveTo)) errors.push(`${who}: saveTo «${c.saveTo}» не матчит [a-z_][a-z0-9_]{0,63}.`);
      break;
    case "CALL_WEBHOOK":
      if (blank(c.url) || !/^https?:\/\//.test(c.url)) errors.push(`${who}: url обязателен и http(s)://.`);
      break;
    case "DELAY":
      if (c.kind === "FIXED") { if (!(Number(c.durationSec) > 0) && !(Number(c.duration) > 0)) errors.push(`${who}: FIXED требует durationSec>0 (или duration>0 + unit MINUTES|HOURS|DAYS).`); }
      else if (c.kind === "TOMORROW") { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(c.time || ""))) errors.push(`${who}: TOMORROW требует time = HH:mm.`); }
      else if (c.kind === "UNTIL") { if (blank(c.isoTimestamp)) errors.push(`${who}: UNTIL требует isoTimestamp (ISO-8601 UTC). isoDate+time рантайм НЕ читает.`); }
      else errors.push(`${who}: kind ∈ {FIXED,TOMORROW,UNTIL}.`);
      break;
    case "BRANCH":
      if (!Array.isArray(c.cases) || c.cases.length === 0) errors.push(`${who}: нужен хотя бы один case.`);
      break;
    case "CONDITION": {
      if (c.match !== "ALL" && c.match !== "ANY") errors.push(`CONDITION_BAD_MATCH: ${who} — match ∈ {ALL,ANY}.`);
      if (!Array.isArray(c.conditions) || c.conditions.length === 0) {
        errors.push(`CONDITION_EMPTY: ${who} — нужно хотя бы одно условие.`);
        break;
      }
      c.conditions.forEach((cond, i) => {
        if (!cond || typeof cond !== "object") { errors.push(`${who}: условие #${i + 1} — не объект.`); return; }
        const kind = cond.kind;
        // Бэкенд блокирует публикацию только для TAG.value и VARIABLE.key:
        if (kind === "TAG" && !TAG_RE.test(String(cond.value || ""))) errors.push(`CONDITION_BAD_TAG: ${who} — TAG.value ∈ [a-z0-9_-]{1,64}.`);
        if (kind === "VARIABLE" && !VAR_RE.test(String(cond.key || ""))) errors.push(`CONDITION_BAD_KEY: ${who} — VARIABLE.key ∈ [a-z_][a-z0-9_]{0,63}.`);
        // Остальное — подсказки (рантайм бэкенда отдаст false, но публикацию не сорвёт):
        if (!COND_OPS[kind]) warns.push(`${who}: неизвестный kind «${kind}» в условии #${i + 1} — рантайм даст false.`);
        else if (cond.op && !COND_OPS[kind].includes(cond.op)) warns.push(`${who}: op «${cond.op}» не из {${COND_OPS[kind].join(",")}} для ${kind} — рантайм даст false.`);
        if (kind === "SUBSCRIBED" && !/^-?\d+$/.test(String(cond.key || "").trim())) warns.push(`${who}: SUBSCRIBED.key должен быть числовым id канала — иначе false (и бот должен быть админом канала).`);
        if (kind === "UTM" && !cond.key) warns.push(`${who}: UTM без key — рантайм даст false (ожидается source/medium/campaign/content/term).`);
        if (kind === "LINK_CLICKED") {
          const target = nodes.find((x) => x.id === cond.key);
          const tracked = target && (((target.config || {}).buttons) || []).flat().some((b) => b && b.kind === "URL" && b.track === true);
          if (!cond.key || !target) warns.push(`${who}: LINK_CLICKED.key должен быть id шага с отслеживаемой URL-кнопкой — иначе false.`);
          else if (!tracked) warns.push(`${who}: у шага «${(target.config || {})._title || target.id}» из LINK_CLICKED.key нет URL-кнопки с track:true — рантайм даст false.`);
        }
      });
      break;
    }
    case "SET_VARIABLE":
      if (!VAR_RE.test(String(c.key || ""))) errors.push(`VAR_BAD_KEY: ${who} — key ∈ [a-z_][a-z0-9_]{0,63}.`);
      break;
    case "ADD_TAG":
    case "REMOVE_TAG":
      if (!TAG_RE.test(String(c.tag || ""))) errors.push(`TAG_BAD_NAME: ${who} — tag ∈ [a-z0-9_-]{1,64}.`);
      break;
    case "FORMULA":
      if (blank(c.expression)) errors.push(`FORMULA_NO_EXPRESSION: ${who} — нужен expression.`);
      if (!VAR_RE.test(String(c.saveTo || ""))) errors.push(`FORMULA_BAD_SAVE_TO: ${who} — saveTo ∈ [a-z_][a-z0-9_]{0,63}.`);
      break;
    case "SCHEDULE": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.isoDate || "")) || isNaN(Date.parse(c.isoDate))) errors.push(`SCHEDULE_BAD_DATE: ${who} — isoDate = YYYY-MM-DD.`);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(c.time || ""))) errors.push(`SCHEDULE_BAD_TIME: ${who} — time = HH:mm.`);
      break;
    }
    case "ACTIONS": {
      if (!Array.isArray(c.actions) || c.actions.length === 0) { errors.push(`ACTIONS_EMPTY: ${who} — нужен непустой actions[].`); break; }
      c.actions.forEach((a, i) => {
        if (!a || typeof a !== "object") { errors.push(`${who}: действие #${i + 1} — не объект.`); return; }
        if (!ACTION_KINDS.has(a.kind)) { errors.push(`ACTION_UNKNOWN_KIND: ${who} — неизвестный kind «${a.kind}» (#${i + 1}).`); return; }
        if (["add_tag", "remove_tag", "autoflow_add", "autoflow_remove"].includes(a.kind) && !TAG_RE.test(String(a.tag || "")))
          errors.push(`ACTION_BAD_TAG: ${who} — ${a.kind}.tag ∈ [a-z0-9_-]{1,64}.`);
        if (a.kind === "set_field" && !VAR_RE.test(String(a.key || "")))
          errors.push(`ACTION_BAD_KEY: ${who} — set_field.key ∈ [a-z_][a-z0-9_]{0,63}.`);
        if (["subscriber_webhook", "external_request"].includes(a.kind) && !isHttp(a.url))
          errors.push(`ACTION_BAD_URL: ${who} — ${a.kind}.url должен быть http(s)://.`);
      });
      break;
    }
    case "AI_REPLY": {
      if (blank(c.userPromptTemplate)) errors.push(`AI_NO_PROMPT: ${who} — нужен userPromptTemplate.`);
      if (typeof c.temperature === "number" && (c.temperature < 0 || c.temperature > 2)) errors.push(`AI_BAD_TEMPERATURE: ${who} — temperature ∈ [0.0, 2.0].`);
      if (c.sendToUser !== true && blank(c.saveTo)) errors.push(`AI_NO_OUTPUT: ${who} — нужен sendToUser:true или saveTo.`);
      break;
    }
    case "PAYMENT_LINK": {
      const u = String(c.paymentUrl || "");
      if (blank(u)) errors.push(`PAY_NO_URL: ${who} — нужен paymentUrl.`);
      else if (!isHttp(u) && !u.startsWith("{{")) errors.push(`PAY_BAD_SCHEME: ${who} — paymentUrl = http(s):// или {{var.x}}.`);
      break;
    }
  }
}

// --- достижимость от триггеров ---
const adj = {};
for (const e of edges) (adj[e.sourceNodeId] = adj[e.sourceNodeId] || []).push(e.targetNodeId);
const reach = new Set();
const stack = triggers.map((t) => t.id);
while (stack.length) { const x = stack.pop(); if (reach.has(x)) continue; reach.add(x); (adj[x] || []).forEach((y) => stack.push(y)); }
for (const n of nodes) {
  if (String(n.type).startsWith("TRIGGER") || n.type === "BROADCAST_FILTER") continue;
  if (!reach.has(n.id)) errors.push(`Недостижимый узел от триггера: «${n.config?._title || n.id}» (${n.type}).`);
}

// --- синхронные циклы (цикл без DELAY/ASK_QUESTION/SCHEDULE = ошибка) ---
const waitTypes = new Set(["ASK_QUESTION", "DELAY", "SCHEDULE"]);
const typeById = Object.fromEntries(nodes.map((n) => [n.id, n.type]));
const color = {}; // 0=white,1=gray,2=black
function dfs(u, pathHasWaitAtEdgeInto) {
  color[u] = 1;
  for (const v of adj[u] || []) {
    if (color[v] === 1) {
      // нашли цикл u->...->v; ок только если в цикле есть wait-узел
      // упрощённо: если ни u, ни v не wait — предупредим как потенциальный синхронный цикл
      if (!waitTypes.has(typeById[u]) && !waitTypes.has(typeById[v]))
        warns.push(`Возможный синхронный цикл рядом с ${v} — убедись, что в петле есть DELAY/ASK_QUESTION/SCHEDULE.`);
    } else if (color[v] !== 2) {
      dfs(v);
    }
  }
  color[u] = 2;
}
for (const n of nodes) if (!color[n.id]) dfs(n.id);

// ============================================================
// --- IG-специфические проверки (только для INSTAGRAM) ---
// Зеркало GraphValidator.platformErrors() (Java).
// IG_ALLOWED_NODES: TRIGGER_IG_COMMENT, TRIGGER_IG_DM, TRIGGER_IG_STORY_REPLY,
//   TRIGGER_IG_STORY_MENTION, SEND_MESSAGE, SEND_PHOTO, BRANCH, CONDITION,
//   SET_VARIABLE, ADD_TAG, REMOVE_TAG, FORMULA, ASK_QUESTION, DELAY, END.
// IG_ALLOWED_INPUT_KINDS: TEXT, EMAIL, PHONE, NUMBER, CONTACT (CONTACT деградирует в ручной ввод номера — кнопки в IG нет).
// IG_MAX_DELAY_SECONDS: 86400 (24 часа).
// ============================================================

if (platform === "INSTAGRAM") {
  const IG_ALLOWED_NODES = new Set([
    "TRIGGER_IG_COMMENT", "TRIGGER_IG_DM",
    "TRIGGER_IG_STORY_REPLY", "TRIGGER_IG_STORY_MENTION",
    "SEND_MESSAGE", "SEND_PHOTO",
    "BRANCH", "CONDITION", "SET_VARIABLE",
    "ADD_TAG", "REMOVE_TAG", "FORMULA",
    "ASK_QUESTION", "DELAY", "END",
  ]);
  const IG_ALLOWED_INPUT_KINDS = new Set(["TEXT", "EMAIL", "PHONE", "NUMBER", "CONTACT"]);
  const IG_MAX_DELAY_SEC = 86400; // 24h messaging window

  function igDelaySeconds(c) {
    // Зеркало GraphValidator.igDelaySeconds():
    // только FIXED считаем конкретно; TOMORROW/UNTIL — всегда > 24h (Long.MAX_VALUE)
    if (!c || c.kind !== "FIXED") return Infinity;
    // legacy: durationSec
    if (typeof c.durationSec === "number") return c.durationSec;
    // new format: duration + unit
    if (typeof c.duration === "number") {
      const u = String(c.unit || "");
      if (u === "MINUTES") return c.duration * 60;
      if (u === "HOURS")   return c.duration * 3600;
      if (u === "DAYS")    return c.duration * 86400;
      return c.duration; // assume seconds
    }
    return Infinity; // malformed FIXED — treat as unbounded (block it)
  }

  // Достижимость от триггеров-комментариев: «Ответ в комментарии» (igReplyChannel="comment")
  // имеет смысл только в сценарии, запускаемом комментарием (иначе отвечать в комментарии некуда).
  const reachFromComment = new Set();
  {
    const st = nodes.filter((n) => n.type === "TRIGGER_IG_COMMENT").map((n) => n.id);
    while (st.length) { const x = st.pop(); if (reachFromComment.has(x)) continue; reachFromComment.add(x); (adj[x] || []).forEach((y) => st.push(y)); }
  }

  for (const n of nodes) {
    const type = n.type;
    const c = n.config || {};
    const who = `«${c._title || n.id}» (${type})`;
    if (!type) continue;

    // 1) Проверка allowlist
    if (!IG_ALLOWED_NODES.has(type)) {
      errors.push(`IG_NODE_UNSUPPORTED: ${who} — узел «${type}» недоступен для Instagram-бота`);
      continue; // дальнейшие проверки для этого узла бессмысленны
    }

    // 2) ASK_QUESTION: inputKind должен быть из IG_ALLOWED_INPUT_KINDS
    if (type === "ASK_QUESTION") {
      const kind = c.inputKind;
      if (kind != null && !IG_ALLOWED_INPUT_KINDS.has(String(kind).toUpperCase())) {
        errors.push(`IG_INPUT_UNSUPPORTED: ${who} — В Instagram нельзя запросить «${kind}» — только TEXT/EMAIL/PHONE/NUMBER/CONTACT (CONTACT = ручной ввод номера)`);
      }
    }

    // 3) DELAY: не более 24h (только для FIXED; TOMORROW/UNTIL всегда > 24h)
    if (type === "DELAY") {
      const sec = igDelaySeconds(c);
      if (sec > IG_MAX_DELAY_SEC) {
        errors.push(`IG_DELAY_OVER_24H: ${who} — задержка больше 24ч недопустима для Instagram (24-часовое окно доставки)`);
      }
    }

    // 4) «Ответ в комментарии» только в сценарии с триггером-комментарием
    if ((type === "SEND_MESSAGE" || type === "SEND_PHOTO")
        && String(c.igReplyChannel) === "comment" && !reachFromComment.has(n.id)) {
      errors.push(`IG_COMMENT_REPLY_NO_COMMENT_TRIGGER: ${who} — «Ответ в комментарии» доступен только если шаг запускается триггером «Комментарий»; выбери «Личное сообщение» (igReplyChannel:"dm") или подключи шаг к TRIGGER_IG_COMMENT`);
    }

    // 4) TRIGGER_IG_STORY_MENTION: keywords игнорируется — текста упоминания нет
    if (type === "TRIGGER_IG_STORY_MENTION" && !blank(c.keywords)) {
      warns.push(`${who}: TRIGGER_IG_STORY_MENTION не фильтруется по ключевым словам (у упоминания нет текста) — keywords игнорируется`);
    }
  }
}

// --- отчёт ---
const byType = {};
nodes.forEach((n) => (byType[n.type] = (byType[n.type] || 0) + 1));
console.log(`Платформа: ${platform}`);
console.log(`Граф: ${nodes.length} узлов, ${edges.length} рёбер, ${triggers.length} триггеров`);
console.log(`Типы: ${JSON.stringify(byType)}`);
if (warns.length) { console.log(`\n⚠️  Предупреждения (${warns.length}):`); warns.forEach((w) => console.log("  • " + w)); }
if (errors.length) {
  console.log(`\n❌ Ошибки (${errors.length}) — публикация не пройдёт:`);
  errors.forEach((e) => console.log("  • " + e));
  process.exit(1);
}
console.log("\n✅ Валидация пройдена — граф готов к заливке/публикации.");
