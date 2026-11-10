# Break-Glass Login (Superadmin → Merchant) — Design

Date: 2026-11-10  
Status: Approved (chat)  
Repos: `affiliate-tool-apis`, `affiliate-tool-portal`

## Problem

Support sometimes needs to open a merchant account from the public login form without knowing that merchant’s password or TOTP. A shared “master password / master OTP” that works for every account would weaken every user’s second factor if leaked. Backoffice **Impersonate** already covers the in-session case, but not a login-form entry path when the operator is not already logged in.

## Goal

Allow an **ACTIVE SUPERADMIN** to open any eligible merchant account from `/login` by entering:

1. **Target** merchant email  
2. **Actor** SUPERADMIN password  
3. **Actor** SUPERADMIN TOTP  

Issue a normal merchant session for the target (same shape as Impersonate), with audit and a clear “viewing as” banner. No new shared master secret.

## Non-goals

- Shared master password or master TOTP that verifies against every account  
- Break-glass into platform staff accounts  
- Org picker UI on login (v1 picks first ACTIVE membership)  
- Changing existing backoffice Impersonate  
- SMS / email OTP  
- Stashing a restore-able staff session when the operator was not already logged in  

## Decisions

| Topic | Choice |
|-------|--------|
| Entry | Same `POST /api/v1/auth/login` + existing `/2fa/verify` |
| Credentials | Target email + SUPERADMIN password + SUPERADMIN TOTP |
| Detection | After normal password miss for the email, try SUPERADMIN password match |
| Pending token | `sub` = actor (SUPERADMIN); claims include `breakGlass: true` + `targetUserId` |
| Session | Reuse Impersonate session mint (`issueSession` as target, org from membership) |
| Banner | Existing impersonation banner; Exit clears session → `/login` (no staff stash) |
| Audit | `auth.break_glass` on successful session mint only |
| Who | `SUPERADMIN` only (not OPS / FINANCE) |

## Architecture

### Detection on login

1. Lookup user by email (target candidate).  
2. If target exists and password verifies against **target** → existing normal MFA path (unchanged).  
3. Else find an ACTIVE `platformMembership` with role `SUPERADMIN` whose **user password** matches the submitted password (if several SUPERADMINs exist, the matching password selects the actor).  
4. If such an actor is found **and** target is an eligible merchant distinct from the actor → mint break-glass `mfa_pending` (never a full session yet).  
5. Otherwise → generic `Invalid credentials` (401). Do not reveal whether the email exists or whether break-glass was attempted.

Eligible target:

- `User.status === ACTIVE`  
- No ACTIVE `platformMembership` (cannot break-glass staff)  
- At least one ACTIVE org `membership`  
- `actorUserId !== targetUserId`

If the SUPERADMIN’s own `totpEnabled` is false, return `mfa_setup` for the **actor** only (same as staff login today) — do not start break-glass until the operator’s 2FA is enrolled. Break-glass challenge itself is always `mfa_required` (never setup-for-target).

### MFA pending token

Extend `mfa_pending` JWT:

```ts
{
  purpose: "mfa_pending",
  sub: actorUserId,           // TOTP verified against this user
  breakGlass?: true,
  targetUserId?: string       // required when breakGlass
}
```

- `authenticateMfaPending` exposes `mfaUserId` (= actor) and optional break-glass fields on the request.  
- `/2fa/setup/*` and backup regenerate: **reject** when `breakGlass` (403). Only `/2fa/verify` allowed.  
- Trusted-device skip never applies to break-glass.

### Verify success

On `POST /2fa/verify` with break-glass pending:

1. Verify TOTP (or backup code) against **actor**.  
2. Re-check target eligibility (status, not staff, membership).  
3. Pick org: first ACTIVE membership ordered by `createdAt` asc.  
4. Mint session as target (same claims path as `impersonateOrganizationMember`).  
5. `writeAuditLog` action `auth.break_glass` with actor, target, org, IP if available.  
6. Return same session cookie/body shape as normal authenticated login / impersonate BFF.

### Portal

- Login + verify UI unchanged (email / password / code).  
- On authenticated response that includes break-glass / impersonation meta (`user` = target, flag or `impersonation: { mode: "break_glass" }`), BFF sets:
  - Session cookies for target  
  - `impersonation_meta` cookie `{ email, name, mode: "break_glass" }`  
  - **Do not** call `stashStaffSessionForImpersonation` (no prior staff session)  
- Banner: reuse `ImpersonationBanner`; Exit → clear cookies → `/login` (not restore staff). Copy may say “Break-glass as …” when `mode === "break_glass"`.

## API

No new public routes. Behavior changes:

### `POST /api/v1/auth/login`

Additional success branch:

```json
{
  "status": "mfa_required",
  "breakGlass": true,
  "user": { "id": "<targetId>", "email": "<targetEmail>", "name": "<targetName>" },
  "mfaPendingToken": "…"
}
```

`user` in the challenge response is the **target** (portal shows whose account is being opened). Token `sub` remains the actor.

Failures stay `401` / `403` with existing error codes; staff target → `403 FORBIDDEN` with message consistent with Impersonate (“Cannot impersonate platform staff accounts”) only after SUPERADMIN password already verified (avoid leaking staff emails to strangers — prefer still generic 401 unless password proved SUPERADMIN). **Decision:** after SUPERADMIN password verified, staff/ineligible target may return `403` with a clear message; before that, always `401 Invalid credentials`.

### `POST /api/v1/auth/2fa/verify`

When pending has `breakGlass`:

- Body unchanged `{ code, rememberDevice? }` — `rememberDevice` ignored.  
- Success: full session for target + optional `breakGlass: true` in JSON for BFF.  
- Response user = target; `redirectTo` from target claims (`/home` or `/onboarding`).

### Unchanged

- Register, forgot/reset password, trusted devices for normal login, admin TOTP reset, backoffice Impersonate.

## Security

- No new env master secret.  
- Rate limits: existing login + 2FA verify limits apply.  
- Actor must be ACTIVE SUPERADMIN with `totpEnabled`.  
- Audit on success only.  
- Prefer not expanding email enumeration beyond today’s login behavior.

## Testing

| Case | Expect |
|------|--------|
| Target email + SUPERADMIN password | `mfa_required` + `breakGlass: true` |
| Target email + wrong password (not target, not SA) | 401 |
| Target email + target’s own password | normal MFA path (no `breakGlass`) |
| Staff email as target + SA password | 403 after SA verified |
| Break-glass verify with actor TOTP | target session + audit `auth.break_glass` |
| Break-glass pending → setup/start | 403 |
| Normal merchant login / 2FA | unchanged |
| SA own email + SA password | normal staff MFA (not break-glass) |

## Implementation sketch

1. Extend `signMfaPendingToken` / `verifyMfaPendingToken` for optional break-glass claims.  
2. `login()`: after failed target password, attempt SUPERADMIN break-glass branch.  
3. Shared helper with Impersonate for “mint merchant session for target+org” (extract from `impersonateOrganizationMember` if needed).  
4. `verifyTotpLogin`: branch on break-glass claims.  
5. Portal login BFF + verify BFF: set impersonation meta without staff stash; Exit path for break-glass.  
6. Banner copy tweak.  
7. HTTP + service tests as above.

## Open follow-ups (not v1)

- Org picker when target has multiple memberships  
- Optional IP allowlist / feature flag for break-glass  
- Restore-to-backoffice if operator logged in via Impersonate path only (already exists)
