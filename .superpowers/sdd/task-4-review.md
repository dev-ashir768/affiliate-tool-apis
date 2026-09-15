# Task 4 Review: Auth service + routes

**Reviewer:** SDD review (read-only)  
**Base:** `812c5405b3a49c246c46b852c82fb2e2e0d8e67c`  
**Head:** `f224536e8e04522eee275f044917baa8242ac9fc`  
**Verdict:** **Spec ❌** · **Quality: Important**

---

## Spec compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| Create `src/modules/auth/auth.schemas.ts` | ✅ | register/login/refresh Zod schemas match brief |
| Create `src/modules/auth/auth.service.ts` | ✅ | register, login, rotateRefresh, revokeRefresh, getMe |
| Create `src/modules/auth/auth.routes.ts` | ✅ | POST register/login/refresh/logout, GET me |
| Create `src/modules/auth/refresh-store.ts` | ⚠️ | Redis mirror present; test-only in-memory fallback added (see below) |
| Create `src/middleware/validate.ts` | ✅ | `validateBody`; adds `req.body ?? {}` + Zod → `next(err)` (improvement over brief) |
| Create `src/middleware/authenticate.ts` | ✅ | Bearer JWT → `req.auth` via `verifyAccessToken` |
| Modify `src/app.ts` | ✅ | Mounted at `/api/v1/auth` |
| Create `tests/auth/auth.service.test.ts` | ✅ | Register OWNER/free plan + login |
| Create `tests/auth/auth.http.test.ts` | ✅ | register → me → refresh |
| `register` creates user + free-plan org + OWNER/ACTIVE | ✅ | Transaction + `issueSession` |
| `login` / `rotateRefresh` / `revokeRefresh` / `getMe` | ✅ | Matches brief reference logic |
| Cookie `refresh_token` (httpOnly, sameSite=lax, secure prod) | ✅ | Set on register/login/refresh; cleared on logout |
| Refresh SHA-256 stored; rotate revokes old + issues new | ✅ | `sha256(raw)` + DB `revokedAt` + mirror revoke |
| Consumes prisma, password, tokens, redis, Plan `free` | ✅ | |
| TDD / tests pass | ✅ | Report: 2 auth files, 3 tests; full suite 7 tests |
| Commit scope | ✅ | No `.env`; message matches brief |
| Duplicate commits same message | ⚠️ | `a405986` + `f224536` both use same feat message (process noise) |

### Documented deviation: in-memory Redis fallback (tests)

Brief reference `refresh-store.ts` uses Redis only (`set` / `del` / `exists`). Implementation adds an in-process `Map` fallback when Redis connect fails in `NODE_ENV=test`; non-test environments throw `Redis unavailable`.

**Judgment: Acceptable — not an Important defect.**

- Production/dev paths still require Redis; fallback is gated to `NODE_ENV=test`.
- Brief Step 4 allows skipping/documenting when infra is unavailable; this is a pragmatic alternative to skipping auth integration tests when Redis is unreachable (report documents VPS `ETIMEDOUT`).
- Redis mirror code path remains implemented and is used whenever Redis connects.
- Caveat: auth tests do not exercise the real Redis mirror when fallback activates — coverage gap only, not a runtime spec miss.

---

## Global constraints

| Constraint | Status | Notes |
|------------|--------|-------|
| JWT access + refresh (SHA-256 hash, rotate on refresh) | ✅ | `generateRefreshToken` → `sha256(raw)`; `rotateRefresh` revokes + re-issues |
| Error shape `{ error: { code, message, details? } }` | ✅ | `errorHandler` + `AppError` / `ZodError` |
| Never commit `.env` | ✅ | Not in diff; `.env.example` only |
| Cookie `refresh_token` **preferred** + body token allowed | ❌ | `rawRefreshFromRequest` and logout use `fromBody \|\| fromCookie` — **body wins when both present** |

### Cookie precedence defect

Design spec and review constraints require httpOnly cookie as the preferred refresh carrier; body is for non-browser clients. Current resolution inverts that:

```52:52:src/modules/auth/auth.routes.ts
  const raw = fromBody || fromCookie;
```

Same order on logout (`req.body?.refreshToken || req.cookies?.refresh_token`). Fix: `fromCookie || fromBody`. Impact: clients that send both (e.g. portal storing body copy after cookie rotation) can submit a stale body token and fail refresh despite a valid cookie — functional bug against stated convention.

---

## Quality assessment

Core auth module is well-structured and closely follows the brief’s reference service. Session issuance, Postgres persistence, refresh rotation, and route wiring are sound. `validateBody` handling of empty body enables cookie-only refresh/logout paths (good hardening beyond brief).

### Strengths

- Register transaction correctly creates user, free-plan org, and OWNER/ACTIVE membership.
- Refresh rotation: mirror check → DB validity → revoke old → issue new (token rotation asserted in HTTP test).
- `authenticate` middleware maps JWT failures to `UNAUTHORIZED` via `AppError`.
- Redis client hardened (`enableOfflineQueue: false`, test retryStrategy null, silent error handler for down Redis).
- Test cleanup disconnects Prisma and quits Redis when connected.

### Defects

| Severity | Item |
|----------|------|
| **Important** | Refresh token source order prefers body over cookie (global constraint violation; see above). |
| Minor | HTTP test covers body refresh only — no cookie-only refresh or logout flow. |
| Minor | `mirrorRefresh` always writes to in-memory `Map` even when Redis is up (redundant; harmless). |
| Minor | Redis connect probe adds ~2s latency on first auth op when Redis is down (report noted). |
| Minor | `ensureRedis` throws plain `Error` → 500 `INTERNAL` rather than a dedicated infra code. |

---

## Test verification

Report claims `npm test -- tests/auth` and full suite pass. Review performed via static analysis of diff + source (read-only; tests not re-run). Test files align with brief scenarios; HTTP test validates rotation (`refreshToken` changes).

---

## Summary

Task 4 delivers the brief’s auth module, routes, middleware, and required tests. JWT/SHA-256 rotation, error envelope, and cookie **setting** are correct. Two gaps prevent full approval:

1. **Cookie vs body precedence** inverts the global convention (Important) — blocks Spec ✅.
2. **In-memory Redis fallback in tests** is a documented, acceptable deviation; not treated as an Important defect vs the brief’s Redis mirror requirement.

**Recommended fix before merge:** change refresh/logout token resolution to `cookie || body` and add a cookie-only refresh assertion in `auth.http.test.ts`.

**Spec: ❌**  
**Quality: Important**
