import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PROTOCOL_VERSION, type AgentCard } from "../src/contracts.js";
import { MeshNode } from "../src/node.js";
import { type PolicyDocument } from "../src/policy.js";
import { FileNodeStore } from "../src/store.js";

const card: AgentCard = { protocolVersion: PROTOCOL_VERSION, id: "worker-a", name: "Worker A", endpoint: "http://127.0.0.1:8400", capabilities: ["deploy.release"], status: "available" };
const policy: PolicyDocument = { version: 1, default: "deny", rules: [{ caller: "agent://hermes", capabilities: ["deploy.release"], decision: "allow" }] };

test("restart safely marks interrupted work failed without re-executing it", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meshlink-recovery-"));
  const state = path.join(directory, "state.json");
  try {
    const first = new MeshNode(card, policy, new FileNodeStore(state));
    let executions = 0;
    first.register("deploy.release", async () => {
      executions += 1;
      return await new Promise(() => undefined);
    });
    void first.createTask({ protocolVersion: PROTOCOL_VERSION, caller: "agent://hermes", targetCapability: "deploy.release", input: { release: "v1" } });
    await new Promise((resolve) => setImmediate(resolve));
    const interrupted = first.listTasks()[0];
    assert.equal(interrupted.status, "working");
    assert.equal(executions, 1);

    const restarted = new MeshNode(card, policy, new FileNodeStore(state));
    const recovered = restarted.getTask(interrupted.id);
    assert.equal(recovered?.status, "failed");
    assert.equal(recovered?.error?.code, "WORKER_INTERRUPTED");
    assert.equal(executions, 1);
    assert.ok(restarted.listAudit().some((event) => event.taskId === interrupted.id && event.detail === "Recovered after worker interruption"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
