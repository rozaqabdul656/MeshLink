import type { AgentCard, Task } from "./contracts.js";
import { PROTOCOL_VERSION } from "./contracts.js";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function routeTask(
  target: AgentCard,
  caller: string,
  capability: string,
  input: Record<string, unknown>,
  fetcher: Fetcher = fetch,
): Promise<Task> {
  if (target.status !== "available") throw new Error(`Target is not available: ${target.status}`);
  if (!target.capabilities.includes(capability)) throw new Error(`Target does not declare ${capability}`);
  const endpoint = new URL(target.endpoint);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/v1/tasks`;
  endpoint.search = "";
  endpoint.hash = "";
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-meshlink-agent": caller },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, targetCapability: capability, input }),
  });
  if (!response.ok) throw new Error(`Remote task rejected with HTTP ${response.status}`);
  let payload: Partial<Task>;
  try {
    payload = await response.json() as Partial<Task>;
  } catch {
    throw new Error("Remote response is not a MeshLink task");
  }
  if (typeof payload.id !== "string" || typeof payload.status !== "string") throw new Error("Remote response is not a MeshLink task");
  return payload as Task;
}
