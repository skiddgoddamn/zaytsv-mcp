#!/usr/bin/env node
/**
 * zaytsv-bot-graph-mcp — MCP-сервер для сборки и публикации воронок ботов
 * (Telegram, MAX, Instagram) через API сервиса zaytsv /bots.
 * Без внешних зависимостей (голый JSON-RPC по stdio).
 *
 * Авторизация (в порядке приоритета):
 *   1) env ZAYTSV_MCP_TOKEN — персональный токен "zmcp_..."
 *   2) файл ~/.zaytsv-bot-graph/token  (заполняется инструментом set_token)
 *   3) session-cookie (ZAYTSV_SESSION_COOKIE / ZAYTSV_COOKIE) — fallback
 *
 * Если токена нет — инструменты не падают с сухой ошибкой, а возвращают пошаговую
 * инструкцию; есть инструменты `setup` (статус + как подключить) и `set_token`
 * (пользователь присылает токен в чат — агент сохраняет его в конфиг, без рестарта).
 *
 * ENV:
 *   ZAYTSV_MCP_TOKEN, ZAYTSV_BASE_URL, ZAYTSV_SESSION_COOKIE, ZAYTSV_COOKIE
 */

import { createInterface } from "node:readline";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const VERSION = "0.7.2";
const BASE = (process.env.ZAYTSV_BASE_URL || "https://zaytsv.ru").replace(/\/+$/, "");
const CONFIG_DIR = path.join(os.homedir(), ".zaytsv-bot-graph");
const TOKEN_FILE = path.join(CONFIG_DIR, "token");
const TOKENS_PAGE = `${BASE}/bots/mcp-tokens`;

function readFileToken() {
  try { return fs.readFileSync(TOKEN_FILE, "utf8").trim(); } catch { return ""; }
}
function getToken() {
  // Если переменная не задана, Claude Code отдаёт шаблон "${ZAYTSV_MCP_TOKEN}" литералом —
  // такой env нельзя считать токеном, иначе он перекрывает файл из set_token (вечный 401).
  const env = (process.env.ZAYTSV_MCP_TOKEN || "").trim();
  if (env && !env.startsWith("${")) return env;
  return readFileToken();
}
function getCookie() {
  return process.env.ZAYTSV_COOKIE ||
    (process.env.ZAYTSV_SESSION_COOKIE ? `SESSION=${process.env.ZAYTSV_SESSION_COOKIE}` : "");
}
function saveToken(token) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token.trim() + "\n", { mode: 0o600 });
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch { /* windows */ }
}
function isAuthed() { return !!(getToken() || getCookie()); }

const NO_AUTH_HELP =
  "Нет доступа к zaytsv /bots — не настроена авторизация.\n\n" +
  `Как подключить (помоги пользователю по шагам):\n` +
  `1) Открой ${TOKENS_PAGE} и войди в аккаунт.\n` +
  `2) Нажми «Создать токен», скопируй секрет (вид zmcp_...). Он показывается один раз.\n` +
  `3) Пришли токен сюда — и я вызову инструмент set_token, чтобы сохранить его. (Или задай env ZAYTSV_MCP_TOKEN.)\n\n` +
  "Подсказка ассистенту: попроси пользователя выполнить шаги 1–2 и прислать токен, затем вызови set_token с этим значением.";

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  const token = getToken();
  const cookie = getCookie();
  if (token) h.Authorization = `Bearer ${token}`;
  else if (cookie) h.Cookie = cookie;
  return h;
}

