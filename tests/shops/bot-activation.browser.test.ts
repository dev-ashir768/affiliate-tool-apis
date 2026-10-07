import { describe, it, expect, vi, afterAll } from "vitest";

// Real Chromium, mocked DB. Opt-in: RUN_BROWSER_TESTS=1 (needs `npx playwright install chromium`).
const shop = {
  id: "shop_1",
  organizationId: "org_1",
  region: "US",
  status: "PENDING_INVITE",
  botIdentity: { id: "bot_1", email: "bot-test@example.com", ownerOrganizationId: "org_1" },
};
const botUpdates: Array<Record<string, unknown>> = [];

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    shop: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
        where.id === shop.id && where.organizationId === shop.organizationId ? shop : null,
      ),
    },
    botIdentity: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        botUpdates.push(data);
        return {};
      }),
    },
  },
}));

const LOGIN_PAGE =
  "data:text/html," +
  encodeURIComponent(
    `<title>login</title><input id="u" style="position:absolute;left:20px;top:20px;width:200px">` +
      `<button style="position:absolute;left:20px;top:80px;width:120px;height:40px" ` +
      `onclick="document.cookie='sid=abc';document.title='done:'+document.getElementById('u').value">Go</button>`,
  );

describe.skipIf(!process.env.RUN_BROWSER_TESTS)("bot activation (real browser)", async () => {
  const { env } = await import("../../src/config/env.js");
  (env as { SHOP_VERIFY_LOGIN_URL_US: string }).SHOP_VERIFY_LOGIN_URL_US = LOGIN_PAGE;
  const svc = await import("../../src/modules/shops/bot-activation.service.js");
  const { decryptVault } = await import("../../src/lib/crypto.js");

  afterAll(async () => {
    await svc.closeAllBotActivations();
  });

  it("rejects other organizations", async () => {
    await expect(svc.startBotActivation("org_other", shop.id)).rejects.toThrow(/not found/i);
  });

  it("streams frames, relays input, and saves an encrypted session", async () => {
    const started = await svc.startBotActivation("org_1", shop.id);
    expect(started).toMatchObject({ width: 1280, height: 800, botEmail: shop.botIdentity.email });

    let frame = null;
    for (let i = 0; i < 40 && !frame; i++) {
      frame = svc.getActivationFrame("org_1", shop.id, 0);
      if (!frame) await new Promise((r) => setTimeout(r, 100));
    }
    expect(frame?.image.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(svc.getActivationFrame("org_1", shop.id, frame!.seq)).toBeNull();

    await svc.sendActivationInput("org_1", shop.id, [
      { type: "mouse", action: "down", x: 100, y: 30 },
      { type: "mouse", action: "up", x: 100, y: 30 },
      { type: "text", text: "merchant" },
      { type: "key", key: "Backspace" },
      { type: "mouse", action: "down", x: 60, y: 100 },
      { type: "mouse", action: "up", x: 60, y: 100 },
    ]);
    await new Promise((r) => setTimeout(r, 300));

    const result = await svc.completeBotActivation("org_1", shop.id);
    expect(result).toEqual({ activated: true, looksSignedIn: true });

    const saved = botUpdates.at(-1)!;
    expect(saved.sessionCapturedAt).toBeInstanceOf(Date);
    const state = JSON.parse(decryptVault(String(saved.sessionVaultCiphertext)));
    expect(Array.isArray(state.cookies)).toBe(true);

    expect(() => svc.getActivationFrame("org_1", shop.id, 0)).toThrow(/closed/i);
  }, 60_000);
});
