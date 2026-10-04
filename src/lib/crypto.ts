import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { env } from "../config/env.js";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Resolve AES-256-GCM key material.
 * - 64 hex chars → 32 raw bytes (preferred)
 * - otherwise → SHA-256(secret) for full-entropy 32 bytes (new encrypts)
 * - decrypt also tries legacy first-32-UTF8-bytes key for older ciphertext
 */
export function resolveVaultKey(secret = env.SESSION_VAULT_KEY): Buffer {
  const raw = secret.trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

function legacyVaultKey(secret = env.SESSION_VAULT_KEY): Buffer {
  const buf = Buffer.from(secret.trim(), "utf8").subarray(0, 32);
  if (buf.length < 32) {
    throw new Error("SESSION_VAULT_KEY must be at least 32 bytes");
  }
  return buf;
}

export function encryptVault(plaintext: string): string {
  const key = resolveVaultKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // v2 = sha256-derived or hex key; prefix lets decrypt pick the right key
  return `v2:${Buffer.concat([iv, tag, enc]).toString("base64")}`;
}

function decryptWithKey(ciphertext: string, key: Buffer): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

export function decryptVault(ciphertext: string): string {
  if (ciphertext.startsWith("v2:")) {
    return decryptWithKey(ciphertext.slice(3), resolveVaultKey());
  }
  // Legacy unversioned blobs: try legacy slice key, then derived key
  try {
    return decryptWithKey(ciphertext, legacyVaultKey());
  } catch {
    return decryptWithKey(ciphertext, resolveVaultKey());
  }
}
