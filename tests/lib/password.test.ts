import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password.js";

describe("password", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("Secret123!");
    expect(hash).not.toContain("Secret123!");
    expect(await verifyPassword(hash, "Secret123!")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});
