### Task 3: Crypto, password, tokens, Redis helpers

**Files:**
- Create: `src/lib/crypto.ts`
- Create: `src/lib/password.ts`
- Create: `src/lib/tokens.ts`
- Create: `src/lib/redis.ts`
- Create: `tests/lib/password.test.ts`
- Create: `tests/lib/tokens.test.ts`

**Interfaces:**
- Consumes: `env.JWT_*`, `env.SESSION_VAULT_KEY`, `env.REDIS_URL`
- Produces:
  - `hashPassword(pw: string): Promise<string>`
  - `verifyPassword(hash: string, pw: string): Promise<boolean>`
  - `sha256(input: string): string`
  - `signAccessToken(payload: AccessClaims): Promise<string>`
  - `verifyAccessToken(token: string): Promise<AccessClaims>`
  - `generateRefreshToken(): { raw: string; hash: string }`
  - `encryptVault(plaintext: string): string` / `decryptVault(ciphertext: string): string`
  - `redis` client

```ts
export type AccessClaims = {
  sub: string; // userId
  orgId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
};
```

- [ ] **Step 1: Write failing password + token tests**

```ts
// tests/lib/password.test.ts
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
```

```ts
// tests/lib/tokens.test.ts
import { describe, it, expect } from "vitest";
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  sha256,
} from "../../src/lib/tokens.js";

describe("tokens", () => {
  it("round-trips access JWT", async () => {
    const token = await signAccessToken({
      sub: "user1",
      orgId: "org1",
      role: "OWNER",
    });
    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe("user1");
    expect(claims.orgId).toBe("org1");
    expect(claims.role).toBe("OWNER");
  });

  it("hashes refresh tokens", () => {
    const { raw, hash } = generateRefreshToken();
    expect(hash).toBe(sha256(raw));
    expect(raw).not.toBe(hash);
  });
});
```

- [ ] **Step 2: Run tests â€” expect FAIL**

```bash
npm test -- tests/lib
```

Expected: FAIL module not found / export missing.

- [ ] **Step 3: Install deps and implement**

```bash
npm install argon2 jose ioredis
```

```ts
// src/lib/password.ts
import argon2 from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  return argon2.verify(hash, password);
}
```

```ts
// src/lib/crypto.ts
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function encryptVault(plaintext: string): string {
  const key = Buffer.from(env.SESSION_VAULT_KEY.slice(0, 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptVault(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = Buffer.from(env.SESSION_VAULT_KEY.slice(0, 32));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
```

```ts
// src/lib/tokens.ts
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { sha256 } from "./crypto.js";

export type AccessClaims = {
  sub: string;
  orgId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
};

const accessKey = () => new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ orgId: claims.orgId, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(accessKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, accessKey());
  return {
    sub: String(payload.sub),
    orgId: String(payload.orgId),
    role: payload.role as AccessClaims["role"],
  };
}

export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString("base64url");
  return { raw, hash: sha256(raw) };
}

export { sha256 };
```

```ts
// src/lib/redis.ts
import Redis from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
```

- [ ] **Step 4: Run tests â€” expect PASS**

```bash
npm test -- tests/lib
```

- [ ] **Step 5: Commit**

```bash
git add src/lib tests/lib package.json package-lock.json
git commit -m "feat: add password hashing, JWT helpers, crypto, and Redis client"
```

---


