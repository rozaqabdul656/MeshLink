import { createHash, randomUUID } from "node:crypto";
import type { AgentCard, ApprovalRecord, AuditEvent, Task, TaskContext, TaskRequest, TaskResult } from "./contracts.js";
import { PROTOCOL_VERSION } from "./contracts.js";
import type { PolicyDocument } from "./policy.js";
import { evaluatePolicy } from "./policy.js";
import { AgentRegistry } from "./registry.js";
import { MemoryNodeStore, type NodeStore } from "./store.js";

export type TaskHandler = (request: TaskRequest) => Promise<TaskResult>;

export class MeshNode {
  private readonly tasks = new Map<string, Task>();
  private readonly audit: AuditEvent[] = [];
  private readonly handlers = new Map<string, TaskHandler>();
  public readonly registry = new AgentRegistry();

  public constructor(
    public readonly card: AgentCard,
    private readonly policy: PolicyDocument,
    private readonly stateStore: NodeStore = new MemoryNodeStore(),
  ) {
    const snapshot = stateStore.load();
    for (const task of snapshot.tasks) this.tasks.set(task.id, task);
    this.audit.push(...snapshot.audit);
    for (const task of this.tasks.values()) {
      if (task.status !== "working") continue;
      task.status = "failed";
      task.error = { code: "WORKER_INTERRUPTED", message: "Worker stopped before this task completed; it was not retried automatically" };
      this.touch(task);
      this.audit.push({ at: new Date().toISOString(), taskId: task.id, action: "failed", caller: task.request.caller, capability: task.request.targetCapability, detail: "Recovered after worker interruption" });
    }
    this.persist();
  }

  public register(capability: string, handler: TaskHandler): void {
    if (!this.card.capabilities.includes(capability)) {
      throw new Error(`Capability ${capability} is not declared by this node`);
    }
    this.handlers.set(capability, handler);
  }

  public listAgents(): AgentCard[] {
    return [this.card];
  }

  public registerRemote(card: AgentCard, leaseSeconds?: number): AgentCard {
    return this.registry.register(card, leaseSeconds);
  }

  public getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  public listTasks(): Task[] {
    return [...this.tasks.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public listAudit(): AuditEvent[] {
    return [...this.audit];
  }

  public persistenceKind(): string { return this.stateStore.constructor.name.replace(/NodeStore$/, "").toLowerCase(); }

  public async createTask(request: TaskRequest): Promise<Task> {
    if (request.context && !this.validContext(request.context)) {
      return this.storeRejected(request, "CONTEXT_INVALID", "Context must contain a bounded summary and content-addressed artifact references");
    }
    if (request.protocolVersion !== PROTOCOL_VERSION) {
      return this.storeRejected(request, "PROTOCOL_VERSION_UNSUPPORTED", "Unsupported protocol version");
    }

    const task = this.store({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      request,
      status: "queued",
    });
    this.record(task, "received");

    const decision = evaluatePolicy(this.policy, request.caller, request.targetCapability);
    if (decision === "deny") {
      task.status = "denied";
      task.error = { code: "POLICY_DENIED", message: "Caller is not authorized for this capability" };
      this.touch(task);
      this.record(task, "policy_denied");
      return task;
    }
    if (decision === "approval") {
      task.status = "awaiting_approval";
      this.touch(task);
      this.record(task, "approval_required");
      return task;
    }
    this.record(task, "policy_allowed");
    return this.run(task);
  }

  public async approveTask(id: string, approval: ApprovalRecord): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task || task.status !== "awaiting_approval") return task;
    if (approval.decision !== "approve" || approval.taskDigest !== this.taskDigest(task)) {
      this.record(task, "security_denied", "Approval task digest did not match");
      return task;
    }
    task.approval = approval;
    this.touch(task);
    this.record(task, "approved", `${approval.actorId} (${approval.keyId})`);
    return this.run(task);
  }

  public recordSecurity(caller: string, detail: string): void {
    this.audit.push({ at: new Date().toISOString(), taskId: "security", action: "security_denied", caller, capability: "security", detail });
    this.persist();
  }

  public taskDigest(task: Task): string { return createHash("sha256").update(JSON.stringify(task.request)).digest("base64url"); }

  private async run(task: Task): Promise<Task> {
    const handler = this.handlers.get(task.request.targetCapability);
    if (!handler) {
      task.status = "failed";
      task.error = { code: "CAPABILITY_UNAVAILABLE", message: "No handler is registered for this capability" };
      this.touch(task);
      this.record(task, "failed");
      return task;
    }
    task.status = "working";
    this.touch(task);
    this.record(task, "started");
    try {
      task.result = await handler(task.request);
      task.status = "completed";
      this.touch(task);
      this.record(task, "completed");
    } catch (error) {
      task.status = "failed";
      task.error = { code: "HANDLER_FAILED", message: error instanceof Error ? error.message : "Unknown handler error" };
      this.touch(task);
      this.record(task, "failed");
    }
    return task;
  }

  private store(task: Task): Task {
    this.tasks.set(task.id, task);
    this.persist();
    return task;
  }

  private storeRejected(request: TaskRequest, code: string, message: string): Task {
    const task = this.store({
      id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      request, status: "denied", error: { code, message },
    });
    this.record(task, "policy_denied", message);
    return task;
  }

  private touch(task: Task): void { task.updatedAt = new Date().toISOString(); this.persist(); }

  private record(task: Task, action: AuditEvent["action"], detail?: string): void {
    this.audit.push({ at: new Date().toISOString(), taskId: task.id, action, caller: task.request.caller, capability: task.request.targetCapability, detail });
    this.persist();
  }

  private persist(): void { this.stateStore.save({ tasks: [...this.tasks.values()], audit: this.audit }); }

  private validContext(context: TaskContext): boolean {
    return typeof context.id === "string" && context.id.length > 0 && context.id.length <= 128 &&
      typeof context.summary === "string" && context.summary.length > 0 && context.summary.length <= 16_384 &&
      (context.artifacts === undefined || (Array.isArray(context.artifacts) && context.artifacts.length <= 64 && context.artifacts.every((artifact) =>
        artifact && typeof artifact.uri === "string" && artifact.uri.length > 0 && artifact.uri.length <= 2048 &&
        typeof artifact.sha256 === "string" && /^[a-f0-9]{64}$/i.test(artifact.sha256) &&
        (artifact.mediaType === undefined || typeof artifact.mediaType === "string"))));
  }
}
