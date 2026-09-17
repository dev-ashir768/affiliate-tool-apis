# Phase 8 Slice 1 — Fixture-based Playwright Shop Verify

Date: 2026-09-18  
Status: Approved  
Scope: APIs worker + portal shops UX (no live TikTok, no IMAP)  
Stack: BullMQ `shop-verify`, Playwright Chromium (optional), AES vault, Next portal BFF  

Related:
- Master plan: `docs/superpowers/plans/2026-09-18-complete-saas-a-to-z.md` (Phase 8)
- Foundation shops/verify: existing `verify.service.ts` + `shop-verify.processor.ts`

## Goal

Prove the **real browser → encrypted session vault → ACTIVE shop** path end-to-end using a **local HTML invite-accept fixture**, without inventing TikTok/commerce APIs or depending on Seller Center credentials.

Defaults stay safe for CI/dev: `SHOP_VERIFY_MODE=stub`, `PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=true`.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Slice 1 target | Local fixture invite-accept (Approach A) |
| Live TikTok Seller Center | Out of scope — Slice 2 |
| Bot inbox (IMAP) | Out of scope — Slice 3 |
| Proxy binding into browser | Out of scope |
| Default verify mode | `stub` (unchanged) |
| Playwright without browser | Dry-run activates + vault `playwright-dry-run` (existing) |
| Real browser path | Fixture URL/file + Accept click + vault `storageState` |
| Failure taxonomy | Typed reasons for Reject / Expire / timeout; terminal failures do not burn all retries blindly |
| Vault contents | JSON: `{ mode, region, storageState?, verifiedAt, fixture? }` — never log ciphertext |
| Portal | Clearer `statusReason`, FAILED toast on poll, copy bot email after connect |

## Current baseline

```
Connect shop → bot reserved → PENDING_INVITE
     → POST verify → ShopVerificationJob QUEUED → BullMQ shop-verify
     → STUB: ACTIVE + empty vault
     → PLAYWRIGHT + dry-run: ACTIVE + encrypted dry-run vault
     → PLAYWRIGHT + dry-run=false: about:blank only (to replace)
```

## Target flow (Slice 1)

```
SHOP_VERIFY_MODE=playwright
PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=false
SHOP_VERIFY_FIXTURE_URL=file://…/invite-accept.html   (or http fixture)

Worker:
  launch Chromium → open fixture (pass shopId/region as query)
  → click [data-action=accept]
  → capture context.storageState()
  → encryptVault → shop ACTIVE, bot ASSIGNED, job SUCCEEDED

Reject / Expire / timeout:
  → shop FAILED + statusReason
  → job FAILED + lastError
  → UnrecoverableError (or equivalent) so BullMQ does not retry forever
```

## Fixture contract

File: `affiliate-tool-apis/fixtures/shop-verify/invite-accept.html`

- Query params: `shopId`, `region` (`US`|`UK`), optional `outcome` override for tests
- Buttons:
  - `#btn-accept` / `[data-action="accept"]` — success path
  - `#btn-reject` / `[data-action="reject"]` — terminal failure
  - `#btn-expire` / `[data-action="expire"]` — terminal failure
- On accept: set a cookie / `localStorage` marker so `storageState` is non-empty
- Visible region label for screenshot/debug (not required for CI)

No network calls to TikTok domains.

## API / worker changes

| File | Change |
|------|--------|
| `src/config/env.ts` | Add optional `SHOP_VERIFY_FIXTURE_URL` (default: resolve to packaged fixture path) |
| `.env.example` | Document mode + dry-run + fixture URL |
| `src/workers/shop-verify.playwright.scaffold.ts` | Replace `about:blank` with fixture flow; capture storageState; typed failures |
| `src/workers/shop-verify.errors.ts` (new, optional) | `ShopVerifyTerminalError` with `reasonCode` |
| `src/workers/shop-verify.processor.ts` | Map terminal errors → FAILED without useless retries (use BullMQ `UnrecoverableError` where available) |
| `package.json` | Document optional `playwright`; do not require it for stub/dry-run |
| `tests/shops/verify-stub.test.ts` | Remove stale `NOT_IMPLEMENTED` expectation |
| `tests/shops/verify-playwright.test.ts` (new) | Dry-run vault round-trip; optional `PLAYWRIGHT=1` fixture accept |

### Failure reason codes

| Code | `statusReason` / `lastError` (human) | Retry? |
|------|--------------------------------------|--------|
| `INVITE_REJECTED` | Invite was rejected on the verify page | No |
| `INVITE_EXPIRED` | Invite expired on the verify page | No |
| `VERIFY_TIMEOUT` | Timed out waiting for invite accept | No (or 1 retry max — prefer No for fixture) |
| `PLAYWRIGHT_MISSING` | Playwright package not installed | No |
| `SHOP_DISCONNECTED` | Shop disconnected mid-job (existing) | No |

## Portal changes (merchant shops only)

| File | Change |
|------|--------|
| `components/shops/shops-table.tsx` | Show full/wrapped `statusReason` (tooltip or multi-line) |
| `components/shops/shops-page-content.tsx` | Toast when a shop transitions VERIFYING → FAILED / ACTIVE |
| `components/shops/connect-shop-dialog.tsx` (or page) | After connect success: show + copy bot email for Seller Center invite |

Backoffice shops table: optional `statusReason` column — nice-to-have, not required for Slice 1 green.

## Out of scope (explicit)

- Live TikTok Seller Center URLs / selectors / login
- IMAP / webhook bot inbox monitoring
- Binding platform `Proxy` into Playwright context
- Creator discovery, campaigns, orders sync (Phase 9)
- Changing stub mode behavior for demos

## Success criteria

- [ ] `SHOP_VERIFY_MODE=stub` unchanged green tests
- [ ] Playwright dry-run → ACTIVE + decryptable vault `mode: playwright-dry-run`
- [ ] Playwright + dry-run=false + fixture Accept → ACTIVE + vault contains `storageState`
- [ ] Fixture Reject → FAILED with `INVITE_REJECTED`, no ACTIVE
- [ ] Portal surfaces `statusReason`; connect UX exposes bot email to copy
- [ ] No secrets committed; vault ciphertext never returned on shop list APIs

## Slice 2 / 3 (preview only)

2. Swap fixture URL for region-specific Seller Center invite URL + real selectors behind the same flags  
3. Bot inbox monitoring to detect invite email before/alongside browser accept  

## Open points (non-blocking)

- Exact default fixture path resolution on Windows vs Linux (`pathToFileURL`)
- Whether `VERIFY_TIMEOUT` allows a single BullMQ retry — default **no** for Slice 1
