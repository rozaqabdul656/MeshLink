import assert from "node:assert/strict";
import test from "node:test";
import { dashboardConfig, isUnauthorized } from "../dashboard/router.js";

test("frontend config falls back to same-origin API when unset", () => {
  assert.deepEqual(dashboardConfig(undefined), { apiBase: "" });
});

test("frontend auth guard identifies expired sessions", () => {
  assert.equal(isUnauthorized(new Response(null, { status: 401 })), true);
  assert.equal(isUnauthorized(new Response(null, { status: 200 })), false);
});
