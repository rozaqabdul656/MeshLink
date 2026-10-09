import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PROTOCOL_VERSION, type TaskRequest } from "./contracts.js";
import { MeshNode } from "./node.js";

async function body(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

export function createHttpServer(node: MeshNode): http.Server {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://meshlink.local");
      if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, protocolVersion: PROTOCOL_VERSION });
      if (request.method === "GET" && url.pathname === "/v1/agents") return send(response, 200, { agents: node.listAgents() });
      if (request.method === "GET" && url.pathname === "/v1/audit") return send(response, 200, { events: node.listAudit() });

      const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
      if (request.method === "GET" && taskMatch) {
        const task = node.getTask(taskMatch[1]);
        return task ? send(response, 200, task) : send(response, 404, { error: "TASK_NOT_FOUND" });
      }
      const approvalMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/approve$/);
      if (request.method === "POST" && approvalMatch) {
        const task = await node.approveTask(approvalMatch[1]);
        return task ? send(response, 200, task) : send(response, 404, { error: "TASK_NOT_FOUND" });
      }
      if (request.method === "POST" && url.pathname === "/v1/tasks") {
        const payload = await body(request) as Omit<TaskRequest, "caller">;
        const caller = request.headers["x-meshlink-agent"];
        if (typeof caller !== "string" || caller.length === 0) return send(response, 401, { error: "CALLER_ID_REQUIRED" });
        const task = await node.createTask({ ...payload, caller });
        return send(response, task.status === "denied" ? 403 : 202, task);
      }
      return send(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      return send(response, 400, { error: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });
}
