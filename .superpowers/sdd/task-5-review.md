# Task 5 Review: Org context middleware + orgs/members/invites

**Reviewer:** SDD review (read-only)  
**Base:** `1d9fece5eb160b05b0a1c2f9c50ff720cd26971f`  
**Head:** `cb676a93467db0b3176296df8b92b8f3d3c28af2`  
**Verdict:** **Spec ❌** · **Quality: Important**

---

## Spec compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| Create `src/middleware/require-org.ts` | ✅ | Loads ACTIVE membership → `req.membership` |
| Create `src/middleware/require-role.ts` | ✅ | Gates `OWNER` / `ADMIN` (etc.) |
| Create `src/modules/orgs/orgs.schemas.ts` | ✅ | create/patch/accept Zod schemas |
| Create `src/modules/orgs/orgs.service.ts` | ✅ | getCurrent, patchCurrent, listMembers, createInvite, acceptInvite |
| Create `src/modules/orgs/orgs.routes.ts` | ✅ | All brief endpoints mounted |
| Modify `src/app.ts` | ✅ | `/api/v1/orgs` |
| Create `tests/orgs/invites.test.ts` | ✅ | PLAN_LIMIT + accept + HTTP flow |
| `GET/PATCH /api/v1/orgs/current` | ✅ | authenticate + requireOrg; PATCH gated OWNER/ADMIN |
| `GET /api/v1/orgs/current/members` | ✅ | |
| `POST /api/v1/orgs/current/invites` `{ email, role }` | ✅ | OWNER/ADMIN; role enum excludes OWNER |
| `POST /api/v1/orgs/invites/:token/accept` | ⚠️ | Works for happy paths; existing-user auth rule not fully enforced (see below) |
| Seat count = ACTIVE \| INVITED; over limit → `PLAN_LIMIT` 403 | ✅ | `countSeats` + test |
| Invite: `sha256(rawToken)`, `INVITE_TTL_SEC`, status `INVITED` | ✅ | Raw token returned once |
| Accept: auth as invitee OR password+name for new user | ⚠️ | New-user path ✅; existing-user must-auth rule bypassed in some cases |
| Consumes `AccessClaims` on `req.auth` | ✅ | Via `authenticate` + optional Bearer on accept |
| TDD / tests pass | ✅ | Report: 5 tests in invites file; full suite 13 tests |
| Commit scope | ✅ | Message matches brief; no `.env` |

### Documented deviation: stub User at invite time

Brief locked plan prefers creating the User on **accept** when the email is unknown. Implementation creates a placeholder User at **invite** time (random password, name `"Invited"`) because `Membership.userId` is required and seat counting includes `INVITED` rows.

**Judgment: Acceptable — not an Important defect.**

- Prisma schema has no `pendingEmail` / optional `userId`; a membership row cannot exist without a user.
- Accept finalizes stub credentials via password+name (tested).
- Report documents the trade-off (`DONE_WITH_CONCERNS`).

**Caveats (Minor follow-ups, not blockers):**

- Brief path “invitee registers normally, then accept links” is unavailable — stub occupies the unique email and `register` returns `CONFLICT`.
- `listMembers` exposes stub invitees as name `"Invited"` until accept.
- Orphan stubs if invite expires without accept/cleanup (no TTL job in scope).

---

## Global constraints

| Constraint | Status | Notes |
|------------|--------|-------|
| Roles `OWNER` \| `ADMIN` \| `MEMBER` | ✅ | create invite allows ADMIN/MEMBER; middleware uses Prisma enum |
| Seat limits via `PLAN_LIMIT` (403) | ✅ | |
| Error envelope `{ error: { code, message, details? } }` | ✅ | `AppError` → `errorHandler` |
| Invite tokens hashed SHA-256; TTL from `INVITE_TTL_SEC` | ✅ | `sha256` + `env.INVITE_TTL_SEC` |

---

## Quality assessment

Middleware and route wiring are clean and consistent with prior tasks. Service logic covers org read/update, member listing, seat-limited invites, and token-based accept. Tests follow TDD (PLAN_LIMIT first) and extend to HTTP integration.

### Strengths

- `requireOrg` / `requireRole` chain matches brief; PATCH and invite routes correctly require OWNER/ADMIN.
- Seat accounting and `PLAN_LIMIT` match spec; conflict paths roll back freshly created stubs on duplicate invite.
- Accept route supports optional Bearer auth (invalid token ignored → password path), matching brief flexibility for new users.
- Invite role schema excludes OWNER; email normalized to lowercase.
- Test cleanup handles memberships, refresh tokens, orgs, and Redis disconnect.

