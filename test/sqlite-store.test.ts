import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteNodeStore } from "../src/store.js";

test("SQLite store migrates and preserves durable node state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meshlink-sqlite-"));
  const database = path.join(directory, "state.db");
  try {
    const store = new SqliteNodeStore(database);
    store.save({ tasks: [{ id: "task-1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", request: { protocolVersion: "meshlink/v1", caller: "agent://a", targetCapability: "x", input: {} }, status: "completed" }], audit: [] });
    assert.equal(new SqliteNodeStore(database).load().tasks[0]?.id, "task-1");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
