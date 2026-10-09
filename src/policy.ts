import fs from "node:fs";
import YAML from "yaml";

export type PolicyDecision = "allow" | "approval" | "deny";

export interface PolicyRule {
  caller: string;
  capabilities: string[];
  decision?: Exclude<PolicyDecision, "deny">;
}

export interface PolicyDocument {
  version: 1;
  default: "deny";
  rules?: PolicyRule[];
}

export const defaultPolicy: PolicyDocument = { version: 1, default: "deny", rules: [] };

export function loadPolicy(path?: string): PolicyDocument {
  if (!path) return defaultPolicy;
  const parsed = YAML.parse(fs.readFileSync(path, "utf8")) as Partial<PolicyDocument>;
  if (parsed.version !== 1 || parsed.default !== "deny") {
    throw new Error("Policy must set version: 1 and default: deny");
  }
  return { version: 1, default: "deny", rules: parsed.rules ?? [] };
}

export function evaluatePolicy(policy: PolicyDocument, caller: string, capability: string): PolicyDecision {
  const rule = policy.rules?.find((candidate) =>
    (candidate.caller === caller || candidate.caller === "*") && candidate.capabilities.includes(capability),
  );
  return rule?.decision ?? "deny";
}
