# Phase 8 Slice 1 — Fixture Shop Verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Playwright shop verify via a local invite-accept HTML fixture, encrypted vault `storageState`, typed terminal failures, and clearer merchant shop UX.

**Architecture:** Extend existing `shop-verify` BullMQ worker. Dry-run path unchanged. Non-dry-run opens a local fixture, clicks Accept (or maps Reject/Expire/timeout to terminal errors), encrypts Playwright `storageState` into `Shop.sessionVaultCiphertext`. Portal shows `statusReason`, toasts status transitions, and surfaces bot email after connect.

**Tech Stack:** Node/Express, Prisma, BullMQ, Playwright (optional), AES vault (`encryptVault`), Next.js portal, Vitest, Sonner.

## Global Constraints

- Defaults: `SHOP_VERIFY_MODE=stub`, `PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=true`
- No live TikTok URLs, IMAP, or proxy binding
- Never return vault ciphertext on shop list APIs
- Never commit secrets
- Spec: `docs/superpowers/specs/2026-09-18-phase-8-shop-verify-fixture-design.md`

## File map

| File | Responsibility |
|------|----------------|
| `fixtures/shop-verify/invite-accept.html` | Local Accept/Reject/Expire UI |
| `src/workers/shop-verify.errors.ts` | `ShopVerifyTerminalError` + reason codes |
| `src/workers/shop-verify.playwright.scaffold.ts` | Dry-run + fixture Chromium path |
| `src/workers/shop-verify.processor.ts` | Map terminal errors → UnrecoverableError |
| `src/config/env.ts` + `.env.example` | `SHOP_VERIFY_FIXTURE_URL` |
| `tests/shops/verify-playwright.test.ts` | Dry-run vault + fixture reject/accept |
| `tests/shops/verify-stub.test.ts` | Remove stale NOT_IMPLEMENTED |
| Portal shops components | statusReason, toasts, copy bot email |

---

### Task 1: Fixture + terminal error type + env

**Files:**
- Create: `fixtures/shop-verify/invite-accept.html`
- Create: `src/workers/shop-verify.errors.ts`
- Modify: `src/config/env.ts`, `.env.example`

- [ ] **Step 1:** Add HTML fixture with `#btn-accept`, `#btn-reject`, `#btn-expire`, query `shopId`/`region`/`outcome`, accept sets cookie `tiksly_verify=accepted`
- [ ] **Step 2:** Add `ShopVerifyTerminalError` with codes `INVITE_REJECTED` | `INVITE_EXPIRED` | `VERIFY_TIMEOUT` | `PLAYWRIGHT_MISSING`
- [ ] **Step 3:** Add optional `SHOP_VERIFY_FIXTURE_URL` to env (empty → resolve default fixture via `pathToFileURL`)
- [ ] **Step 4:** Commit `feat: add shop-verify fixture and terminal error types`

### Task 2: Playwright fixture path + processor mapping

**Files:**
- Modify: `src/workers/shop-verify.playwright.scaffold.ts`
- Modify: `src/workers/shop-verify.processor.ts`

- [ ] **Step 1:** Non-dry-run: launch Chromium, `goto` fixture URL with shopId/region, if `outcome=reject|expire` click that else click accept; on reject/expire throw `ShopVerifyTerminalError`; on success vault `{ mode, region, storageState, verifiedAt, fixture: true }`
- [ ] **Step 2:** Processor catch: if `ShopVerifyTerminalError`, set FAILED with reason, rethrow `UnrecoverableError` from bullmq
- [ ] **Step 3:** Commit `feat: playwright fixture invite-accept and terminal failures`

### Task 3: Tests

**Files:**
- Modify: `tests/shops/verify-stub.test.ts`
- Create: `tests/shops/verify-playwright.test.ts`

- [ ] **Step 1:** Replace NOT_IMPLEMENTED test with dry-run activate + decryptable vault
- [ ] **Step 2:** Add playwright dry-run test; optional `PLAYWRIGHT=1` fixture accept/reject when chromium installed
- [ ] **Step 3:** Run `npm test -- tests/shops/verify-stub.test.ts tests/shops/verify-playwright.test.ts`
- [ ] **Step 4:** Commit `test: cover playwright dry-run vault and fixture failures`

### Task 4: Portal UX

**Files:**
- Modify: `affiliate-tool-portal/components/shops/shops-table.tsx`
- Modify: `affiliate-tool-portal/components/shops/shops-page-content.tsx`
- Modify: `affiliate-tool-portal/components/shops/connect-shop-dialog.tsx`

- [ ] **Step 1:** Wrap/show full `statusReason`
- [ ] **Step 2:** Toast ACTIVE/FAILED when poll detects transition from VERIFYING
- [ ] **Step 3:** After connect, show bot email + copy button + toast
- [ ] **Step 4:** Commit `feat: shop verify UX — statusReason, toasts, copy bot email`

### Task 5: Plan/docs + merge main

- [ ] Update A→Z plan Phase 8 checkboxes for slice 1 items done
- [ ] Merge both repos to `main` and push
