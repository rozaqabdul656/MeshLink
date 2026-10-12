import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardAuth } from "../src/auth.js";

test("dashboard auth accepts configured password and emits strict expiring cookie", () => {
  const auth = createDashboardAuth("secret");
  const login = auth.login("secret");
  assert.equal(login.ok, true);
  assert.match(login.cookie, /HttpOnly/);
  assert.match(login.cookie, /SameSite=Strict/);
  assert.match(login.cookie, /Max-Age=3600/);
  assert.equal(auth.valid(login.cookie.split(";")[0].split("=")[1]), true);
  assert.equal(auth.login("wrong").ok, false);
});

test("dashboard auth rejects missing and malformed sessions", () => {
  const auth = createDashboardAuth("secret");
  assert.equal(auth.valid(undefined), false);
  assert.equal(auth.valid("not-a-session"), false);
});
