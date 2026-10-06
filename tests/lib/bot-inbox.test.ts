import { describe, it, expect } from "vitest";
import { extractInviteUrl } from "../../src/lib/bot-inbox.js";

const PATTERN = String.raw`https://[^\s"'<>]*tiktok[^\s"'<>]*`;

describe("extractInviteUrl", () => {
  it("prefers the invite-looking link over other TikTok links", () => {
    const raw = [
      "Content-Type: text/html; charset=utf-8",
      "",
      '<a href="https://www.tiktok.com/legal/privacy">Privacy</a>',
      '<a href="https://seller-us.tiktok.com/invite/accept?token=abc&amp;r=1">Accept</a>',
    ].join("\r\n");
    expect(extractInviteUrl(raw, PATTERN)).toBe(
      "https://seller-us.tiktok.com/invite/accept?token=abc&r=1",
    );
  });

  it("joins quoted-printable soft line breaks inside links", () => {
    const raw = [
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<a href=3D"https://seller-uk.tiktok.com/collab/invi=',
      'tation?id=3D42">Join</a>',
    ].join("\r\n");
    expect(extractInviteUrl(raw, PATTERN)).toBe(
      "https://seller-uk.tiktok.com/collab/invitation?id=42",
    );
  });

  it("decodes base64 HTML parts", () => {
    const html = '<a href="https://seller-us.tiktok.com/invite?code=xyz">Accept invite</a>';
    const raw = [
      "--b1",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(html).toString("base64"),
      "--b1--",
    ].join("\r\n");
    expect(extractInviteUrl(raw, PATTERN)).toBe(
      "https://seller-us.tiktok.com/invite?code=xyz",
    );
  });

  it("returns null when no TikTok link is present", () => {
    expect(extractInviteUrl("Hello, no links here", PATTERN)).toBeNull();
  });
});
