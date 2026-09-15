import { describe, it, expect } from "vitest";

/**
 * Gated live smoke against a running API.
 * Skip unless SMOKE_HTTP=1 (requires Postgres + API on SMOKE_BASE_URL).
 */
const enabled = process.env.SMOKE_HTTP === "1";

describe.skipIf(!enabled)("foundation HTTP smoke (gated)", () => {
  const base = process.env.SMOKE_BASE_URL ?? "http://localhost:4000";

  it(
    "health is ok",
    async () => {
      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
    },
    15_000
  );
});
