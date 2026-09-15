# Task 3 Review: Crypto, password, tokens, Redis helpers

**Reviewer:** SDD review (read-only)  
**Base:** `ece35fe28f981f6dec564630724910df210ec10a`  
**Head:** `812c5405b3a49c246c46b852c82fb2e2e0d8e67c`  
**Verdict:** **Spec ✅** · **Quality: Approved**

---

## Spec compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| Create `src/lib/crypto.ts` | ✅ | `sha256`, `encryptVault`, `decryptVault` |
| Create `src/lib/password.ts` | ✅ | `hashPassword`, `verifyPassword` |
| Create `src/lib/tokens.ts` | ✅ | JWT helpers, `AccessClaims`, `generateRefreshToken`, re-export `sha256` |
| Create `src/lib/redis.ts` | ✅ | Exported `redis` client |
| Create `tests/lib/password.test.ts` | ✅ | Matches brief verbatim |
| Create `tests/lib/tokens.test.ts` | ✅ | Matches brief verbatim |
| Deps: `argon2`, `jose`, `ioredis` | ✅ | Present in `package.json` / lockfile |
| Argon2id passwords | ✅ | `{ type: argon2.argon2id }` |
| Refresh token SHA-256 hash | ✅ | `hash: sha256(raw)` |
| Access JWT via jose (HS256) | ✅ | `SignJWT` / `jwtVerify` |
| AES-256-GCM vault (12-byte IV + tag layout) | ✅ | Matches brief byte layout |
| Consumes env vars | ✅ | `JWT_ACCESS_SECRET`, `ACCESS_TOKEN_TTL_SEC`, `SESSION_VAULT_KEY`, `REDIS_URL` |
| TDD flow (tests → fail → impl → pass) | ✅ | Documented in report; tests align with brief |
| Commit scope | ✅ | 8 files; no `.env` or artifacts |
| Commit message | ✅ | Matches brief |

### Documented deviation

**Redis `lazyConnect: true`** — Brief specifies only `maxRetriesPerRequest: null`. Implementation adds `lazyConnect: true` so importing `redis.ts` does not open a TCP connection during unit tests. Additive, reasonable, and does not break the exported interface. Report documents this clearly.

---

## Global constraints

| Constraint | Status |
|------------|--------|
| Argon2id passwords | ✅ |
| Refresh hashed SHA-256 | ✅ |
| Access JWT via jose | ✅ |
| AES-256-GCM vault | ✅ |
| Never commit `.env` | ✅ (not in diff) |

---

## Quality assessment

Implementation is a faithful copy of the brief’s reference code. Module boundaries are clean (`crypto` vs `tokens` vs `password` vs `redis`). Test setup (`tests/setup.ts`) provides the required env defaults so token/password tests can run without a live Redis instance.

### Strengths

- Password hashing uses argon2id; test asserts plaintext is not embedded in hash.
- JWT round-trip preserves `sub`, `orgId`, and `role`; TTL wired to `ACCESS_TOKEN_TTL_SEC`.
- Refresh tokens use 48 random bytes (strong entropy) with hex SHA-256 for storage.
- Vault crypto follows standard GCM layout (IV ‖ tag ‖ ciphertext) as specified.

### Non-blocking notes (follow-up, not spec gaps)

1. **No vault round-trip test** — Brief only mandates password + token tests; consider adding `encryptVault`/`decryptVault` coverage in a later auth/session task.
2. **`SESSION_VAULT_KEY` derivation** — `Buffer.from(key.slice(0, 32))` uses the first 32 UTF-8 characters, not decoded bytes. Consistent with brief; ops should supply a 32+ char ASCII key (as test setup does).
3. **`verifyAccessToken` role typing** — Role is cast with `as AccessClaims["role"]` without runtime enum check. Acceptable at this layer if upstream issuance is trusted; auth middleware may want stricter validation later.
4. **argon2 native build** — Requires native compilation on install; CI may need `npm approve-scripts argon2` depending on npm policy (report already flags this).
5. **Redis lazy connect** — Callers must trigger connection (`redis.connect()` or first command); document in session/auth task (report already flags this).
6. **ioredis v6** — Declares `node >= 20`; project uses modern Node types; confirm CI/runtime Node version when wiring Redis.

---

## Test verification

Report claims `npm test -- tests/lib` → 3 tests passed. Review performed via static analysis of diff + source (read-only; tests not re-run in this review). Test files and `tests/setup.ts` env defaults are consistent with a passing run.

---

## Summary

Task 3 meets the brief and global crypto constraints. The only code deviation (`lazyConnect`) is justified and documented. No critical or important defects found.

**Spec: ✅**  
**Quality: Approved**