async function api(path_, { method = "GET", body } = {}) {
  if (!isAuthed()) throw new Error(NO_AUTH_HELP);
  const res = await fetch(`${BASE}${path_}`, {
    method,
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Доступ отклонён (HTTP ${res.status}). Токен невалиден, отозван или истёк.\n` +
        `Создай новый на ${TOKENS_PAGE} и пришли мне — я сохраню через set_token.`);
    }
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`${method} ${path_} → HTTP ${res.status}. ${(msg || "").slice(0, 600)}`);
  }
  return data;
}

const okResult = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const errResult = (e) => ({ isError: true, content: [{ type: "text", text: "❌ " + (e?.message || String(e)) }] });

function extractGraph(g) {
  if (!g || typeof g !== "object") throw new Error("graph должен быть объектом (контейнер zaytsv-bot-graph или {nodes,edges}).");
  const nodes = g.nodes ?? g.graph?.nodes;
  const edges = g.edges ?? g.graph?.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error("В graph нет массивов nodes[] и edges[].");
  return { name: g.name, nodes, edges, canvasMeta: g.canvasMeta ?? {} };
}

const TOOLS = [
  { name: "setup", description: "Показать статус авторизации и пошаговую инструкцию подключения. Вызывай первым, если пользователь не знает, что делать, или при ошибке доступа.", inputSchema: { type: "object", properties: {} } },
  { name: "set_token", description: "Сохранить персональный токен (zmcp_...), который пользователь создал на /bots/mcp-tokens. Применяется сразу, без рестарта.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Секрет токена, начинается с zmcp_" } }, required: ["token"] } },
  { name: "list_bots", description: "Список ботов пользователя (id, имя, статус).", inputSchema: { type: "object", properties: {} } },
  { name: "list_graphs", description: "Список графов (сценариев) бота.", inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] } },
  { name: "list_channels", description: "Список каналов/групп, подключённых к боту (chatId, title, type, статус бота, дата). chatId — числовой id для условия SUBSCRIBED («Подписан на канал»).", inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] } },
  { name: "get_graph", description: "Получить граф целиком по graphId.", inputSchema: { type: "object", properties: { graphId: { type: "string" } }, required: ["graphId"] } },
  { name: "create_graph", description: "Создать пустой граф (DRAFT) в боте. Возвращает граф с id.", inputSchema: { type: "object", properties: { botId: { type: "string" }, name: { type: "string" } }, required: ["botId", "name"] } },
  { name: "update_graph", description: "Залить узлы/рёбра в граф (PUT, сырой replace без бэкапа). Для правок СУЩЕСТВУЮЩЕГО/живого сценария используй edit_graph_live. Принимает graph-контейнер или nodes/edges.", inputSchema: { type: "object", properties: { graphId: { type: "string" }, graph: { type: "object" }, nodes: { type: "array" }, edges: { type: "array" }, canvasMeta: { type: "object" }, name: { type: "string" } }, required: ["graphId"] } },
  { name: "edit_graph_live", description: "РЕКОМЕНДОВАННЫЙ способ правки СУЩЕСТВУЮЩЕГО (часто живого/опубликованного) сценария: редактирует ТОТ ЖЕ graphId НА МЕСТЕ (id не меняется) и сначала снимает авто-бэкап текущего состояния в один rolling-граф «🔙 Авто-бэкап». НЕ клонирует и НЕ создаёт новый активный граф. Открытые редакторы перечитают граф вживую (external_update), бот применит изменения сразу (читает активный граф заново из БД). Используй ВМЕСТО clone+publish, когда нужно поправить сценарий, который уже открыт/в проде. ВАЖНО: PUT не валидирует — перед вызовом прогони offline validate.mjs и dry_run.", inputSchema: { type: "object", properties: { graphId: { type: "string" }, graph: { type: "object" }, nodes: { type: "array" }, edges: { type: "array" }, canvasMeta: { type: "object" }, name: { type: "string" }, backup: { type: "boolean", description: "Снимать авто-бэкап предыдущего состояния перед правкой (по умолчанию true)." } }, required: ["graphId"] } },
  { name: "patch_graph", description: "Точечная правка БОЛЬШОГО/живого графа без отправки графа целиком: сервер сам берёт граф по graphId, делает строковые замены в его JSON, проверяет валидность и заливает обратно НА МЕСТЕ (с авто-бэкапом). Идеально, когда граф слишком велик, чтобы передавать его целиком через update_graph/edit_graph_live — напр. сменить id канала в условиях SUBSCRIBED, ссылки кнопок, тексты. replacements: [{find, replace}] — заменяются ВСЕ вхождения; делай find максимально специфичным, чтобы не задеть лишнее. preview=true — только показать число совпадений, ничего не сохраняя. Бот применит изменения сразу (читает активный граф заново из БД).", inputSchema: { type: "object", properties: { graphId: { type: "string" }, replacements: { type: "array", items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"] } }, preview: { type: "boolean", description: "true = только отчёт о числе совпадений, без сохранения" }, backup: { type: "boolean", description: "снять авто-бэкап предыдущего состояния перед правкой (по умолчанию true)" } }, required: ["graphId", "replacements"] } },
  { name: "dry_run", description: "Прогнать сценарий без публикации. kind: command|callback|text.", inputSchema: { type: "object", properties: { graphId: { type: "string" }, kind: { type: "string", enum: ["command", "callback", "text"] }, value: { type: "string" }, fromUsername: { type: "string" }, presetVariables: { type: "object" }, presetTags: { type: "array", items: { type: "string" } } }, required: ["graphId", "kind", "value"] } },
  { name: "publish_graph", description: "Опубликовать граф. Вернёт publishedGraphId или errors[] (code, nodeId, message).", inputSchema: { type: "object", properties: { graphId: { type: "string" } }, required: ["graphId"] } },
  { name: "import_funnel", description: "Всё за раз: создать граф, залить узлы/рёбра, (опц.) dry-run /start, опубликовать.", inputSchema: { type: "object", properties: { botId: { type: "string" }, name: { type: "string" }, graph: { type: "object" }, dryRun: { type: "boolean" }, publish: { type: "boolean" } }, required: ["botId", "graph"] } },
  { name: "list_templates", description: "Список готовых шаблонов воронок (id, имя, описание). Можно стартовать граф из шаблона вместо сборки с нуля.", inputSchema: { type: "object", properties: {} } },
  { name: "create_graph_from_template", description: "Создать граф (DRAFT) из шаблона (см. list_templates). Возвращает граф с id — дальше правь через update_graph.", inputSchema: { type: "object", properties: { botId: { type: "string" }, templateId: { type: "string" }, name: { type: "string" } }, required: ["botId", "templateId"] } },
  { name: "rename_graph", description: "Переименовать сценарий (работает и для опубликованных — имя не влияет на исполнение).", inputSchema: { type: "object", properties: { graphId: { type: "string" }, name: { type: "string" } }, required: ["graphId", "name"] } },
  { name: "clone_graph", description: "Склонировать граф в новый DRAFT «… (copy)» — безопасно итерировать поверх опубликованного.", inputSchema: { type: "object", properties: { graphId: { type: "string" } }, required: ["graphId"] } },
  { name: "copy_graph", description: "Скопировать граф в ДРУГОГО бота (в т.ч. на другую платформу). Возвращает {graphId, sourcePlatform, targetPlatform, notes[]}. notes[] помечают, что адаптировано (severity=TRANSFORM, напр. вопрос-контакт → ввод телефона текстом), что требует ручной правки (MANUAL, напр. условие SUBSCRIBED в MAX) и особенности платформы (INFO). Авто-адаптация узлов реализована для Telegram⇄MAX; при копировании в/из Instagram-бота граф копируется без трансформаций — несовместимые узлы будут отмечены при публикации (IG-allowlist). preview=true — только проверка совместимости, без копирования. Тот же бот запрещён (для дублирования есть clone_graph).", inputSchema: { type: "object", properties: { graphId: { type: "string" }, targetBotId: { type: "string", description: "id бота-получателя (см. list_bots)" }, preview: { type: "boolean", description: "true = только отчёт о совместимости, ничего не сохраняется" } }, required: ["graphId", "targetBotId"] } },
  { name: "delete_graph", description: "Удалить граф. Активный (опубликованный и назначенный боту) удалить нельзя — будет 409; сначала переключи активный через set_active_graph.", inputSchema: { type: "object", properties: { graphId: { type: "string" } }, required: ["graphId"] } },
  { name: "set_active_graph", description: "Назначить, какой опубликованный граф активен у бота (переключение живого сценария без перепубликации).", inputSchema: { type: "object", properties: { botId: { type: "string" }, graphId: { type: "string" } }, required: ["botId", "graphId"] } },
];

async function handleCall(params) {
  const a = (params && params.arguments) || {};
  switch (params && params.name) {
    case "setup": {
      if (isAuthed()) {
        const via = getToken() ? "персональный токен" : "session-cookie";
        return okResult(`✅ Авторизация настроена (${via}). База API: ${BASE}.\n` +
          `Можно собирать и публиковать ботов: list_bots, create_graph, import_funnel и др.`);
      }
      return okResult(NO_AUTH_HELP);
    }
    case "set_token": {
      const t = (a.token || "").trim();
      if (!t) throw new Error("Передай token — секрет вида zmcp_..., который ты создал на " + TOKENS_PAGE);
      saveToken(t);
      const warn = t.startsWith("zmcp_") ? "" : "\n⚠️ Обычно токен начинается с «zmcp_» — проверь, что скопирован весь секрет.";
      const envTok = (process.env.ZAYTSV_MCP_TOKEN || "").trim();
      const envWarn = envTok && !envTok.startsWith("${") && envTok !== t
        ? "\n⚠️ В окружении задан другой ZAYTSV_MCP_TOKEN — он имеет приоритет над файлом. Убери/обнови env, иначе сохранённый токен не будет использоваться."
        : "";
      // лёгкая проверка валидности
      let check = "";
      try { const bots = await api("/api/tg/bots"); check = `\nПроверка: доступно ботов — ${Array.isArray(bots) ? bots.length : "?"}.`; }
      catch (e) { check = `\n⚠️ Токен сохранён, но проверка не прошла: ${(e.message || "").split("\n")[0]}`; }
      return okResult(`✅ Токен сохранён (${TOKEN_FILE}). Применяется сразу.${warn}${envWarn}${check}`);
    }
    case "list_bots": return okResult(await api("/api/tg/bots"));
    case "list_graphs": return okResult(await api(`/api/tg/bots/${a.botId}/graphs`));
    case "list_channels": return okResult(await api(`/api/tg/bots/${a.botId}/linked-chats`));
    case "get_graph": return okResult(await api(`/api/tg/graphs/${a.graphId}`));
    case "create_graph": return okResult(await api(`/api/tg/bots/${a.botId}/graphs`, { method: "POST", body: { name: a.name } }));
    case "update_graph": {
      const src = a.graph ? extractGraph(a.graph) : { nodes: a.nodes, edges: a.edges, canvasMeta: a.canvasMeta ?? {}, name: a.name };
      if (!Array.isArray(src.nodes) || !Array.isArray(src.edges)) throw new Error("Нужны nodes[] и edges[] (в graph или отдельно).");
      const payload = { nodes: src.nodes, edges: src.edges, canvasMeta: src.canvasMeta ?? {} };
      if (a.name ?? src.name) payload.name = a.name ?? src.name;
      return okResult(await api(`/api/tg/graphs/${a.graphId}`, { method: "PUT", body: payload }));
    }
    case "edit_graph_live": {
      const src = a.graph ? extractGraph(a.graph) : { nodes: a.nodes, edges: a.edges, canvasMeta: a.canvasMeta ?? {}, name: a.name };
      if (!Array.isArray(src.nodes) || !Array.isArray(src.edges)) throw new Error("Нужны nodes[] и edges[] (в graph или отдельно).");
      const steps = [];
      let backupGraphId = null;
      if (a.backup !== false) {
        // снимок ТЕКУЩЕГО (до правки) состояния в один rolling-граф «🔙 Авто-бэкап» (один на бота, перезаписывается)
        const current = await api(`/api/tg/graphs/${a.graphId}`);
        const botId = current.botId;
        const BACKUP_NAME = "🔙 Авто-бэкап (предыдущее состояние)";
        const graphs = await api(`/api/tg/bots/${botId}/graphs`);
        let backup = (Array.isArray(graphs) ? graphs : [])
          .find((g) => g.name === BACKUP_NAME && g.status === "DRAFT" && g.id !== a.graphId);
        if (!backup) backup = await api(`/api/tg/bots/${botId}/graphs`, { method: "POST", body: { name: BACKUP_NAME } });
        backupGraphId = backup.id;
        await api(`/api/tg/graphs/${backup.id}`, { method: "PUT", body: { nodes: current.nodes ?? [], edges: current.edges ?? [], canvasMeta: current.canvasMeta ?? {}, name: BACKUP_NAME } });
        steps.push(`бэкап предыдущего состояния → ${backup.id} (DRAFT «${BACKUP_NAME}»)`);
      }
      const payload = { nodes: src.nodes, edges: src.edges, canvasMeta: src.canvasMeta ?? {} };
      if (a.name ?? src.name) payload.name = a.name ?? src.name;
      const saved = await api(`/api/tg/graphs/${a.graphId}`, { method: "PUT", body: payload });
      steps.push(`правка применена НА МЕСТЕ к ${a.graphId} (id не изменился; редакторы и бот подхватят live)`);
      return okResult({ graphId: a.graphId, backupGraphId, inPlace: true, status: saved?.status ?? null, nodes: Array.isArray(saved?.nodes) ? saved.nodes.length : null, edges: Array.isArray(saved?.edges) ? saved.edges.length : null, steps });
    }
    case "patch_graph": {
      const reps = Array.isArray(a.replacements) ? a.replacements : [];
      if (!reps.length) throw new Error("Передай replacements: [{find, replace}] — хотя бы одну замену.");
      for (const r of reps) {
        if (!r || typeof r.find !== "string" || typeof r.replace !== "string") throw new Error("Каждая замена — объект {find:string, replace:string}.");
        if (r.find === "") throw new Error("find не может быть пустой строкой.");
      }
      const current = await api(`/api/tg/graphs/${a.graphId}`);
      let json = JSON.stringify(current);
      const report = [];
      for (const r of reps) {
        const matches = json.split(r.find).length - 1;
        if (matches > 0) json = json.split(r.find).join(r.replace);
        report.push({ find: r.find, replace: r.replace, matches });
      }
      let patched;
      try { patched = JSON.parse(json); }
      catch (e) { throw new Error("После замен JSON графа стал невалидным — правка ОТМЕНЕНА, граф не тронут. Сделай find более специфичным. " + (e?.message || "")); }
      const total = report.reduce((s, r) => s + r.matches, 0);
      if (a.preview === true) return okResult({ preview: true, graphId: a.graphId, totalMatches: total, replacements: report });
      if (total === 0) return okResult({ graphId: a.graphId, changed: false, note: "Ни одна замена не совпала — граф не изменён.", replacements: report });
      let backupGraphId = null;
      if (a.backup !== false) {
        const botId = current.botId;
        const BACKUP_NAME = "🔙 Авто-бэкап (предыдущее состояние)";
        const graphs = await api(`/api/tg/bots/${botId}/graphs`);
        let backup = (Array.isArray(graphs) ? graphs : [])
          .find((g) => g.name === BACKUP_NAME && g.status === "DRAFT" && g.id !== a.graphId);
        if (!backup) backup = await api(`/api/tg/bots/${botId}/graphs`, { method: "POST", body: { name: BACKUP_NAME } });
        backupGraphId = backup.id;
        await api(`/api/tg/graphs/${backup.id}`, { method: "PUT", body: { nodes: current.nodes ?? [], edges: current.edges ?? [], canvasMeta: current.canvasMeta ?? {}, name: BACKUP_NAME } });
      }
      const payload = { nodes: patched.nodes ?? [], edges: patched.edges ?? [], canvasMeta: patched.canvasMeta ?? {} };
      if (patched.name) payload.name = patched.name;
      const saved = await api(`/api/tg/graphs/${a.graphId}`, { method: "PUT", body: payload });
      return okResult({ graphId: a.graphId, changed: true, totalMatches: total, replacements: report, backupGraphId, inPlace: true, status: saved?.status ?? null, nodes: Array.isArray(saved?.nodes) ? saved.nodes.length : null });
    }
    case "dry_run":
      return okResult(await api(`/api/tg/graphs/${a.graphId}/dry-run`, { method: "POST", body: { kind: a.kind, value: a.value, fromUsername: a.fromUsername, presetVariables: a.presetVariables, presetTags: a.presetTags } }));
    case "publish_graph":
      return okResult(await api(`/api/tg/graphs/${a.graphId}/publish`, { method: "POST" }));
    case "import_funnel": {
      const src = extractGraph(a.graph);
      const steps = [];
      const created = await api(`/api/tg/bots/${a.botId}/graphs`, { method: "POST", body: { name: a.name || src.name || "Воронка" } });
      const graphId = created.id;
      steps.push(`создан граф ${graphId}`);
      await api(`/api/tg/graphs/${graphId}`, { method: "PUT", body: { nodes: src.nodes, edges: src.edges, canvasMeta: src.canvasMeta ?? {}, name: a.name || src.name } });
      steps.push(`залито узлов: ${src.nodes.length}, рёбер: ${src.edges.length}`);
      if (a.dryRun !== false) {
        const dr = await api(`/api/tg/graphs/${graphId}/dry-run`, { method: "POST", body: { kind: "command", value: "start" } });
        steps.push(`dry-run /start: runStatus=${dr.runStatus}`);
      }
      if (a.publish !== false) {
        const pub = await api(`/api/tg/graphs/${graphId}/publish`, { method: "POST" });
        if (pub.errors && pub.errors.length) {
          steps.push(`❌ публикация не прошла, ошибок: ${pub.errors.length}`);
          return okResult({ graphId, steps, publishErrors: pub.errors });
        }
        steps.push(`✅ опубликовано: publishedGraphId=${pub.publishedGraphId}`);
        return okResult({ graphId, publishedGraphId: pub.publishedGraphId, steps });
      }
      return okResult({ graphId, steps });
    }
    case "list_templates": return okResult(await api("/api/tg/graph-templates"));
    case "create_graph_from_template":
      return okResult(await api(`/api/tg/bots/${a.botId}/graphs/from-template`, { method: "POST", body: { templateId: a.templateId, name: a.name } }));
    case "rename_graph":
      return okResult(await api(`/api/tg/graphs/${a.graphId}/rename`, { method: "PATCH", body: { name: a.name } }));
    case "clone_graph":
      return okResult(await api(`/api/tg/graphs/${a.graphId}/clone`, { method: "POST" }));
    case "copy_graph":
      return okResult(await api(`/api/tg/graphs/${a.graphId}/copy`, { method: "POST", body: { targetBotId: a.targetBotId, preview: a.preview === true } }));
    case "delete_graph":
      await api(`/api/tg/graphs/${a.graphId}`, { method: "DELETE" });
      return okResult(`🗑️ Граф ${a.graphId} удалён.`);
    case "set_active_graph":
      await api(`/api/tg/bots/${a.botId}/active-graph`, { method: "POST", body: { graphId: a.graphId } });
      return okResult(`✅ Активный граф бота ${a.botId} → ${a.graphId}.`);
    default:
      throw new Error(`Неизвестный инструмент: ${params && params.name}`);
  }
}

// ---- JSON-RPC stdio (MCP) ----
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  try {
    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "zaytsv-bot-graph", version: VERSION } } });
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    } else if (method === "tools/call") {
      let result;
      try { result = await handleCall(params); } catch (e) { result = errResult(e); }
      send({ jsonrpc: "2.0", id, result });
    } else if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
    } else if (id !== undefined && id !== null) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    if (id !== undefined && id !== null) send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e?.message || e) } });
  }
});

process.stderr.write(`[zaytsv-bot-graph] MCP ${VERSION}. BASE=${BASE}. Авторизация: ${getToken() ? "токен" : getCookie() ? "cookie" : "не задана (вызови setup)"}.\n`);
