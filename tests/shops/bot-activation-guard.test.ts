import { describe, it, expect } from "vitest";
import {
  hostAllowed,
  isPrivateAddress,
  urlAllowed,
} from "../../src/modules/shops/bot-activation.service.js";

describe("bot activation network guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.5",
    "172.31.255.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("treats %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "72.62.170.13", "172.32.0.1", "2606:4700::1111"])(
    "treats %s as public",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );

  it("blocks localhost names and private literal hosts", async () => {
    expect(await hostAllowed("localhost")).toBe(false);
    expect(await hostAllowed("api.localhost")).toBe(false);
    expect(await hostAllowed("metadata.internal")).toBe(false);
    expect(await hostAllowed("127.0.0.1")).toBe(false);
    expect(await hostAllowed("[::1]")).toBe(false);
  });

  it("allows public literal IPs", async () => {
    expect(await hostAllowed("8.8.8.8")).toBe(true);
  });
});

describe("urlAllowed", () => {
  it("blocks non-web ports and schemes", async () => {
    expect(await urlAllowed("http://8.8.8.8:4000/health")).toBe(false);
    expect(await urlAllowed("https://8.8.8.8:5432/")).toBe(false);
    expect(await urlAllowed("file:///etc/passwd")).toBe(false);
    expect(await urlAllowed("chrome://settings")).toBe(false);
    expect(await urlAllowed("not a url")).toBe(false);
  });

  it("allows public https and inline data", async () => {
    expect(await urlAllowed("https://8.8.8.8/")).toBe(true);
    expect(await urlAllowed("https://8.8.8.8:443/x")).toBe(true);
    expect(await urlAllowed("data:image/png;base64,AAAA")).toBe(true);
  });
});
