#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PROTOCOL_VERSION, type Task } from "./contracts.js";
import { createHttpServer } from "./http.js";
import { MeshNode } from "./node.js";
import { loadPolicy } from "./policy.js";

const diagnosticsCapability = "service.diagnostics";

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function createNode(args: string[]): MeshNode {
  const port = option(args, "--port", "8400")!;
  const endpoint = option(args, "--endpoint", `http://127.0.0.1:${port}`)!;
  const name = option(args, "--name", "meshlink-node")!;
  const id = option(args, "--id", name)!;
  const node = new MeshNode({
    protocolVersion: PROTOCOL_VERSION,
    id,
    name,
    endpoint,
    capabilities: [diagnosticsCapability],
    status: "available",
  }, loadPolicy(option(args, "--policy")));
  node.register(diagnosticsCapability, async (request) => ({
    summary: `Diagnostics request accepted by ${name}`,
    evidence: ["Phase 1 sample handler: attach Docker, health, or log adapters here.", `readOnly=${request.constraints?.readOnly ?? false}`],
    data: { receivedInput: request.input },
  }));
  return node;
}

async function startNode(args: string[]): Promise<void> {
  const port = Number(option(args, "--port", "8400"));
  const node = createNode(args);
  const server = createHttpServer(node);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  process.stdout.write(`MeshLink node ${node.card.id} listening at ${node.card.endpoint}\n`);
}

async function sendTask(nodeUrl: string, caller: string, capability: string, instruction: string, readOnly: boolean): Promise<Task> {
  const base = nodeUrl.replace(/\/$/, "");
  const agentsResponse = await fetch(`${base}/v1/agents/capability?capability=${encodeURIComponent(capability)}`);
  const agents = agentsResponse.ok ? await agentsResponse.json() as { agents?: Array<{ endpoint: string }> } : {};
  const target = agents.agents?.[0]?.endpoint ?? base;
  const response = await fetch(`${target.replace(/\/$/, "")}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-meshlink-agent": caller },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, targetCapability: capability, input: { instruction }, constraints: { readOnly } }),
  });
  return await response.json() as Task;
}

async function startMcp(args: string[]): Promise<void> {
  const nodeUrl = option(args, "--node", process.env.MESHLINK_NODE_URL ?? "http://127.0.0.1:8400")!;
  const caller = option(args, "--caller", process.env.MESHLINK_AGENT_ID ?? "agent://local-host")!;
  const server = new McpServer({ name: "meshlink", version: "0.1.0" });

  server.registerTool("mesh_find_agents", {
    description: "List MeshLink agents registered on the configured node.",
  }, async () => {
    const response = await fetch(`${nodeUrl.replace(/\/$/, "")}/v1/agents`);
    const payload = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  });

  server.registerTool("mesh_send_task", {
    description: "Send a capability-scoped task through MeshLink. Remote policy decides whether it may run.",
    inputSchema: {
      capability: z.string().describe("Capability ID, for example service.diagnostics"),
      instruction: z.string().describe("The task for the remote agent"),
      readOnly: z.boolean().default(true).describe("Request read-only execution"),
    },
  }, async ({ capability, instruction, readOnly }) => {
    const task = await sendTask(nodeUrl, caller, capability, instruction, readOnly);
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  });

  server.registerTool("mesh_get_task", {
    description: "Read a MeshLink task status and result by task ID.",
    inputSchema: { taskId: z.string() },
  }, async ({ taskId }) => {
    const response = await fetch(`${nodeUrl.replace(/\/$/, "")}/v1/tasks/${encodeURIComponent(taskId)}`);
    return { content: [{ type: "text", text: JSON.stringify(await response.json(), null, 2) }] };
  });

  await server.connect(new StdioServerTransport());
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command === "node") return startNode(args);
  if (command === "mcp") return startMcp(args);
  process.stderr.write("Usage: meshlink <node|mcp> [options]\n");
  process.exitCode = 1;
}

void main();