### Defects

| Severity | Item |
|----------|------|
| **Important** | **`acceptInvite` password+name path for existing users.** Brief: existing user must be authenticated to accept. Implementation only blocks password+name when the user has *another* ACTIVE membership (`otherActive`). A real pre-existing user invited to a new org (sole ACTIVE membership elsewhere absent) can accept with token + password+name and have credentials overwritten without proving account ownership via auth. Fix: require `actorUserId` when the user is not a stub (e.g. `UserStatus`, `name !== "Invited"`, or invite-time flag); reserve password+name for stub users only. |
| Minor | `createInvite` does not assert actor role in service (relies on route middleware). |
| Minor | No tests for expired invite, CONFLICT (already member/invited), or MEMBER forbidden on POST invites. |
| Minor | Expired `INVITED` rows still consume seats until status changes (consistent with brief seat rule; no expiry cleanup). |
| Minor | DISABLED membership re-invite → `INVITED` works but is undocumented. |

---

## Test verification

Report claims `npm test -- tests/orgs/invites.test.ts` and full suite pass. Review performed via static analysis of diff + source (read-only; tests not re-run). Test coverage aligns with brief Step 1 and extends accept/HTTP paths; gap on existing-user unauthenticated accept and negative HTTP cases.

---

## Summary

Task 5 delivers org middleware, all specified endpoints, seat-limited invites with hashed tokens, and solid test coverage for primary flows. Global constraints and the stub-user workaround are acceptable given schema limits.

One gap blocks full approval:

1. **Accept flow for existing users** — password+name bypass violates brief auth requirement and enables credential overwrite (Important) — blocks Spec ✅.

Stub users at invite time are a **documented, acceptable deviation**; not treated as an Important defect vs `Membership.userId` required.

**Recommended fix before merge:** in `acceptInvite`, detect stub vs real user and require authentication for real users; add test that existing user cannot accept via password+name without Bearer token.

**Spec: ❌**  
**Quality: Important**

---

## R2 Re-review (after `c52d9e5`)

**Reviewer:** SDD review (read-only)  
**Base:** `1d9fece5eb160b05b0a1c2f9c50ff720cd26971f`  
**Head:** `c52d9e5077961bfa3159c0522ff7255007959453`  
**Verdict:** **Spec ✅** · **Quality Approved**

### Fix verification: acceptInvite auth split

Commit `c52d9e5` resolves the R1 **Important** finding. `acceptInvite` now branches on stub vs real user:

| Path | Condition | Behavior |
|------|-----------|----------|
| Authenticated accept | `actorUserId` present | Must match `membership.userId`; activates without credential change |
| Stub finalize | No auth + `user.name === "Invited"` | Requires `password` + `name`; updates credentials |
| Real user, no auth | No auth + `user.name !== "Invited"` | `UNAUTHORIZED` (401); credentials unchanged |

This matches the brief: **existing users require Bearer**; **password+name is stub-only**.

Route layer unchanged — optional Bearer via `verifyAccessToken` → `actorUserId`; invalid token ignored (falls through to stub or UNAUTHORIZED paths).

### Spec compliance (delta from R1)

| Requirement | R1 | R2 |
|-------------|----|----|
| `POST /api/v1/orgs/invites/:token/accept` | ⚠️ | ✅ |
| Accept: auth as invitee OR password+name for new user | ⚠️ | ✅ |

All other R1 ✅ rows unchanged. Stub-at-invite deviation remains **acceptable** (schema constraint; documented).

### Test coverage (delta)

New test `rejects password+name accept for existing real users without auth` asserts:

- `UNAUTHORIZED` when real user attempts password+name without Bearer
- `passwordHash` and `name` unchanged
- Membership stays `INVITED`

Report claims 6 tests in invites file; full suite still green. Static review only (tests not re-run).

### Remaining items (Minor — not blockers)

Unchanged from R1; none at Critical or Important severity:

- `createInvite` role check only in route middleware
- No tests for expired invite, CONFLICT, MEMBER forbidden on POST invites
- Expired `INVITED` rows consume seats (brief-consistent; no TTL cleanup)
- DISABLED re-invite undocumented
- Stub-user caveats (register CONFLICT, `"Invited"` in member list, orphan stubs)

### Summary

R1 blocker is closed. Existing real users cannot accept via token + password+name; stub users still finalize via password+name. Task 5 meets brief and global constraints.

**Spec: ✅**  
**Quality: Approved**
