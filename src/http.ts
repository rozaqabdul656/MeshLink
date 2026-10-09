import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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
  const root = path.resolve(process.cwd(), "dashboard");
  const filePath = path.resolve(root, file);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) { response.writeHead(404); response.end("Not found"); return; }
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8" };
  response.writeHead(200, { "content-type": types[path.extname(filePath)] ?? "application/octet-stream" }); response.end(fs.readFileSync(filePath));
}
function token(request: IncomingMessage): string | undefined {
  return request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("meshlink_session="))?.slice("meshlink_session=".length);
}
function loginPage(warning: boolean): string { return `<!doctype html><meta charset="utf-8"><title>MeshLink login</title><main><h1>MeshLink dashboard</h1>${warning ? '<p role="alert">Default password is meshlink. Set MESHLINK_DASHBOARD_PASSWORD before network exposure.</p>' : ""}<form method="post" action="/login"><label>Password <input name="password" type="password" required autofocus></label><button>Sign in</button></form></main>`; }

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
        if (!result.ok) { response.writeHead(401, { "content-type": "text/html; charset=utf-8" }); response.end(loginPage(configured.fallback)); return; }
        response.writeHead(303, { location: "/", "set-cookie": result.cookie }); response.end(); return;
      }
      if (request.method === "POST" && url.pathname === "/logout") { response.writeHead(303, { location: "/login", "set-cookie": auth.clearCookie }); response.end(); return; }
      if (dashboardPath && !auth.valid(token(request))) { send(response, 401, { error: "DASHBOARD_AUTH_REQUIRED", message: "Sign in at /login" }); return; }
      if (request.method === "GET" && url.pathname === "/dashboard/api/agents") return send(response, 200, { agents: [...node.listAgents(), ...node.registry.list()] });
      if (request.method === "GET" && url.pathname === "/dashboard/api/tasks") return send(response, 200, { tasks: node.listTasks() });
      if (request.method === "GET" && url.pathname === "/dashboard/api/audit") return send(response, 200, { events: node.listAudit() });
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) return sendDashboard(response, "index.html");
      if (request.method === "GET" && url.pathname.startsWith("/dashboard/")) return sendDashboard(response, url.pathname.slice("/dashboard/".length));
      if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, protocolVersion: PROTOCOL_VERSION });
      if (request.method === "GET" && url.pathname === "/v1/agents") return send(response, 200, { agents: [...node.listAgents(), ...node.registry.list()] });
      if (request.method === "POST" && url.pathname === "/v1/agents") { node.registry.upsert(await body(request) as import("./contracts.js").AgentCard); return send(response, 201, { ok: true }); }
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
