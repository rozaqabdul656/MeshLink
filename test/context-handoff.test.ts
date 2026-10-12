import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_VERSION, type AgentCard, type TaskContext } from "../src/contracts.js";
import { MeshNode } from "../src/node.js";
import type { PolicyDocument } from "../src/policy.js";

const card = (id: string, capability: string): AgentCard => ({ protocolVersion: PROTOCOL_VERSION, id, name: id, endpoint: "http://127.0.0.1:8400", capabilities: [capability], status: "available" });
const policy = (caller: string, capability: string): PolicyDocument => ({ version: 1, default: "deny", rules: [{ caller, capabilities: [capability], decision: "allow" }] });

test("Hermes can hand Codex's compact commit context to QA without source history", async () => {
  const hermes = "agent://hermes-mac";
  const codex = "agent://codex-vps";
  const handoff: TaskContext = {
    id: "ctx-release-42",
    summary: "Implement a retry-safe release worker and return a reviewable commit.",
  };
  const codexContext: TaskContext = {
    id: handoff.id,
    summary: "Implement retry-safe release worker; commit abc123 is ready for QA.",
    artifacts: [{ uri: "artifact://git/abc123", sha256: "a".repeat(64), mediaType: "text/plain" }],
  };
  const codexNode = new MeshNode(card("codex-vps", "code.change"), policy(hermes, "code.change"));
  codexNode.register("code.change", async (request) => {
    assert.equal(request.context?.id, handoff.id);
    assert.equal("history" in (request.context ?? {}), false);
    return { summary: "Committed implementation", context: codexContext };
  });
  const codexTask = await codexNode.createTask({ protocolVersion: PROTOCOL_VERSION, caller: hermes, targetCapability: "code.change", input: { instruction: "implement" }, context: handoff });
  assert.equal(codexTask.status, "completed");
  assert.equal(codexTask.result?.context?.artifacts?.[0]?.uri, "artifact://git/abc123");

  const qaNode = new MeshNode(card("qa-vps", "code.review"), policy(codex, "code.review"));
  qaNode.register("code.review", async (request) => {
    assert.equal(request.context?.id, handoff.id);
    assert.match(request.context?.summary ?? "", /commit abc123/);
    assert.equal("history" in (request.context ?? {}), false);
    return { summary: "QA passed", evidence: [request.context!.artifacts![0].sha256] };
  });
  const qaTask = await qaNode.createTask({ protocolVersion: PROTOCOL_VERSION, caller: codex, targetCapability: "code.review", input: { instruction: "review artifact" }, context: codexTask.result?.context });
  assert.equal(qaTask.status, "completed");
  assert.equal(qaTask.result?.evidence?.[0], "a".repeat(64));
});
