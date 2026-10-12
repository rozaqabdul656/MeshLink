import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PROTOCOL_VERSION, type TaskRequest } from "./contracts.js";
import { MeshNode } from "./node.js";
import { createDashboardAuth, dashboardPassword } from "./auth.js";

async function body(request: IncomingMessage): Promise<unknown> {
  const maxBytes = 64 * 1024;
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  if (!raw) return {};
  const type = request.headers["content-type"] ?? "";
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  return JSON.parse(raw);
}
function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
function sendDashboard(response: ServerResponse, file: string): void {
  // Works from a source checkout and from an npm global installation.
  const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dashboard");
  const filePath = path.resolve(dashboardRoot, file);
  if (!filePath.startsWith(`${dashboardRoot}${path.sep}`) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8" };
  response.writeHead(200, { "content-type": types[path.extname(filePath)] ?? "application/octet-stream" }); response.end(fs.readFileSync(filePath));
}
function token(request: IncomingMessage): string | undefined {
  return request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("meshlink_session="))?.slice("meshlink_session=".length);
}
function registrationAllowed(request: IncomingMessage): boolean {
  const expected = process.env.MESHLINK_REGISTRATION_TOKEN;
  if (!expected) return true;
  const supplied = request.headers["x-meshlink-registration-token"];
  if (typeof supplied !== "string") return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function loginPage(warning: boolean, failed = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · MeshLink</title><style>
  :root{color-scheme:dark;--ink:#f1f7f3;--muted:#9bb1a4;--line:#2b5141;--panel:#10251e;--lime:#c5ff72;--cyan:#78ebd2}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;background:radial-gradient(circle at 15% 15%,#204d3a 0,transparent 29rem),radial-gradient(circle at 90% 90%,#102f2b 0,transparent 28rem),#081611;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.mesh{position:fixed;inset:0;pointer-events:none;opacity:.25;background-image:linear-gradient(#fff1 1px,transparent 1px),linear-gradient(90deg,#fff1 1px,transparent 1px);background-size:38px 38px;mask-image:radial-gradient(circle at center,#000,transparent 74%)}.card{position:relative;width:min(440px,calc(100% - 36px));padding:35px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(145deg,#153127ee,#0c1f18ee);box-shadow:0 28px 90px #0008}.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.04em}.mark{width:32px;height:32px;display:grid;place-items:center;border-radius:9px;background:var(--lime);color:#07130f}.eyebrow{margin:40px 0 10px;color:var(--cyan);font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.13em}.card h1{margin:0;font-size:32px;letter-spacing:-.055em}.copy{margin:11px 0 27px;color:var(--muted);font-size:14px;line-height:1.55}.alert{margin:0 0 16px;padding:10px 12px;border:1px solid #d8aa5b88;border-radius:9px;color:#ffd18a;background:#ffca6712;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.error{border-color:#e6818b88;color:#ffabb3;background:#ff8f9d12}label{display:block;margin-bottom:8px;color:#c1d0c7;font-size:12px;font-weight:700}input{width:100%;padding:13px 14px;border:1px solid #3d6855;border-radius:10px;outline:0;background:#07140f;color:var(--ink);font:15px ui-monospace,SFMono-Regular,Menlo,monospace}input:focus{border-color:var(--lime);box-shadow:0 0 0 4px #c5ff7218}button{width:100%;margin-top:16px;padding:13px;border:0;border-radius:10px;background:var(--lime);color:#0a170f;font-weight:800;cursor:pointer}.footer{margin:24px 0 0;color:#7e9689;text-align:center;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}</style></head><body><div class="mesh"></div><main class="card"><div class="brand"><span class="mark">M</span>MeshLink</div><p class="eyebrow">CONTROL PLANE / LOCAL AUTH</p><h1>Welcome back.</h1><p class="copy">Sign in to inspect your agent network, node health, task history, and policy events.</p>${failed ? '<p class="alert error" role="alert">That password did not match. Try again.</p>' : ""}${warning ? '<p class="alert" role="alert">Development password is active. Set MESHLINK_DASHBOARD_PASSWORD before network exposure.</p>' : ""}<form method="post" action="/login"><label for="password">Dashboard password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Open control plane →</button></form><p class="footer">MESH / POLICY / AUDIT</p></main></body></html>`;
}

export function createHttpServer(node: MeshNode): http.Server {
  const configured = dashboardPassword();
  const auth = createDashboardAuth(configured.password, undefined, false);
  if (configured.fallback) process.stderr.write("Warning: MESHLINK_DASHBOARD_PASSWORD unset; default password meshlink must not be used on a network-exposed node.\n");
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://meshlink.local");
      const dashboardPath = url.pathname === "/" || url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/");
      if (request.method === "GET" && url.pathname === "/login") { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(loginPage(configured.fallback)); return; }
      if (request.method === "POST" && url.pathname === "/login") {
        const raw = await body(request) as Record<string, unknown>;
        const result = auth.login(typeof raw.password === "string" ? raw.password : "");
        if (!result.ok) { response.writeHead(401, { "content-type": "text/html; charset=utf-8" }); response.end(loginPage(configured.fallback, true)); return; }
        response.writeHead(303, { location: "/", "set-cookie": result.cookie }); response.end(); return;
      }
      if (request.method === "POST" && url.pathname === "/logout") { response.writeHead(303, { location: "/login", "set-cookie": auth.clearCookie }); response.end(); return; }
      const dashboardPages: Record<string, string> = {
        "/": "index.html", "/dashboard": "index.html", "/dashboard/nodes": "nodes.html",
        "/dashboard/tasks": "tasks.html", "/dashboard/audit": "audit.html",
      };
      const dashboardDocument = url.pathname in dashboardPages;
      if (dashboardPath && !auth.valid(token(request))) {
        if (request.method === "GET" && dashboardDocument) {
          response.writeHead(303, { location: `/login?next=${encodeURIComponent(url.pathname)}` });
          response.end();
          return;
        }
        send(response, 401, { error: "DASHBOARD_AUTH_REQUIRED", message: "Sign in at /login" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/dashboard/config.js") {
        const apiBase = process.env.MESHLINK_DASHBOARD_API_BASE ?? "";
        response.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
        response.end(`window.__MESHLINK_API_BASE__ = ${JSON.stringify(apiBase)};`);
        return;
      }
      if (request.method === "GET" && url.pathname === "/dashboard/api/node") return send(response, 200, { node: node.card });
      if (request.method === "GET" && url.pathname === "/dashboard/api/nodes") return send(response, 200, { nodes: [...node.listAgents(), ...node.registry.list()] });
      if (request.method === "GET" && url.pathname === "/dashboard/api/agents") return send(response, 200, { agents: [...node.listAgents(), ...node.registry.list()] });
      if (request.method === "GET" && url.pathname === "/dashboard/api/tasks") return send(response, 200, { tasks: node.listTasks() });
      if (request.method === "GET" && url.pathname === "/dashboard/api/audit") return send(response, 200, { events: node.listAudit() });
      if (request.method === "GET" && dashboardDocument) return sendDashboard(response, dashboardPages[url.pathname]);
      if (request.method === "GET" && url.pathname.startsWith("/dashboard/")) return sendDashboard(response, url.pathname.slice("/dashboard/".length));
      if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, protocolVersion: PROTOCOL_VERSION });
      if (request.method === "GET" && url.pathname === "/v1/agents") return send(response, 200, { agents: [...node.listAgents(), ...node.registry.list()] });
      if (request.method === "POST" && url.pathname === "/v1/agents") {
        if (!registrationAllowed(request)) return send(response, 401, { error: "REGISTRATION_TOKEN_REQUIRED" });
        const payload = await body(request) as import("./contracts.js").AgentCard | { card: import("./contracts.js").AgentCard; leaseSeconds?: number };
        const card = "card" in payload ? payload.card : payload;
        const leaseSeconds = "card" in payload ? payload.leaseSeconds : undefined;
        const registered = node.registerRemote(card, leaseSeconds);
        return send(response, 201, { ok: true, agent: registered });
      }
      const agentMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)$/);
      if (request.method === "DELETE" && agentMatch) {
        if (!registrationAllowed(request)) return send(response, 401, { error: "REGISTRATION_TOKEN_REQUIRED" });
        return node.registry.remove(agentMatch[1]) ? send(response, 204, undefined) : send(response, 404, { error: "AGENT_NOT_FOUND" });
      }
      if (request.method === "GET" && url.pathname === "/v1/agents/capability") { const capability = url.searchParams.get("capability") ?? ""; return send(response, 200, { agents: node.registry.list().filter((agent) => agent.status === "available" && agent.capabilities.includes(capability)) }); }
      if (request.method === "GET" && url.pathname === "/v1/tasks") return send(response, 200, { tasks: node.listTasks() });
      if (request.method === "GET" && url.pathname === "/v1/audit") return send(response, 200, { events: node.listAudit() });
      const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
      if (request.method === "GET" && taskMatch) { const task = node.getTask(taskMatch[1]); return task ? send(response, 200, task) : send(response, 404, { error: "TASK_NOT_FOUND" }); }
      const approvalMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/approve$/);
      if (request.method === "POST" && approvalMatch) { const task = await node.approveTask(approvalMatch[1]); return task ? send(response, 200, task) : send(response, 404, { error: "TASK_NOT_FOUND" }); }
      if (request.method === "POST" && url.pathname === "/v1/tasks") { const payload = await body(request) as Omit<TaskRequest, "caller">; const caller = request.headers["x-meshlink-agent"]; if (typeof caller !== "string" || caller.length === 0) return send(response, 401, { error: "CALLER_ID_REQUIRED" }); const task = await node.createTask({ ...payload, caller }); return send(response, task.status === "denied" ? 403 : 202, task); }
      return send(response, 404, { error: "NOT_FOUND" });
    } catch (error) { return send(response, 400, { error: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unknown error" }); }
  });
}
