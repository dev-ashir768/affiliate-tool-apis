import { authenticator } from "otplib";
import { randomBytes } from "node:crypto";
import { sha256 } from "./crypto.js";

authenticator.options = { step: 30, window: 1, digits: 6 };

const ISSUER = "Tiksly";

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const normalized = code.replace(/\s/g, "");
  return authenticator.check(normalized, secret);
}

export function generateBackupCodes(): { raw: string[]; hashes: string[] } {
  const raw = Array.from({ length: 10 }, () =>
    randomBytes(5).toString("hex"), // 10 hex chars
  );
  return { raw, hashes: raw.map(hashBackupCode) };
}

export function hashBackupCode(raw: string): string {
  return sha256(raw.trim().toLowerCase());
}
