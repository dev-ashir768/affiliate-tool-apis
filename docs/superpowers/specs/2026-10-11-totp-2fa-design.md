# Mandatory TOTP 2FA — Design

Date: 2026-10-11  
Status: Approved (chat)  
Repos: `affiliate-tool-apis`, `affiliate-tool-portal`

## Problem

Account auth is email/password + JWT access / hashed refresh via the portal BFF. There is no second factor. For a production SaaS with merchant data and platform staff, password-only login is insufficient.

## Goal

Require TOTP (authenticator app) for every user before the dashboard is usable. After password success, issue only a short-lived pre-session challenge token until 2FA setup or verify completes. Support backup codes, merchant “remember this device” (30 days), and staff-only 2FA reset with audit.

## Non-goals

- SMS or email OTP as a second factor
- WebAuthn / passkeys (future)
- Optional / grace-period 2FA
- Self-service disable of 2FA (mandatory for all)
- Changing TikTok bot email-OTP scraping (unrelated)

## Decisions

| Topic | Choice |
|-------|--------|
| Method | TOTP (authenticator apps) |
| Who | Required for everyone |
| Enrollment | After first password login → limited setup state (no dashboard until verified) |
| Recovery | Backup codes + platform staff reset |
| Remember device | 30 days for merchants; platform staff always challenged |
| Session model | Pre-session `mfa_pending` JWT — not a full access token with a flag |
| Libraries | `otplib` (TOTP), existing `jose` + argon2 + Prisma + Redis patterns |

## Architecture

Password never issues a full session. It mints a short-lived JWT with purpose `mfa_pending` (TTL 5–10 minutes). Full access + refresh tokens are issued only after:

- TOTP setup confirm (first time), or
- TOTP / backup-code verify (returning users), or
- Trusted-device cookie match (merchants only)

### Flows

1. **No 2FA yet**  
   Password OK → `mfa_pending` → portal `/2fa/setup` (QR + verify + show backup codes once) → enable → full session → existing redirect (`/home`, `/onboarding`, or `/backoffice/...`).

2. **2FA enabled**  
   Password OK → if merchant + valid trusted device → full session; else `mfa_pending` → `/2fa/verify` → full session. Staff always verify.

3. **Guards**  
   - Normal `authenticate` rejects `mfa_pending`.  
   - Dedicated middleware accepts only `mfa_pending` for `/api/v1/auth/2fa/*` challenge endpoints.  
   - Portal `proxy.ts`: pending cookie holders may only reach `/2fa/*`; otherwise redirect to setup or verify.

### Token shapes

- **`mfa_pending`**: `{ sub, purpose: "mfa_pending" }` — no org/product unlock claims.  
- **Access JWT**: unchanged `AccessClaims` after MFA success.  
- **Trusted device**: opaque random token → httpOnly cookie; SHA-256 hash in `TrustedDevice`.

## Data model

### `User` additions

- `totpEnabled Boolean @default(false)`
- `totpSecretEncrypted String?` — AES-256-GCM ciphertext (never plaintext)
- `totpVerifiedAt DateTime?`

### `TwoFactorBackupCode`

- `id`, `userId`, `codeHash`, `usedAt DateTime?`, `createdAt`
- Index on `userId`

### `TrustedDevice`

- `id`, `userId`, `tokenHash`, `label String?` (optional UA snippet), `expiresAt`, `createdAt`, `revokedAt DateTime?`
- Index on `userId`, unique on `tokenHash`

Pending setup secrets (before confirm) live in Redis keyed by `userId` with TTL matching the pending token. Abandoned QR sessions must not leave durable secrets in Postgres. On confirm: persist encrypted secret to `User`, set `totpEnabled=true`, delete Redis key, create backup codes.

## API

