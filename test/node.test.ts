import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_VERSION, type AgentCard } from "../src/contracts.js";
import { MeshNode } from "../src/node.js";
import type { PolicyDocument } from "../src/policy.js";

const card: AgentCard = { protocolVersion: PROTOCOL_VERSION, id: "vps-observer", name: "VPS observer", endpoint: "http://localhost:8400", capabilities: ["service.diagnostics", "service.restart"], status: "available" };
const policy: PolicyDocument = { version: 1, default: "deny", rules: [
  { caller: "agent://laptop", capabilities: ["service.diagnostics"], decision: "allow" },
  { caller: "agent://laptop", capabilities: ["service.restart"], decision: "approval" },
] };

test("allows declared read-only capability and stores evidence", async () => {
  const node = new MeshNode(card, policy);
  node.register("service.diagnostics", async () => ({ summary: "Database unhealthy", evidence: ["health check failed"] }));
  const task = await node.createTask({ protocolVersion: PROTOCOL_VERSION, caller: "agent://laptop", targetCapability: "service.diagnostics", input: {}, constraints: { readOnly: true } });
  assert.equal(task.status, "completed");
  assert.deepEqual(task.result?.evidence, ["health check failed"]);
});

test("denies undeclared caller capability by default", async () => {
  const node = new MeshNode(card, policy);
  const task = await node.createTask({ protocolVersion: PROTOCOL_VERSION, caller: "agent://unknown", targetCapability: "service.diagnostics", input: {} });
  assert.equal(task.status, "denied");
  assert.equal(task.error?.code, "POLICY_DENIED");
});

test("holds privileged capability for approval", async () => {
  const node = new MeshNode(card, policy);
  node.register("service.restart", async () => ({ summary: "Restarted" }));
  const task = await node.createTask({ protocolVersion: PROTOCOL_VERSION, caller: "agent://laptop", targetCapability: "service.restart", input: {} });
  assert.equal(task.status, "awaiting_approval");
  const approved = await node.approveTask(task.id);
  assert.equal(approved?.status, "completed");
});
