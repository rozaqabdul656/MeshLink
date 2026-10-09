import type { AgentCard } from "./contracts.js";

export class AgentRegistry {
  private readonly agents = new Map<string, AgentCard>();

  public upsert(card: AgentCard): void {
    if (!card || card.protocolVersion !== "meshlink/v1" || typeof card.id !== "string" || !card.id ||
      typeof card.name !== "string" || !Array.isArray(card.capabilities) ||
      !card.capabilities.every((value) => typeof value === "string" && value.length > 0) ||
      !["available", "busy", "offline"].includes(card.status)) {
      throw new Error("Invalid MeshLink agent card");
    }
    const endpoint = new URL(card.endpoint);
    if (!(["http:", "https:"].includes(endpoint.protocol)) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
      throw new Error("Invalid MeshLink agent endpoint");
    }
    if (this.agents.has(card.id)) throw new Error("Agent ID already registered");
    this.agents.set(card.id, { ...card, endpoint: endpoint.origin, capabilities: [...new Set(card.capabilities)] });
  }

  public remove(id: string): boolean { return this.agents.delete(id); }
  public get(id: string): AgentCard | undefined { return this.agents.get(id); }
  public list(): AgentCard[] { return [...this.agents.values()].sort((a, b) => a.id.localeCompare(b.id)); }
}

export function findAgentsByCapability(agents: AgentCard[], capability: string): AgentCard[] {
  return agents.filter((agent) => agent.status === "available" && agent.capabilities.includes(capability));
}
