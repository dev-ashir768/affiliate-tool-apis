# Discovery: Saved CRM flag + category name display

**Date:** 2026-10-29  
**Status:** Approved (product); awaiting implementation plan  
**Repos:** `affiliate-tool-apis`, `affiliate-tool-portal`

## Problem

1. After a merchant saves a discovery profile to CRM, the Discover table still shows **Save**. Reloading the page does not show that the creator is already in CRM.
2. The Categories column shows TikTok marketplace **category IDs** (e.g. `604453`, `602118`, `600001`) instead of human-readable names (Furniture, Pet Supplies, Home Supplies).

## Goals

- Permanent **Saved** state per org: any discovery row whose TikTok handle already exists as a `Creator` for that organization shows **Saved** (disabled), including after reload and filter/page changes.
- Categories column shows mapped names; unknown IDs remain as the raw code (no crash).

## Non-goals

- Un-save / remove from CRM from Discover.
- Live TikTok Get Categories API or admin-editable category catalog.
- Renaming IDs already stored in Postgres (IDs stay the source of truth in `CreatorDiscoveryProfile.categories`).

## Approach (chosen)

| Concern | Choice | Why |
|--------|--------|-----|
| Saved | Enrich org discovery search with `savedToCrm: boolean` via one CRM handle lookup | Single response; no extra client round-trip; scales with page size |
| Categories | Static ID→name map at API response time (`toProfile`) | Marketplace IDs are a small fixed set; avoids Partner API / product-tree complexity |

Rejected: client-side CRM dump; separate “which saved?” batch endpoint; sync-time rewrite of stored category arrays (needs backfill).

## API design

### Response shape

Each discovery profile in org search (and any other merchant-facing discovery list that powers Discover) gains:

```ts
savedToCrm: boolean;
categories: string[]; // display names when known; else original id strings
```

Platform/backoffice discovery may omit `savedToCrm` (always false / unused) or leave it unset; merchant Discover is the consumer.

### `savedToCrm` computation

1. Load discovery rows for the page as today.
2. Collect distinct `handle` values (normalized the same way as CRM: no leading `@`, trim).
3. Query `Creator` where `organizationId`, `platform: TIKTOK`, `handle in (...)`.
4. Set `savedToCrm: true` when the row’s handle is in that set.

Matching key: **`organizationId + platform + handle`** (same uniqueness as `Creator` / save upsert). Do not rely on discovery profile `id` (CRM rows use a different id).

### Category mapping

- Add a small module (e.g. `src/modules/discovery/marketplace-categories.ts`) exporting `MARKETPLACE_CATEGORY_NAMES: Record<string, string>` and `formatMarketplaceCategories(ids: string[]): string[]`.
- Seed with the known TikTok Shop creator-marketplace category list (including at least: `604453` Furniture, `602118` Pet Supplies, `600001` Home Supplies, and the rest of the published marketplace set).
- In `toProfile` (or a thin wrapper used by search), map each stored id through the helper before returning.
- DB continues to store raw ids from TikTok sync.

### Save endpoint

`saveDiscoveryToCrm` behavior unchanged for persistence. On success the client already toasts; after this work it should also refresh search (or optimistically set `savedToCrm`) so the button flips to **Saved** without a full page reload.

## Portal design

- Extend `DiscoveryProfile` with `savedToCrm?: boolean`.
- Actions column:
  - `savedToCrm` → button label **Saved**, `disabled`, non-primary outline (or muted) so it is readable but not clickable.
  - Saving in flight → **Saving…** (existing).
  - Otherwise → **Save**.
- On successful save: invalidate discovery query (preferred) so server truth wins; optional optimistic `savedToCrm: true` for that id while refetching.
- Categories cell: keep joining `categories` with `", "` — names come from API.

## Data flow

```
TikTok sync → stores category_ids on CreatorDiscoveryProfile
                    ↓
Org discovery search → load rows → map category ids → names
                    → lookup CRM handles for org → set savedToCrm
                    ↓
Portal Discover table → show names; Save vs Saved
```

## Error handling

- CRM lookup failure: fail the search request (same as other DB errors); do not silently mark everyone unsaved.
- Unknown category id: pass through unchanged string.
- Save of already-existing CRM creator: existing P2002 upsert path; response still success → UI shows Saved after refetch.

## Testing

- Unit: `formatMarketplaceCategories` maps known ids; unknown ids unchanged; empty → empty.
- Unit/service: given org creators with handles A,B and discovery rows A,C → `savedToCrm` true only for A.
- Portal: columns render Saved when `savedToCrm`; Save when false (lightweight component test if present; else manual).

## Out of scope follow-ups

- Filter Discover by “not yet saved”.
- Fetch/refresh category map from Partner Get Categories.
