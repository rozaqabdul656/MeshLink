import assert from "node:assert/strict";
import test from "node:test";
import { createSandboxedWorker } from "../src/worker.js";
import { PROTOCOL_VERSION } from "../src/contracts.js";

const request = (input: Record<string, unknown> = {}, readOnly = true) => ({ protocolVersion: PROTOCOL_VERSION, caller: "agent://hermes", targetCapability: "qa.unit", input, constraints: { readOnly } });

test("sandbox worker executes only profile-defined command with bounded output", async () => {
  const worker = createSandboxedWorker({ name: "QA", workdir: process.cwd(), timeoutSeconds: 2, maxOutputBytes: 1024, commands: { "qa.unit": { command: process.execPath, args: ["-e", "process.stdout.write('passed')"], readOnly: true } } });
  const result = await worker.handler("qa.unit")(request());
  assert.equal(result.summary, "QA completed qa.unit");
  assert.deepEqual(result.evidence, ["passed"]);
});

test("sandbox worker rejects remote shell controls and write capability in read-only mode", async () => {
  const worker = createSandboxedWorker({ name: "Hermes", workdir: process.cwd(), commands: { "repo.apply": { command: process.execPath, args: ["-e", ""], readOnly: false } } });
  await assert.rejects(() => worker.handler("repo.apply")(request({ command: "rm -rf /" }, false)), /RAW_COMMAND_INPUT_FORBIDDEN/);
  await assert.rejects(() => worker.handler("repo.apply")(request()), /READ_ONLY_CONSTRAINT_FORBIDS_CAPABILITY/);
});
