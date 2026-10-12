import fs from "node:fs";
import path from "node:path";
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
