import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createHttpServer } from "../src/http.js";
import { signedHeaders, type SigningIdentity, type TrustedAgent } from "../src/identity.js";
import { MeshNode } from "../src/node.js";
import { defaultPolicy, type PolicyDocument } from "../src/policy.js";
import { PROTOCOL_VERSION, type AgentCard } from "../src/contracts.js";

function identity(id: string, permissions: TrustedAgent["permissions"]): { identity: SigningIdentity; trusted: TrustedAgent } {
  const pair = generateKeyPairSync("ed25519");
  const kid = `${id}-key`;
  return {
    identity: { id, kid, privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString() },
    trusted: { id, kid, publicKey: pair.publicKey.export({ format: "pem", type: "spki" }).toString(), permissions },
  };
}

async function start(node: MeshNode): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createHttpServer(node);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test("network API denies unknown peers, cross-peer task access, and unscoped approvals", { concurrency: false }, async () => {
  const submitter = identity("agent://hermes", ["task.submit"]);
  const operator = identity("agent://operator", ["task.approve"]);
  const outsider = identity("agent://unknown", ["task.submit", "task.read", "task.approve"]);
  const before = process.env.MESHLINK_TRUSTED_AGENTS;
  const beforeDev = process.env.MESHLINK_INSECURE_DEV_MODE;
  process.env.MESHLINK_TRUSTED_AGENTS = JSON.stringify([submitter.trusted, operator.trusted]);
  delete process.env.MESHLINK_INSECURE_DEV_MODE;
  const card: AgentCard = { protocolVersion: PROTOCOL_VERSION, id: "node-a", name: "Node A", endpoint: "http://127.0.0.1:0", capabilities: ["deploy.release"], status: "available" };
  const policy: PolicyDocument = { ...defaultPolicy, rules: [{ caller: submitter.identity.id, capabilities: ["deploy.release"], decision: "approval" }] };
  const node = new MeshNode(card, policy);
  node.register("deploy.release", async () => ({ summary: "deployed" }));
  const app = await start(node);
  try {
    const raw = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, targetCapability: "deploy.release", input: { release: "v1" } }, null, 2);
    const created = await fetch(`${app.base}/v1/tasks`, { method: "POST", headers: { "content-type": "application/json", ...signedHeaders(submitter.identity, "POST", "/v1/tasks", raw) }, body: raw });
    assert.equal(created.status, 202);
    const task = await created.json() as { id: string; status: string };
    assert.equal(task.status, "awaiting_approval");

    const unknownTask = await fetch(`${app.base}/v1/tasks`, { method: "POST", headers: { "content-type": "application/json", ...signedHeaders(outsider.identity, "POST", "/v1/tasks", raw) }, body: raw });
    assert.equal(unknownTask.status, 401);
    assert.deepEqual(await unknownTask.json(), { error: "UNKNOWN_SIGNING_KEY" });

    const otherTask = await fetch(`${app.base}/v1/tasks/${task.id}`, { headers: signedHeaders(outsider.identity, "GET", `/v1/tasks/${task.id}`, "") });
    assert.equal(otherTask.status, 401);

    const unscopedApproval = await fetch(`${app.base}/v1/tasks/${task.id}/approve`, { method: "POST", headers: signedHeaders(submitter.identity, "POST", `/v1/tasks/${task.id}/approve`, "") });
    assert.equal(unscopedApproval.status, 403);
    assert.deepEqual(await unscopedApproval.json(), { error: "SCOPE_FORBIDDEN" });

    const approved = await fetch(`${app.base}/v1/tasks/${task.id}/approve`, { method: "POST", headers: signedHeaders(operator.identity, "POST", `/v1/tasks/${task.id}/approve`, "") });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json() as { status: string }).status, "completed");
  } finally {
    await app.close();
    if (before === undefined) delete process.env.MESHLINK_TRUSTED_AGENTS; else process.env.MESHLINK_TRUSTED_AGENTS = before;
    if (beforeDev === undefined) delete process.env.MESHLINK_INSECURE_DEV_MODE; else process.env.MESHLINK_INSECURE_DEV_MODE = beforeDev;
  }
});
