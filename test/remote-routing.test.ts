import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_VERSION, type AgentCard } from "../src/contracts.js";
import { AgentRegistry, findAgentsByCapability } from "../src/registry.js";
import { routeTask } from "../src/routing.js";

const remote: AgentCard = {
  protocolVersion: PROTOCOL_VERSION, id: "node-b", name: "Node B", endpoint: "http://127.0.0.1:9001",
  capabilities: ["service.diagnostics"], status: "available",
};

test("registry finds remote agents by capability", () => {
  const registry = new AgentRegistry();
  registry.upsert(remote);
  assert.deepEqual(findAgentsByCapability(registry.list(), "service.diagnostics"), [remote]);
  assert.deepEqual(findAgentsByCapability(registry.list(), "missing"), []);
});

test("registry rejects malformed, duplicate, and non-root endpoints", () => {
  const registry = new AgentRegistry();
  assert.throws(() => registry.upsert({ ...remote, endpoint: "http://169.254.169.254/latest" }), /Invalid MeshLink agent endpoint/);
  registry.upsert(remote);
  assert.throws(() => registry.upsert(remote), /already registered/);
  assert.throws(() => registry.upsert({ ...remote, id: "node-c", capabilities: "bad" as unknown as string[] }), /Invalid MeshLink agent card/);
});

test("routeTask refuses unavailable target and non-task response", async () => {
  await assert.rejects(() => routeTask({ ...remote, status: "offline" }, "agent://node-a", "service.diagnostics", {}), /not available/);
  await assert.rejects(() => routeTask(remote, "agent://node-a", "service.diagnostics", {}, async () => new Response("nope", { status: 200 })), /not a MeshLink task/);
});

test("routeTask sends versioned task to selected remote node", async () => {
  let received: RequestInit | undefined;
  const task = { id: "task-1", status: "completed" };
  const result = await routeTask(remote, "agent://node-a", "service.diagnostics", { instruction: "inspect" },
    async (_url, init) => { received = init; return new Response(JSON.stringify(task), { status: 202 }); });
  assert.deepEqual(result, task);
  assert.equal(received?.method, "POST");
  assert.equal((received?.headers as Record<string, string>)["x-meshlink-agent"], "agent://node-a");
});
