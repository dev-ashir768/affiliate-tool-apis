# Task 3 Report: Crypto, password, tokens, Redis helpers

**Status:** DONE  
**Branch:** `feat/foundation-api`  
**Base:** `ece35fe28f981f6dec564630724910df210ec10a`  
**Commit:** `812c540`

## Summary

Implemented password hashing (argon2id), JWT access tokens (jose HS256), SHA-256 + AES-256-GCM vault crypto, refresh token generation, and Redis client per brief. Followed TDD: failing tests first, then implementation.

## Files Created/Modified

| File | Action |
|------|--------|
| `src/lib/password.ts` | Created — `hashPassword`, `verifyPassword` (argon2id) |
| `src/lib/crypto.ts` | Created — `sha256`, `encryptVault`, `decryptVault` |
| `src/lib/tokens.ts` | Created — `signAccessToken`, `verifyAccessToken`, `generateRefreshToken`, `AccessClaims` |
| `src/lib/redis.ts` | Created — `redis` ioredis client |
| `tests/lib/password.test.ts` | Created |
| `tests/lib/tokens.test.ts` | Created |
| `package.json` | Modified — added `argon2`, `jose`, `ioredis` |
| `package-lock.json` | Modified |

## Test Results

| Command | Result |
|---------|--------|
| `npm test -- tests/lib` | ✅ 2 files, 3 tests passed |
| `npm test` (full suite) | ✅ 3 files, 4 tests passed |

## TDD Flow

1. Wrote `tests/lib/password.test.ts` and `tests/lib/tokens.test.ts` — confirmed FAIL (module not found).
2. Installed `argon2`, `jose`, `ioredis`.
3. Implemented all four lib modules.
4. Re-ran tests — PASS.

## Deviations

### Redis `lazyConnect: true`

Brief exports `redis` with `maxRetriesPerRequest: null` only. Added `lazyConnect: true` so importing the module does not attempt a TCP connection when Redis is unavailable (e.g. unit test runs). Password/token tests do not import `redis.ts`.

## Self-Review

- [x] `hashPassword` / `verifyPassword` use argon2id; plaintext never appears in hash
- [x] `signAccessToken` / `verifyAccessToken` round-trip `sub`, `orgId`, `role`
- [x] `generateRefreshToken` returns `{ raw, hash }` where `hash === sha256(raw)`
- [x] `encryptVault` / `decryptVault` use AES-256-GCM with 12-byte IV + auth tag layout per brief
- [x] Consumes `env.JWT_ACCESS_SECRET`, `env.ACCESS_TOKEN_TTL_SEC`, `env.SESSION_VAULT_KEY`, `env.REDIS_URL`
- [x] Commit scope matches brief (no `.env`, no artifact dirs)
- [x] Commit message matches brief

## Concerns for Follow-up

1. **No vault crypto tests:** Brief only specifies password + token tests. Consider adding encrypt/decrypt round-trip test in a later task.
2. **argon2 native build:** Requires `node-gyp-build` on install; CI/dev may need `npm approve-scripts argon2` depending on npm config.
3. **Redis connection:** Callers must `await redis.connect()` (or first command triggers connect with lazyConnect). Document in auth/session task.

## Commands for Reproduction

```bash
npm install
npm test -- tests/lib
```
