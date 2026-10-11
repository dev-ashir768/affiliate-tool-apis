
## Task 11 fix: unblock typecheck and harden 2FA reset cleanup

- mfa-setup-store.ts: final `redis.status !== "ready"` check (TS2367) now reads status via widened `redisStatus(): string` helper, avoiding stale narrowing after awaits.
- two-factor.service.ts adminResetTwoFactor: `revokeAllRefreshForUser` now runs before `deletePendingTotpSecret`; the latter is wrapped in try/catch with `logger.warn` (non-throwing).
- two-factor.service.ts confirmTotpSetup: `deletePendingTotpSecret` after the enabling transaction is best-effort (try/catch + warn) so session issuance proceeds.

Verification:
- `npm run typecheck`: PASS (tsc, no errors).
- `npx vitest run tests/lib tests/middleware/authenticate-mfa.test.ts`: 39 passed, 1 failed. The failure (tests/lib/password.test.ts) is environmental: Windows Application Control blocks the argon2 native binary; unrelated to this change.