Base: `/api/v1/auth`

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /login` | public | Password → `{ status: "mfa_setup" \| "mfa_required" \| "authenticated", redirectTo? }` + set pending or full cookies |
| `POST /2fa/setup/start` | mfa_pending | Create pending secret; return `{ otpauthUrl, qrDataUrl? }` |
| `POST /2fa/setup/confirm` | mfa_pending | Body `{ code }`; enable TOTP, create 10 backup codes, issue full session, return `{ backupCodes }` once |
| `POST /2fa/verify` | mfa_pending | Body `{ code, rememberDevice? }`; TOTP or backup; full session; set trusted device for merchants when requested |
| `GET /2fa/status` | full session | `{ enabled, backupCodesRemaining, trustedDevices[] }` |
| `POST /2fa/backup-codes/regenerate` | full session | Body `{ code }` (current TOTP); rotate codes; return new codes once |
| `DELETE /2fa/trusted-devices/:id` | full session | Revoke own device |
| `POST /2fa/admin/reset` | platform staff | Body `{ userId }`; clear secret/codes/devices; revoke refresh tokens; audit |

Register continues to create the user; first login (or register response if it auto-logs-in today) must follow the same pending/setup path — never return a full session without MFA when `totpEnabled` is false.

## Portal

- BFF routes under `/api/auth/2fa/*` proxying the API; cookies: short-lived `mfa_pending` vs existing access/refresh.
- Pages: `(auth)/2fa/setup`, `(auth)/2fa/verify`.
- Login form: on `mfa_setup` / `mfa_required`, redirect accordingly (no dashboard).
- Settings (merchant + staff): show 2FA status, remaining backup codes, regenerate (with TOTP), list/revoke trusted devices. No disable toggle.
- Backoffice: staff reset action on user detail — **SUPERADMIN only**.
- `proxy.ts` + route policy: treat `/2fa/*` as pending-allowed; block merchant/staff areas without full access token.

## Security

- TOTP: 6 digits, 30s period, verification window ±1 step.
- Secret: AES-256-GCM with `TOTP_ENCRYPTION_KEY` (32-byte key from env).
- Backup codes: 10 high-entropy codes; hashed at rest (SHA-256 or argon2); single-use; shown once.
- Rate limit setup/verify (e.g. 5/min per IP+user); progressive delay after repeated failures.
- Generic error copy for bad password / bad code (no user enumeration beyond existing login behavior).
- Expired/missing pending → client returns to login.
- Trusted device: Secure + httpOnly + SameSite; 30-day expiry; merchants only; revoke on password reset and admin 2FA reset.
- Never log secrets, backup codes, otpauth URLs in production logs, or raw TOTP.
- Admin reset writes `AuditLog` and revokes all refresh tokens + trusted devices for that user.

## Migration

- Add columns/tables via Prisma migration.
- Existing users: `totpEnabled=false` → next login forces setup. No grace period.
- New env: `TOTP_ENCRYPTION_KEY` (required in production).

## Error handling

| Case | Behavior |
|------|----------|
| Wrong TOTP / backup | `401` / `INVALID_CREDENTIALS`-style; same message |
| Expired pending | `401` purpose/expired; portal → login |
| Setup when already enabled | `409` |
| Regenerate without valid TOTP | `401` |
| Admin reset non-staff | `403` |
| Remember device as staff | Ignored server-side |

## Testing

**API unit:** encrypt/decrypt secret; TOTP window; backup consume; pending purpose rejection by normal authenticate; trusted device hash match/expiry.

**API HTTP:** login→setup→confirm→authenticated; login→verify; staff never skips via remember; merchant remember skips verify within 30d; admin reset forces setup; rate limit / expired pending.

**Portal:** proxy blocks dashboard with only pending cookie; redirects setup vs verify; settings regenerate/revoke; backoffice reset.

## Rollout

1. Ship API migration + endpoints behind normal deploy.  
2. Ship portal BFF + pages + proxy rules same release (or API-first with feature flag only if needed — prefer same release).  
3. On release, all users hit setup at next login.

## Out of scope follow-ups

- Passkeys  
- Logout-all-devices UI beyond refresh revoke on reset  
- Per-org MFA policy overrides  
