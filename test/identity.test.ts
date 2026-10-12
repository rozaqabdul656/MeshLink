import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { RequestVerifier, signedHeaders } from "../src/identity.js";

const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const identity = { id: "agent://secure-sender", kid: "2026-01", privateKey };

test("verifies signed task requests once and rejects replays or altered bodies", () => {
  const verifier = new RequestVerifier([{ id: identity.id, kid: identity.kid, publicKey }]);
  const body = JSON.stringify({ protocolVersion: "meshlink/v1", targetCapability: "service.diagnostics", input: {} });
  const headers = signedHeaders(identity, "POST", "/v1/tasks", body);
  const verified = verifier.verify("POST", "/v1/tasks", headers, body);
  assert.equal(verified.ok, true);
  if (verified.ok) { assert.equal(verified.caller, identity.id); assert.equal(verified.kid, identity.kid); }
  assert.deepEqual(verifier.verify("POST", "/v1/tasks", headers, body), { ok: false, code: "REQUEST_REPLAYED" });
  const differentHeaders = signedHeaders(identity, "POST", "/v1/tasks", body);
  assert.deepEqual(verifier.verify("POST", "/v1/tasks", differentHeaders, `${body} `), { ok: false, code: "SIGNATURE_INVALID" });
});

test("rejects a revoked key while a replacement key for the same agent remains usable", () => {
  const replacement = generateKeyPairSync("ed25519");
  const replacementIdentity = { id: identity.id, kid: "2026-02", privateKey: replacement.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  const verifier = new RequestVerifier([
    { id: identity.id, kid: identity.kid, publicKey, revokedAt: new Date(Date.now() - 1_000).toISOString() },
    { id: identity.id, kid: replacementIdentity.kid, publicKey: replacement.publicKey.export({ type: "spki", format: "pem" }).toString(), notBefore: new Date(Date.now() - 1_000).toISOString() },
  ]);
  const body = "{}";
  assert.deepEqual(verifier.verify("POST", "/v1/tasks", signedHeaders(identity, "POST", "/v1/tasks", body), body), { ok: false, code: "SIGNING_KEY_REVOKED" });
  assert.equal(verifier.verify("POST", "/v1/tasks", signedHeaders(replacementIdentity, "POST", "/v1/tasks", body), body).ok, true);
});
