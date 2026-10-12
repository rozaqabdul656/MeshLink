import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";

export type PeerPermission = "task.submit" | "task.read" | "task.approve" | "audit.read" | "registry.read" | "registry.write" | "context.read";
export type TrustedAgent = { id: string; kid: string; publicKey: string; permissions?: PeerPermission[]; notBefore?: string; notAfter?: string; revokedAt?: string };
export type SigningIdentity = { id: string; kid: string; privateKey: string };
const maxAgeMs = 5 * 60_000;

function canonical(method: string, pathname: string, caller: string, kid: string, timestamp: string, requestId: string, body: string): Buffer {
  const digest = createHash("sha256").update(body).digest("base64url");
  return Buffer.from([method.toUpperCase(), pathname, caller, kid, timestamp, requestId, digest].join("\n"));
}

export function loadSigningIdentity(): SigningIdentity | undefined {
  const { MESHLINK_AGENT_ID: id, MESHLINK_AGENT_KEY_ID: kid, MESHLINK_AGENT_PRIVATE_KEY: privateKey } = process.env;
  if (!id && !kid && !privateKey) return undefined;
  if (!id || !kid || !privateKey) throw new Error("MESHLINK_AGENT_ID, MESHLINK_AGENT_KEY_ID, and MESHLINK_AGENT_PRIVATE_KEY must be set together");
  return { id, kid, privateKey: Buffer.from(privateKey, "base64").toString("utf8") };
}

export function signedHeaders(identity: SigningIdentity, method: string, pathname: string, body: string): Record<string, string> {
  const timestamp = new Date().toISOString(); const requestId = randomUUID();
  const message = canonical(method, pathname, identity.id, identity.kid, timestamp, requestId, body);
  const signature = sign(null, message, createPrivateKey(identity.privateKey)).toString("base64url");
  return { "x-meshlink-agent": identity.id, "x-meshlink-key-id": identity.kid, "x-meshlink-timestamp": timestamp, "x-meshlink-request-id": requestId, "x-meshlink-signature": signature };
}

export class RequestVerifier {
  private readonly used = new Map<string, number>();
  public constructor(private readonly trusted: TrustedAgent[]) {}
  public static fromEnvironment(): RequestVerifier | undefined {
    const raw = process.env.MESHLINK_TRUSTED_AGENTS;
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as TrustedAgent[];
    if (!Array.isArray(parsed) || !parsed.every((entry) => entry && typeof entry.id === "string" && typeof entry.kid === "string" && typeof entry.publicKey === "string" && (entry.permissions === undefined || (Array.isArray(entry.permissions) && entry.permissions.every((permission) => typeof permission === "string"))))) throw new Error("MESHLINK_TRUSTED_AGENTS must be a JSON array of trusted Ed25519 public keys");
    return new RequestVerifier(parsed);
  }
  public verify(method: string, pathname: string, headers: Record<string, string | string[] | undefined>, body: string): { ok: true; caller: string; kid: string; signature: string; timestamp: string } | { ok: false; code: string } {
    const caller = headers["x-meshlink-agent"]; const kid = headers["x-meshlink-key-id"]; const timestamp = headers["x-meshlink-timestamp"]; const requestId = headers["x-meshlink-request-id"]; const signature = headers["x-meshlink-signature"];
    if ([caller, kid, timestamp, requestId, signature].some((value) => typeof value !== "string" || !value)) return { ok: false, code: "SIGNED_IDENTITY_REQUIRED" };
    const age = Date.now() - Date.parse(timestamp as string); if (!Number.isFinite(age) || Math.abs(age) > maxAgeMs) return { ok: false, code: "SIGNATURE_EXPIRED" };
    for (const [id, expires] of this.used) if (expires <= Date.now()) this.used.delete(id);
    if (this.used.has(requestId as string)) return { ok: false, code: "REQUEST_REPLAYED" };
    const trusted = this.trusted.find((entry) => entry.id === caller && entry.kid === kid); if (!trusted) return { ok: false, code: "UNKNOWN_SIGNING_KEY" };
    const now = Date.now();
    if (trusted.revokedAt && Date.parse(trusted.revokedAt) <= now) return { ok: false, code: "SIGNING_KEY_REVOKED" };
    if ((trusted.notBefore && Date.parse(trusted.notBefore) > now) || (trusted.notAfter && Date.parse(trusted.notAfter) < now)) return { ok: false, code: "SIGNING_KEY_INACTIVE" };
    const valid = verify(null, canonical(method, pathname, caller as string, kid as string, timestamp as string, requestId as string, body), createPublicKey(trusted.publicKey), Buffer.from(signature as string, "base64url"));
    if (!valid) return { ok: false, code: "SIGNATURE_INVALID" };
    this.used.set(requestId as string, Date.now() + maxAgeMs); return { ok: true, caller: caller as string, kid: kid as string, signature: signature as string, timestamp: timestamp as string };
  }

  public allows(caller: string, permission: PeerPermission): boolean {
    return this.trusted.some((entry) => entry.id === caller && entry.permissions?.includes(permission));
  }
}
