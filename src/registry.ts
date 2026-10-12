import fs from "node:fs";
import YAML from "yaml";
import type { AgentCard } from "./contracts.js";

type RegistryEntry = { card: AgentCard; expiresAt?: number };

/** Network registrations are an SSRF boundary: use exact operator-provided origins. */
export function assertAllowedAgentEndpoint(endpointValue: string, allowedOrigins: readonly string[], allowInsecureHttp = false): void {
  const endpoint = new URL(endpointValue);
  if (!(endpoint.protocol === "https:" || (allowInsecureHttp && endpoint.protocol === "http:")) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new Error("Invalid MeshLink agent endpoint");
  }
  if (!allowedOrigins.includes(endpoint.origin)) throw new Error("Agent endpoint is not allowlisted in MESHLINK_ALLOWED_AGENT_ENDPOINTS");
}

export function loadStaticRegistry(filePath?: string): AgentCard[] {
  if (!filePath) return [];
  const parsed = YAML.parse(fs.readFileSync(filePath, "utf8")) as { agents?: AgentCard[] };
  if (!Array.isArray(parsed?.agents)) throw new Error("Registry config must contain an agents array");
  const registry = new AgentRegistry();
  for (const card of parsed.agents) registry.upsert(card);
  return registry.list();
}

export class AgentRegistry {
  private readonly agents = new Map<string, RegistryEntry>();

  /** Adds a static card. Use register for a node that renews its presence. */
  public upsert(card: AgentCard): void {
    this.validate(card);
    if (this.agents.has(card.id)) throw new Error("Agent ID already registered");
    this.agents.set(card.id, { card: this.normalise(card) });
  }

  /** Creates or renews a node card with a bounded liveness lease. */
  public register(card: AgentCard, leaseSeconds = 90): AgentCard {
    this.validate(card);
    if (!Number.isFinite(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) {
      throw new Error("Agent lease must be between 10 and 3600 seconds");
    }
    const registered = { ...this.normalise(card), lastSeenAt: new Date().toISOString() };
    this.agents.set(registered.id, { card: registered, expiresAt: Date.now() + leaseSeconds * 1000 });
    return registered;
  }

  private validate(card: AgentCard): void {
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
  }

  private normalise(card: AgentCard): AgentCard {
    const endpoint = new URL(card.endpoint);
    return { ...card, endpoint: endpoint.origin, capabilities: [...new Set(card.capabilities)] };
  }

  private expire(): void {
    const now = Date.now();
    for (const [id, entry] of this.agents) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.agents.delete(id);
    }
  }

  public remove(id: string): boolean { return this.agents.delete(id); }
  public get(id: string): AgentCard | undefined { this.expire(); return this.agents.get(id)?.card; }
  public list(): AgentCard[] { this.expire(); return [...this.agents.values()].map((entry) => entry.card).sort((a, b) => a.id.localeCompare(b.id)); }
}

export function findAgentsByCapability(agents: AgentCard[], capability: string): AgentCard[] {
  return agents.filter((agent) => agent.status === "available" && agent.capabilities.includes(capability));
}
