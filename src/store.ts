import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuditEvent, Task } from "./contracts.js";

export type NodeSnapshot = { tasks: Task[]; audit: AuditEvent[] };

export interface NodeStore {
  load(): NodeSnapshot;
  save(snapshot: NodeSnapshot): void;
}

export class MemoryNodeStore implements NodeStore {
  public load(): NodeSnapshot { return { tasks: [], audit: [] }; }
  public save(_snapshot: NodeSnapshot): void {}
}

/**
 * Atomic, single-node durable state. A later clustered deployment can provide
 * the same interface with Postgres while retaining MeshNode's recovery rules.
 */
export class FileNodeStore implements NodeStore {
  public constructor(private readonly filePath: string) {}

  public load(): NodeSnapshot {
    if (!fs.existsSync(this.filePath)) return { tasks: [], audit: [] };
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<NodeSnapshot>;
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.audit)) throw new Error("Invalid MeshLink state store");
    return { tasks: parsed.tasks, audit: parsed.audit };
  }

  public save(snapshot: NodeSnapshot): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }
}

/** SQLite is the zero-config durable store for one MeshLink node. */
export class SqliteNodeStore implements NodeStore {
  private readonly db: DatabaseSync;
  public constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("CREATE TABLE IF NOT EXISTS meshlink_migrations (version INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS meshlink_state (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);");
    this.db.prepare("INSERT OR IGNORE INTO meshlink_migrations(version) VALUES (1)").run();
  }
  public load(): NodeSnapshot {
    const row = this.db.prepare("SELECT payload FROM meshlink_state WHERE id = 1").get() as { payload?: string } | undefined;
    if (!row?.payload) return { tasks: [], audit: [] };
    const parsed = JSON.parse(row.payload) as Partial<NodeSnapshot>;
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.audit)) throw new Error("Invalid MeshLink SQLite state");
    return { tasks: parsed.tasks, audit: parsed.audit };
  }
  public save(snapshot: NodeSnapshot): void {
    this.db.prepare("INSERT INTO meshlink_state(id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").run(JSON.stringify(snapshot), new Date().toISOString());
  }
}
