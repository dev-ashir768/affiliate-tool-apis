import {
  SignJWT,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { sha256 } from "./crypto.js";

export type AccessClaims = {
  sub: string;
  orgId: string | null;
  orgRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  platformRole: "SUPERADMIN" | "FINANCE" | "OPS" | null;
  /** Merchant product access (subscription ACTIVE/TRIALING/PAST_DUE). */
  hasProductAccess: boolean;
};

/** PEM from env may arrive with literal "\n" (single-line env files). */
function pem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

/**
 * EdDSA (Ed25519) when JWT_PRIVATE_KEY/JWT_PUBLIC_KEY are set — the portal then
 * only holds the public key and cannot mint tokens. HS256 with JWT_ACCESS_SECRET
 * remains the fallback for local dev / tests.
 */
function usesAsymmetric(): boolean {
  return Boolean(env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY);
}

let signingKey: Promise<CryptoKey | Uint8Array> | null = null;
let verifyKey: Promise<CryptoKey | Uint8Array> | null = null;

function getSigningKey() {
  signingKey ??= usesAsymmetric()
    ? importPKCS8(pem(env.JWT_PRIVATE_KEY!), "EdDSA")
    : Promise.resolve(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
  return signingKey;
}

function getVerifyKey() {
  verifyKey ??= usesAsymmetric()
    ? importSPKI(pem(env.JWT_PUBLIC_KEY!), "EdDSA")
    : Promise.resolve(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
  return verifyKey;
}

function algorithm(): "EdDSA" | "HS256" {
  return usesAsymmetric() ? "EdDSA" : "HS256";
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({
    orgId: claims.orgId,
    orgRole: claims.orgRole,
    platformRole: claims.platformRole,
    hasProductAccess: claims.hasProductAccess,
  })
    .setProtectedHeader({ alg: algorithm() })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(await getSigningKey());
}

function claimsFromPayload(payload: JWTPayload): AccessClaims {
  return {
    sub: String(payload.sub),
    orgId: payload.orgId == null ? null : String(payload.orgId),
    orgRole: (payload.orgRole as AccessClaims["orgRole"]) ?? null,
    platformRole: (payload.platformRole as AccessClaims["platformRole"]) ?? null,
    hasProductAccess: Boolean(payload.hasProductAccess),
  };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, await getVerifyKey(), {
    algorithms: [algorithm()],
  });
  return claimsFromPayload(payload);
}

/**
 * Signature-verified claims that tolerate expiry up to the refresh TTL.
 * Only for hints during refresh (e.g. which org the session was on) — never authz.
 */
export async function verifyAccessTokenAllowExpired(
  token: string,
): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, await getVerifyKey(), {
    algorithms: [algorithm()],
    clockTolerance: env.REFRESH_TOKEN_TTL_SEC,
  });
  return claimsFromPayload(payload);
}

export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString("base64url");
  return { raw, hash: sha256(raw) };
}

export { sha256 };
