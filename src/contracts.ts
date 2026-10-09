/**
 * Public contracts. Add optional fields in a new minor version; do not rename
 * or change existing values. These objects are the compatibility boundary for
 * future A2A, MCP, queue, and UI adapters.
 */
export const PROTOCOL_VERSION = "meshlink/v1";

export type TaskStatus =
  | "queued"
  | "working"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "denied";

export interface TaskRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  caller: string;
  targetCapability: string;
  input: Record<string, unknown>;
  constraints?: { readOnly?: boolean };
  traceId?: string;
}

export interface TaskResult {
  summary: string;
  evidence?: string[];
  data?: Record<string, unknown>;
}

export interface Task {
  id: string;
  createdAt: string;
  updatedAt: string;
  request: TaskRequest;
  status: TaskStatus;
  result?: TaskResult;
  error?: { code: string; message: string };
}

export interface AgentCard {
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  name: string;
  endpoint: string;
  capabilities: string[];
  status: "available" | "busy" | "offline";
}

export interface AuditEvent {
  at: string;
  taskId: string;
  action: "received" | "policy_allowed" | "policy_denied" | "approval_required" | "started" | "completed" | "failed";
  caller: string;
  capability: string;
  detail?: string;
}
