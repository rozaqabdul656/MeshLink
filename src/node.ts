import { randomUUID } from "node:crypto";
import type { AgentCard, AuditEvent, Task, TaskRequest, TaskResult } from "./contracts.js";
import { PROTOCOL_VERSION } from "./contracts.js";
import type { PolicyDocument } from "./policy.js";
import { evaluatePolicy } from "./policy.js";
import { AgentRegistry } from "./registry.js";

export type TaskHandler = (request: TaskRequest) => Promise<TaskResult>;

export class MeshNode {
  private readonly tasks = new Map<string, Task>();
  private readonly audit: AuditEvent[] = [];
  private readonly handlers = new Map<string, TaskHandler>();
  public readonly registry = new AgentRegistry();

  public constructor(
    public readonly card: AgentCard,
    private readonly policy: PolicyDocument,
  ) {}

  public register(capability: string, handler: TaskHandler): void {
    if (!this.card.capabilities.includes(capability)) {
      throw new Error(`Capability ${capability} is not declared by this node`);
    }
    this.handlers.set(capability, handler);
  }

  public listAgents(): AgentCard[] {
    return [this.card];
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

  public async createTask(request: TaskRequest): Promise<Task> {
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

  public async approveTask(id: string): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task || task.status !== "awaiting_approval") return task;
    return this.run(task);
  }

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

  private touch(task: Task): void { task.updatedAt = new Date().toISOString(); }

  private record(task: Task, action: AuditEvent["action"], detail?: string): void {
    this.audit.push({ at: new Date().toISOString(), taskId: task.id, action, caller: task.request.caller, capability: task.request.targetCapability, detail });
  }
}
