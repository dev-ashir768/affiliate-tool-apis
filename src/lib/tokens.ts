import { SignJWT, jwtVerify } from "jose";
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

const accessKey = () => new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({
    orgId: claims.orgId,
    orgRole: claims.orgRole,
    platformRole: claims.platformRole,
    hasProductAccess: claims.hasProductAccess,
  })
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
    orgId: payload.orgId == null ? null : String(payload.orgId),
    orgRole: (payload.orgRole as AccessClaims["orgRole"]) ?? null,
    platformRole: (payload.platformRole as AccessClaims["platformRole"]) ?? null,
    hasProductAccess: Boolean(payload.hasProductAccess),
  };
}

export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString("base64url");
  return { raw, hash: sha256(raw) };
}

export { sha256 };
