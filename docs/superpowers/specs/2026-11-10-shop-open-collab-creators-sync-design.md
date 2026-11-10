# Shop open-collaboration creators → CRM sync

**Date:** 2026-11-10  
**Status:** Approved (product); awaiting implementation  
**Repos:** `affiliate-tool-apis`, `affiliate-tool-portal`

## Problem

Merchants connect a TikTok Shop via OAuth and can already list shop products. They expect creators who promote those products (open collaboration / showcase) to land in Tiksly CRM. Official OpenAPI has **no** “list all shop-linked creators” endpoint, and Agency **Manage partnerships** linked creators are a different Partner Center surface (out of scope).

## Goals

- Sync creators from **open collaboration products** on an OAuth-connected shop into org CRM.
- Upsert `Creator` rows and add them to a shared list **“Shop collaborators”**.
- Trigger on **OAuth connect (auto)** and via **manual re-sync** button.
- Run as a **background job** (rate-limit safe; no long HTTP request).

## Non-goals

- Agency Manage Partnerships / Linked Creators (Partner Center CAP list, including undocumented `relation/list`).
- Creator Marketplace discovery / `seller.creator_marketplace.read`.
- Overwriting existing CRM `stage`, `notes`, or contact fields on re-sync.
- Per-shop separate CRM lists in v1 (one org-level “Shop collaborators” list).
- Target-collaboration-only creators who never appear on open-collab product creator_content_details.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Destination | CRM `Creator` upsert + list **Shop collaborators** |
| Trigger | OAuth success auto-enqueue **and** manual button |
| Product scope | **Open collaboration products only** (Search Open Collaborations) |
| Execution | Background BullMQ job (same family as discovery/automation) |
| New creator stage | `ACTIVE` |
| Existing creator stage | Do **not** overwrite |

## Architecture

```
OAuth complete / POST sync
        │
        ▼
Enqueue shopOpenCollabCreatorsSync job (shopId, organizationId)
        │
        ▼
Search Open Collaborations (paginate)
        │
        ▼
For each product (cap N):
  Get Open Collaboration Creator Content Details (paginate)
        │
        ▼
Dedupe by creator_open_id → username
        │
        ▼
Upsert Creator (org + TIKTOK + handle)
Ensure CreatorList "Shop collaborators"
Add CreatorListMember if missing
        │
        ▼
Persist job result summary on shop / sync status record
```

### TikTok APIs

| Step | API | Scope |
|------|-----|--------|
| List open collab products | `POST /affiliate_seller/202508/open_collaborations/search` (or current documented Search Open Collaborations version) | `seller.affiliate_collaboration.read` |
| Creators per product | `GET /affiliate_seller/202508/open_collaborations/creator_content_details` | `seller.affiliate_collaboration.read` |

Reuse existing TikTok client pacing (`MIN_INTERVAL_MS` / retry helpers in `tiktok-shop/client.ts`).

### Mapping → `Creator`

| TikTok field | CRM field |
|--------------|-----------|
| `creator_profile.username` (required) | `handle` |
| `creator_profile.nickname` | `displayName` |
| `creator_open_id` | `creatorOpenId` |
| `creator_profile.follower_count` | `followerCount` |
| `creator_profile.avatar.url` | `avatarUrl` |
| — | `platform = TIKTOK` |
| — | `stage = ACTIVE` only on **create** |

Skip rows missing username. Prefer open_id for dedupe when present; unique key remains `organizationId + platform + handle`.

### List

- Name: **`Shop collaborators`** (exact, case-sensitive create-if-missing).
- Org-scoped; shared across shops in v1.
- Re-sync is idempotent for membership (`creatorId` already on list → no-op).

## API (Tiksly)

### `POST /api/v1/shops/:shopId/sync-open-collab-creators`

- Auth: merchant org member for that shop.
- Preconditions: shop exists, not disconnected, `oauthConnectedAt` set.
- Behavior: enqueue job if none running for shop; else return existing running job.
- Response: `{ jobId, status: "QUEUED" | "RUNNING", shopId }`.

### `GET /api/v1/shops/:shopId/sync-open-collab-creators/status`

- Latest job summary for UI:
  - `status`: `QUEUED | RUNNING | SUCCEEDED | PARTIAL | FAILED`
  - `productsScanned`, `creatorsUpserted`, `creatorsLinkedToList`, `failedProducts`, `truncatedAt`, `lastError?`

### OAuth hook

After successful token save in `tiktok-oauth.service` (shop connect complete), enqueue the same job (best-effort; OAuth success must not fail if enqueue fails — log + allow manual retry).

### Portal

- BFF routes mirroring the two endpoints under `/api/shops/[id]/...`.
- Shops UI: **Sync shop creators** on connected shops + last sync summary.
- OAuth callback success path: toast that sync started (status poll optional in v1).

## Limits

| Cap | Default | On exceed |
|-----|---------|-----------|
| Open-collab products per run | 500 | Stop product loop → `PARTIAL` |
| Unique creators upserted per run | 10_000 | Stop upserts → `PARTIAL` |
| Concurrent jobs per shop | 1 | Return existing job |
| Creator content `page_size` | ≤ 100 (TikTok max) | — |

Env overrides optional later (`SHOP_OPEN_COLLAB_SYNC_MAX_PRODUCTS`, etc.); hardcode defaults in v1 OK.

## Error handling

| Case | Behavior |
|------|----------|
| Shop not OAuth-connected | `400 SHOP_NOT_READY` |
| Missing affiliate collaboration read scope | Mapped TikTok error; job `FAILED` with actionable message |
| Single product creator fetch fails | Increment `failedProducts`, continue |
| Fatal / auth revoked mid-job | `FAILED` + `lastError` |
| Empty open collabs | `SUCCEEDED` with zeros |

## Data / persistence

Prefer a lightweight JSON summary on `Shop` (e.g. `openCollabCreatorsSync` Json?) **or** reuse a small sync-status table if one already exists for discovery — pick the pattern closest to discovery TikTok sync status during implementation. Do not invent a second CRM creator model.

## Testing

- Unit/service: mock Search Open Collaborations + creator_content_details → creators upserted + list membership.
- Re-run: same creators → no duplicate list members; stage unchanged for existing ACTIVE/LEAD mix.
- Missing scope / not connected → expected AppError / FAILED status.
- Cap: when product cap hit → `PARTIAL` with counts.

## Success criteria

- Connected shop with open-collab products: manual sync populates CRM + **Shop collaborators**.
- Fresh OAuth connect auto-starts the same job.
- Re-sync is safe (idempotent membership; no stage clobber).
- UI shows sync action + last result summary.

## Spec self-review

- [x] No “TBD” placeholders for core flow
- [x] Agency Manage Partnerships explicitly out of scope (no contradiction with Option A)
- [x] Caps and concurrency defined
- [x] Affimatic marketplace limitation acknowledged (this feature does not depend on marketplace read)
