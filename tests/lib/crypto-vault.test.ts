import { describe, it, expect } from "vitest";
import { decryptVault, encryptVault } from "../../src/lib/crypto.js";

describe("vault crypto", () => {
  it("round-trips v2 ciphertext", () => {
    const plain = JSON.stringify({ token: "abc", n: 1 });
    const enc = encryptVault(plain);
    expect(enc.startsWith("v2:")).toBe(true);
    expect(decryptVault(enc)).toBe(plain);
  });
});
