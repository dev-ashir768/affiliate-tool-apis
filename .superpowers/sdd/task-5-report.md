# Task 5 Report: Org context middleware + orgs/members/invites

**Status:** DONE_WITH_CONCERNS  
**Branch:** `feat/foundation-api`  
**Base:** `1d9fece5eb160b05b0a1c2f9c50ff720cd26971f`  
**Commits:** `cb676a9` — `feat: add org current endpoints and seat-limited invites`

## Summary

Added org-scoped middleware and org/member/invite APIs: `requireOrg` loads ACTIVE membership for `req.auth.sub` + `req.auth.orgId`; `requireRole` gates OWNER/ADMIN. Seat-limited invites store hashed tokens with TTL; accept supports authenticated existing users or password+name for new (stub) users.

## Files Created/Modified

| File | Action |
|------|--------|
| `src/middleware/require-org.ts` | Created — ACTIVE membership → `req.membership` |
| `src/middleware/require-role.ts` | Created — OWNER/ADMIN (etc.) gate |
| `src/modules/orgs/orgs.schemas.ts` | Created — invite / patch / accept Zod schemas |
| `src/modules/orgs/orgs.service.ts` | Created — getCurrent, patchCurrent, listMembers, createInvite, acceptInvite |
| `src/modules/orgs/orgs.routes.ts` | Created — mounted under `/api/v1/orgs` |
| `src/app.ts` | Modified — mount `orgsRoutes` |
| `tests/orgs/invites.test.ts` | Created — PLAN_LIMIT, accept paths, HTTP invite |

## Test Results

| Command | Result |
|---------|--------|
| `npm test -- tests/orgs/invites.test.ts` | ✅ 1 file, 5 tests passed |
| `npm test` (full suite) | ✅ 6 files, 13 tests passed |

## TDD notes

1. Wrote failing `PLAN_LIMIT` test (module missing) → implemented service/middleware/routes → green.
2. Extended tests: new-user accept (password+name), existing-user accept (auth), get/patch/list, HTTP invite → accept → members.

## Self-Review

- [x] Seats = ACTIVE + INVITED; over limit → `PLAN_LIMIT` 403
- [x] Invite stores `inviteTokenHash` + `inviteExpiresAt`; raw token returned once
- [x] Accept: auth as invitee email OR password+name for new user
- [x] Routes: GET/PATCH current, GET members, POST invites, POST accept
- [x] `requireOrg` / `requireRole` used for protected org routes
- [x] Commit message matches brief; excludes `.env` and unrelated redis WIP

## Concerns for Follow-up

1. **Stub users on invite:** Schema requires `Membership.userId`, so missing emails get a placeholder User (random password, name `"Invited"`) at invite time; finalized on accept. No dedicated `pendingEmail` field.
2. **`createInvite` does not re-check actor role** in the service (relies on route middleware); direct service callers can invite without role checks.
3. **Unrelated dirty files left unstaged:** `src/lib/redis.ts`, `src/modules/auth/refresh-store.ts` (not part of this commit).
4. **No email delivery** (out of scope); raw token is for tests/manual sharing only.
5. **DISABLED membership re-invite:** DISABLED rows can be reactivated to INVITED; intentional but undocumented.

## Commands for Reproduction

```bash
npm test -- tests/orgs/invites.test.ts
npm test
```

## Follow-up fix (review finding)

**Commit:** `c52d9e5` — `fix: require auth when accepting invites for existing users`

**Issue:** `acceptInvite` allowed the password+name path for any invitee without an ACTIVE membership elsewhere, so a real existing user could have credentials overwritten with only the invite token.

**Fix:** password+name finalize is limited to invite stub users (`name === "Invited"` set at `createInvite`). Real users must accept with matching Bearer `actorUserId`; otherwise `UNAUTHORIZED` and credentials unchanged.

**Test:** `rejects password+name accept for existing real users without auth` — `npm test -- tests/orgs` → ✅ 6 passed. Redis/refresh-store dirty files remain unstaged.
