#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateKeyPairSync } from "node:crypto";
import { PROTOCOL_VERSION, type Task } from "./contracts.js";
import { createHttpServer } from "./http.js";
import { MeshNode } from "./node.js";
import { loadPolicy } from "./policy.js";
import { loadSigningIdentity, signedHeaders } from "./identity.js";

const diagnosticsCapability = "service.diagnostics";

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function createNode(args: string[]): MeshNode {
  const port = option(args, "--port", "20128")!;
  const host = option(args, "--host", "127.0.0.1")!;
  const endpoint = option(args, "--endpoint", host === "127.0.0.1" || host === "localhost" ? `http://127.0.0.1:${port}` : undefined);
  if (!endpoint) throw new Error("--endpoint is required when --host is not loopback so other nodes receive a reachable address");
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

async function registerWithHub(node: MeshNode, hub: string, leaseSeconds: number, registrationToken?: string): Promise<void> {
  const response = await fetch(`${hub.replace(/\/$/, "")}/v1/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(registrationToken ? { "x-meshlink-registration-token": registrationToken } : {}),
    },
    body: JSON.stringify({ card: node.card, leaseSeconds }),
  });
  if (!response.ok) throw new Error(`Hub registration failed with HTTP ${response.status}`);
}

async function startNode(args: string[]): Promise<void> {
  const port = Number(option(args, "--port", "20128"));
  const host = option(args, "--host", "127.0.0.1")!;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be between 1 and 65535");
  const node = createNode(args);
  const server = createHttpServer(node);
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  process.stdout.write(`MeshLink node ${node.card.id} is running.\n🎉 Dashboard opens at ${node.card.endpoint}\n`);
  const hub = option(args, "--hub");
  if (!hub) return;
  const leaseSeconds = Number(option(args, "--lease-seconds", "90"));
  const heartbeatSeconds = Number(option(args, "--heartbeat-seconds", "30"));
  if (!Number.isFinite(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) throw new Error("--lease-seconds must be between 10 and 3600");
  if (!Number.isFinite(heartbeatSeconds) || heartbeatSeconds < 5 || heartbeatSeconds >= leaseSeconds) throw new Error("--heartbeat-seconds must be at least 5 and lower than --lease-seconds");
  const registrationToken = option(args, "--registration-token", process.env.MESHLINK_REGISTRATION_TOKEN);
  const announce = async () => {
    try {
      await registerWithHub(node, hub, leaseSeconds, registrationToken);
      process.stdout.write(`Registered with hub ${hub}. Lease renews every ${heartbeatSeconds}s.\n`);
    } catch (error) {
      process.stderr.write(`MeshLink hub registration failed: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    }
  };
  await announce();
  setInterval(() => { void announce(); }, heartbeatSeconds * 1000).unref();
}

async function sendTask(nodeUrl: string, caller: string, capability: string, instruction: string, readOnly: boolean): Promise<Task> {
  const base = nodeUrl.replace(/\/$/, "");
  const agentsResponse = await fetch(`${base}/v1/agents/capability?capability=${encodeURIComponent(capability)}`);
  const agents = agentsResponse.ok ? await agentsResponse.json() as { agents?: Array<{ endpoint: string }> } : {};
  const target = agents.agents?.[0]?.endpoint ?? base;
  const body = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, targetCapability: capability, input: { instruction }, constraints: { readOnly } });
  const identity = loadSigningIdentity();
  if (identity && identity.id !== caller) throw new Error("MESHLINK_AGENT_ID must match the MCP --caller value");
  const response = await fetch(`${target.replace(/\/$/, "")}/v1/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-meshlink-agent": caller, ...(identity ? signedHeaders(identity, "POST", "/v1/tasks", body) : {}) },
    body,
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
  if (!command || command === "start") return startNode(args);
  if (command.startsWith("--")) return startNode([command, ...args]);
  if (command === "node") return startNode(args[0] === "start" ? args.slice(1) : args);
  if (command === "mcp") return startMcp(args);
  if (command === "identity" && args[0] === "generate") {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    process.stdout.write(JSON.stringify({ kid: option(args, "--kid", "key-1"), privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString("base64"), publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() }, null, 2) + "\n");
    return;
  }
  process.stderr.write("Usage: meshlink [start] [--port 20128] [--host 127.0.0.1] [--hub URL] | meshlink node start | meshlink mcp\n");
  process.exitCode = 1;
}

void main();
