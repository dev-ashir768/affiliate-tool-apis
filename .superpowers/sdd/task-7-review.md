# Task 7 Review: Bots + shops connect/list/disconnect

**Reviewer:** SDD review (read-only)  
**Base:** `69fff64b757f3cf4a0848b9c12f6af3a6a1624d0`  
**Head:** `010e86bb25312244879224469255b815cfd8a669`  
**Verdict:** **Spec ✅** · **Quality: Important**

---

## Spec compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| Create `src/modules/bots/bots.service.ts` | ✅ | `reserveBot` with optimistic lock |
| Create `src/modules/shops/shops.schemas.ts` | ✅ | `{ region: "US" \| "UK" }` |
| Create `src/modules/shops/shops.service.ts` | ✅ | connect/list/get/disconnect |
| Create `src/modules/shops/shops.routes.ts` | ✅ | `/api/v1/shops` |
| Create `tests/shops/connect.test.ts` | ✅ | Brief cases + list/get/disconnect + HTTP |
| Modify `src/app.ts` | ✅ | Mounted at `/api/v1/shops` |
| `reserveBot(organizationId)` transactional optimistic lock | ✅ | `findFirst` + `updateMany`; race → `CONFLICT` |
| `connectShop({ organizationId, region })` | ✅ | Enforces limit, reserves bot, creates shop |
| `listShops`, `getShop`, `disconnectShop` | ✅ | Org-scoped; `NOT_FOUND` on miss |
| `connectShop` when `shopLimit` is 0 → `PLAN_LIMIT` | ✅ | Tested |
| Happy path: `PENDING_INVITE`, returns `botEmail` | ✅ | Tested |
| Second connect when limit 1 → `PLAN_LIMIT` | ✅ | Tested |
| `disconnectShop`: shop `DISCONNECTED`, bot `AVAILABLE`, clear reservation | ✅ | Transactional update; tested |
| Routes: OWNER/ADMIN connect + delete; member list/get | ✅ | Middleware matches brief |
| TDD / commit message / scope | ✅ | Report: 5 tests in file; full suite 21 tests; no `.env` |

### Documented deviation: `shop: null` filter in `reserveBot`

Brief snippet filters only `status: "AVAILABLE"`. Implementation adds `shop: null`:

```ts
where: { status: "AVAILABLE", shop: null }
```

**Judgment: Acceptable enhancement — required to avoid `@unique` violation on `Shop.botIdentityId` when selecting bots.**

---

## Global constraints

| Constraint | Status | Notes |
|------------|--------|-------|
| Shop connect reserves bot | ✅ | `reserveBot` → `RESERVED` + reservation fields; shop row links `botIdentityId` |
| Disconnect releases bot | ⚠️ | Reservation cleared and status set `AVAILABLE`; bot **not** returned to reservable pool (see Important) |
| `PLAN_LIMIT` on `shopLimit` | ✅ | `activeCount >= org.shopLimit` → 403; counts `status != DISCONNECTED` |
| `Shop.botIdentityId` `@unique` required (schema) | ✅ | Unchanged; respected by `shop: null` filter and one-bot-per-shop create |

---

## Bot-not-reusable-after-disconnect

**Judgment: Important (not Critical, not fully acceptable for production)**

### What happens

1. `disconnectShop` correctly sets shop `DISCONNECTED`, bot `AVAILABLE`, and clears `reservedForOrgId` / `reservedAt`.
2. The disconnected shop row **retains** `botIdentityId` (required FK + `@unique`).
3. `reserveBot` excludes any bot with an existing shop relation (`shop: null`), so that bot is never selected again.
4. Org quota **does** free (`countActiveShops` excludes `DISCONNECTED`), so a reconnect attempt is allowed by `shopLimit` but may fail with `CONFLICT` / "No bots available" if all pool bots are tied to disconnected shop rows.

### Why Important, not Critical

| Factor | Assessment |
|--------|--------------|
| Brief literal spec | Met — disconnect only mandates status/reservation cleanup |
| Core connect/list/disconnect path | Works |
| Reconnect after disconnect | Broken when pool size ≈ number of historical disconnects (e.g. `shopLimit: 1`, seed pool of 5 → pool exhausts after 5 disconnect cycles) |
| Mitigation without code change | Add more bots to seed; manually delete disconnected shop rows in ops |
| Root cause | Schema: required `@unique` `botIdentityId` + 1:1 `BotIdentity.shop` — not fixable inside Task 7 without migration or shop-row lifecycle change |

**Critical** would imply the primary happy path or all connect flows fail; they do not. **Acceptable** would ignore a real pool leak that contradicts the global “disconnect releases bot” intent for quota recycling. **Important** captures the production gap: disconnect frees org slot but not bot capacity, with no test covering reconnect-after-disconnect.

### Recommended follow-up

- Schema/task follow-up: optional `botIdentityId`, soft-delete shop rows, or archive table so bots re-enter the pool; **or** document that reconnect reuses the same shop row (no second connect).
- Add test: disconnect → bump limit if needed → connect again; assert success or document expected `CONFLICT`.

---

## Quality assessment

Implementation is clean, follows established middleware/error patterns, and extends beyond the brief with useful integration coverage.

### Strengths

- `reserveBot` matches brief optimistic-lock pattern; race → `CONFLICT` 409.
- `connectShop` rolls back bot reservation if `shop.create` fails.
- `disconnectShop` uses `$transaction` for shop + bot updates; idempotent when already `DISCONNECTED`.
- `countActiveShops` excluding `DISCONNECTED` aligns shop quota with disconnect semantics.
- Routes wired consistently (`authenticate` → `requireOrg` → `requireRole` where needed).
- Tests cover service + HTTP paths; cleanup deletes shops and resets bots.

### Defects

| Severity | Item |
|----------|------|
| **Important** | **Bot pool leak after disconnect.** Disconnected shops hold the FK; `shop: null` filter prevents reuse. Reconnect-after-disconnect fails once pool bots are all linked to disconnected rows. Conflicts with global “release bot” intent beyond reservation fields. |
| Minor | No test that reconnect after disconnect succeeds (would expose Important gap). |
| Minor | No HTTP assertion that `MEMBER` receives 403 on `POST /connect` or `DELETE /:id` (middleware present; only OWNER exercised). |
| Minor | `shopLimit` check + `reserveBot` + `shop.create` not in one transaction — concurrent connects can both pass limit check (same class of race as seat invites). |

---

## Test verification

Report claims:

- `npm test -- tests/shops/connect.test.ts` — 5 tests passed  
- `npm test` — 8 files, 21 tests passed  

Review performed via static analysis of diff + source (read-only; tests not re-run). Brief TDD cases present; extended coverage for list/get/disconnect and HTTP routes. No reconnect-after-disconnect or pool-exhaustion scenario.

---

## Summary

Task 7 delivers all specified files, endpoints, bot reservation, plan-limit enforcement, and disconnect cleanup. Global constraints for connect-reserve, `PLAN_LIMIT`, and schema uniqueness are satisfied.

One gap warrants follow-up before treating shop connect/disconnect as production-ready:

1. **Bot not reusable after disconnect** — quota recycles but bot pool does not; reconnect can fail with finite pool (Important).

**Spec: ✅**  
**Quality: Important**

**Bot-not-reusable-after-disconnect: Important**

**Recommended fix:** schema or lifecycle change so disconnected shops no longer block bot reservation (null FK, shop archival/delete, or reconnect-via-same-row semantics) plus a reconnect-after-disconnect test.
