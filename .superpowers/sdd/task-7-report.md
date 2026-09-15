# Task 7 Report: Bots + shops connect/list/disconnect

**Status:** DONE_WITH_CONCERNS  
**Branch:** `feat/foundation-api`  
**Base:** `69fff64b757f3cf4a0848b9c12f6af3a6a1624d0`  
**Commits:** `010e86b` — `feat: add shop connect, list, and disconnect with bot reservation`

## Summary

Added bot reservation (`reserveBot` with `updateMany` optimistic lock) and shop connect/list/get/disconnect under `/api/v1/shops`. Connect enforces org `shopLimit` (non-`DISCONNECTED` count); OWNER/ADMIN for connect/delete; any member for list/get.

## Files Created/Modified

| File | Action |
|------|--------|
| `src/modules/bots/bots.service.ts` | Created — `reserveBot` optimistic lock |
| `src/modules/shops/shops.schemas.ts` | Created — connect body `{ region }` |
| `src/modules/shops/shops.service.ts` | Created — connect/list/get/disconnect |
| `src/modules/shops/shops.routes.ts` | Created — `/api/v1/shops` routes |
| `src/app.ts` | Modified — mount shops routes |
| `tests/shops/connect.test.ts` | Created — PLAN_LIMIT, happy path, HTTP |

## Test Results

| Command | Result |
|---------|--------|
| `npm test -- tests/shops/connect.test.ts` | ✅ 1 file, 5 tests passed |
| `npm test` (full suite) | ✅ 8 files, 21 tests passed |

## TDD notes

1. Wrote failing `tests/shops/connect.test.ts` (module missing) → RED.
2. Implemented bots + shops services/routes + app mount → GREEN.
3. Extended coverage for list/get/disconnect + HTTP connect/list/get/delete.

## Self-Review

- [x] `reserveBot` uses `findFirst` + `updateMany` where `id` + `AVAILABLE`; race → CONFLICT
- [x] `connectShop` throws `PLAN_LIMIT` when active shops >= `shopLimit`
- [x] Happy path: shop `PENDING_INVITE`, returns `botEmail`
- [x] `disconnectShop` → shop `DISCONNECTED`, bot `AVAILABLE`, clears reservation fields
- [x] Routes: OWNER/ADMIN for POST `/connect` + DELETE `/:id`; member for GET `/` + GET `/:id`
- [x] Mounted at `/api/v1/shops` in `app.ts`
- [x] Commit message matches brief; `.env` not committed

## Concerns for Follow-up

1. **Bot reuse after disconnect:** `Shop.botIdentityId` is required + unique, so a DISCONNECTED shop still holds the FK. `reserveBot` filters `shop: null` so it won't pick linked bots (avoids unique violation). Disconnected bots are marked AVAILABLE but are not reusable for a *new* shop until the schema allows nulling the FK or deleting the shop row.
2. **Shop limit counting:** Counts shops with `status != DISCONNECTED`. Not explicitly mandated by the brief; aligns with freeing quota after disconnect.
3. **No MEMBER-forbidden HTTP assertion** for connect/delete (only OWNER path exercised); role middleware matches other modules.

## Commands for Reproduction

```bash
npm test -- tests/shops/connect.test.ts
npm test
```

## Follow-up fix (review finding)

**Commit:** `3b6f600` — `fix: release botIdentity FK on shop disconnect`

**Issue:** After disconnect, `Shop.botIdentityId` remained set (required unique FK), so `reserveBot` (`shop: null`) never reused the bot.

**Fix:**
1. Made `Shop.botIdentityId` / `botIdentity` optional in Prisma schema.
2. Migration `20250915200000_shop_bot_identity_optional` (`ALTER COLUMN ... DROP NOT NULL`), applied via `prisma migrate deploy`.
3. `disconnectShop` now sets `status=DISCONNECTED`, `botIdentityId=null`, and clears bot reservation fields / sets `AVAILABLE`.
4. Added test: connect → disconnect → connect reuses the same released bot.

**Test:** `npm test -- tests/shops` → ✅ 1 file, 6 tests passed.

**Concerns update:** Bot-reuse concern #1 is resolved.
