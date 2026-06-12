#!/usr/bin/env node
/**
 * zaytsv-bot-graph-mcp — MCP-сервер для сборки и публикации графов Telegram-ботов
 * через API сервиса zaytsv /bots. Без внешних зависимостей (голый JSON-RPC по stdio),
 * поэтому работает сразу, без npm install — в Claude Code, Cursor, Windsurf и т.п.
 *
 * Авторизация: персональный токен (PAT) Bearer; fallback — session-cookie.
 *
 * ENV:
 *   ZAYTSV_MCP_TOKEN       персональный токен "zmcp_..." (создаётся в вебе: /bots/mcp-tokens)
 *   ZAYTSV_BASE_URL        база API. По умолчанию https://zaytsv.ru (дев: http://localhost:8066)
 *   ZAYTSV_SESSION_COOKIE  (fallback) значение куки SESSION из браузера
 *   ZAYTSV_COOKIE          (fallback) полная строка Cookie
 */

import { createInterface } from "node:readline";

const VERSION = "0.1.0";
const BASE = (process.env.ZAYTSV_BASE_URL || "https://zaytsv.ru").replace(/\/+$/, "");
const TOKEN = (process.env.ZAYTSV_MCP_TOKEN || "").trim();
const COOKIE =
  process.env.ZAYTSV_COOKIE ||
  (process.env.ZAYTSV_SESSION_COOKIE ? `SESSION=${process.env.ZAYTSV_SESSION_COOKIE}` : "");

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  else if (COOKIE) h.Cookie = COOKIE;
  return h;
}

async function api(path, { method = "GET", body } = {}) {
  if (!TOKEN && !COOKIE) {
    throw new Error("Не задана авторизация: установи ZAYTSV_MCP_TOKEN (рекомендуется) или ZAYTSV_SESSION_COOKIE в env.");
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`${method} ${path} → HTTP ${res.status}. ${(msg || "").slice(0, 600)}`);
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
  { name: "list_bots", description: "Список ботов пользователя (id, имя, статус).", inputSchema: { type: "object", properties: {} } },
  { name: "list_graphs", description: "Список графов (сценариев) бота.", inputSchema: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] } },
  { name: "get_graph", description: "Получить граф целиком по graphId.", inputSchema: { type: "object", properties: { graphId: { type: "string" } }, required: ["graphId"] } },
  { name: "create_graph", description: "Создать пустой граф (DRAFT) в боте. Возвращает граф с id.", inputSchema: { type: "object", properties: { botId: { type: "string" }, name: { type: "string" } }, required: ["botId", "name"] } },
  { name: "update_graph", description: "Залить узлы/рёбра в граф (PUT). Принимает graph-контейнер или nodes/edges.", inputSchema: { type: "object", properties: { graphId: { type: "string" }, graph: { type: "object" }, nodes: { type: "array" }, edges: { type: "array" }, canvasMeta: { type: "object" }, name: { type: "string" } }, required: ["graphId"] } },
  { name: "dry_run", description: "Прогнать сценарий без публикации. kind: command|callback|text.", inputSchema: { type: "object", properties: { graphId: { type: "string" }, kind: { type: "string", enum: ["command", "callback", "text"] }, value: { type: "string" }, fromUsername: { type: "string" }, presetVariables: { type: "object" }, presetTags: { type: "array", items: { type: "string" } } }, required: ["graphId", "kind", "value"] } },
  { name: "publish_graph", description: "Опубликовать граф. Вернёт publishedGraphId или errors[] (code, nodeId, message).", inputSchema: { type: "object", properties: { graphId: { type: "string" } }, required: ["graphId"] } },
  { name: "import_funnel", description: "Всё за раз: создать граф, залить узлы/рёбра, (опц.) dry-run /start, опубликовать.", inputSchema: { type: "object", properties: { botId: { type: "string" }, name: { type: "string" }, graph: { type: "object" }, dryRun: { type: "boolean" }, publish: { type: "boolean" } }, required: ["botId", "graph"] } },
];

async function handleCall(params) {
  const a = (params && params.arguments) || {};
  switch (params && params.name) {
    case "list_bots": return okResult(await api("/api/tg/bots"));
    case "list_graphs": return okResult(await api(`/api/tg/bots/${a.botId}/graphs`));
    case "get_graph": return okResult(await api(`/api/tg/graphs/${a.graphId}`));
    case "create_graph": return okResult(await api(`/api/tg/bots/${a.botId}/graphs`, { method: "POST", body: { name: a.name } }));
    case "update_graph": {
      const src = a.graph ? extractGraph(a.graph) : { nodes: a.nodes, edges: a.edges, canvasMeta: a.canvasMeta ?? {}, name: a.name };
      if (!Array.isArray(src.nodes) || !Array.isArray(src.edges)) throw new Error("Нужны nodes[] и edges[] (в graph или отдельно).");
      const payload = { nodes: src.nodes, edges: src.edges, canvasMeta: src.canvasMeta ?? {} };
      if (a.name ?? src.name) payload.name = a.name ?? src.name;
      return okResult(await api(`/api/tg/graphs/${a.graphId}`, { method: "PUT", body: payload }));
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
      // неизвестный метод с id — корректный JSON-RPC error; нотификации игнорируем
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    if (id !== undefined && id !== null) send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e?.message || e) } });
  }
});

process.stderr.write(`[zaytsv-bot-graph] MCP ${VERSION}. BASE=${BASE}. Авторизация: ${TOKEN ? "токен (Bearer)" : COOKIE ? "cookie" : "НЕ задана"}.\n`);
