# Discover: updatedAt date range filter

**Date:** 2026-11-01  
**Status:** Approved (product); awaiting implementation plan  
**Repos:** `affiliate-tool-apis`, `affiliate-tool-portal`

## Problem

Discover has no way to narrow creators by when they were last updated in the shared index. Merchants want a dedicated date range control (separate from the Filters grid), defaulting to the current calendar month through today.

## Goals

- Filter Discover results by profile **`updatedAt`** (inclusive day bounds).
- Default range: **first day of this month → today** (local calendar dates as `yyyy-MM-dd`).
- Reuse the existing portal `DateRangePicker` (same UX as Analytics / Activity).
- Correct totals and pagination (server-side filter on both Postgres and Meilisearch paths).

## Non-goals

- Filtering by `createdAt` or `metricsSyncedAt` (can add later if needed).
- Client-only / current-page filtering.
- Changing Sync-from-shop controls or job tracking.
- New date-picker component or Discover-specific presets beyond what `DateRangePicker` already offers (7d / 30d / 90d / All time + calendar).

## Field choice

| Option | Decision |
|--------|----------|
| `updatedAt` | **Chosen** — aligns with existing “Sort: recently updated” and index refresh semantics. |
| `metricsSyncedAt` | Deferred — not currently Meili-filterable without reindex work. |
| `createdAt` | Deferred — “first seen” is less useful for marketplace sync freshness. |

## Behavior

### Default and empty

- On Discover load: `updatedFrom` = first day of current month, `updatedTo` = today (`yyyy-MM-dd`).
- `DateRangePicker` Reset restores that same month-to-date default (not last-30-days).
- “All time” (empty `from`/`to`) omits both query params → no date filter.

### Inclusive day semantics

- `updatedFrom=2026-11-01` → `updatedAt >= start of that local calendar day` (UTC midnight of that date string is acceptable and matches Analytics-style ISO date params elsewhere).
- `updatedTo=2026-11-01` → `updatedAt < start of next day` (or `<=` end of that day), so a single-day pick includes the whole day.
- Partial bounds allowed: only `from`, only `to`, or both.

### UI placement

- Dedicated control **above** the Filters `SectionCard` (or in that card’s header actions), not mixed into the FormGrid of GMV/followers/etc.
- Label context: filter is on last updated (button label from `DateRangePicker` is enough; no extra legend required).

## API

### Query params

Extend `discoverySearchSchema` / `searchDiscovery`:

| Param | Type | Meaning |
|-------|------|---------|
| `updatedFrom` | optional `yyyy-MM-dd` | Inclusive lower bound on `updatedAt` |
| `updatedTo` | optional `yyyy-MM-dd` | Inclusive upper bound on `updatedAt` |

Validation: optional strings matching `^\d{4}-\d{2}-\d{2}$` (or coerce via zod date string). Invalid → 400.

### Postgres path

Add to Prisma `where`:

- `updatedFrom` → `updatedAt: { gte: startOfDay(updatedFrom) }`
- `updatedTo` → merge `updatedAt: { lt: startOfNextDay(updatedTo) }` (or `lte` end-of-day)

### Meilisearch path

Meili documents already store `updatedAt` as epoch ms and list it under `filterableAttributes`.

- `updatedFrom` → `updatedAt >= ms(startOfDay)`
- `updatedTo` → `updatedAt < ms(startOfNextDay)`

When `savedToCrm` forces the Postgres path, the same Prisma bounds apply (no Meili).

### Portal wiring

- `searchDiscovery` / `useDiscoverySearch` accept `updatedFrom` / `updatedTo`.
- Discover page: `useState` initialized with month-to-date helper (e.g. `rangeFromMonthToDate()` next to existing `rangeFromDays`).
- Pass range into the search query; include in filters signature so page resets to 1 on change.

## Testing

- API unit/integration: with fixtures, `updatedFrom`/`updatedTo` exclude rows outside the window; inclusive single-day works; Meili filter string includes bounds when Meili is used.
- Portal: smoke that picker defaults to month-to-date and changing range refetches (manual or light component test if present).

## Out of scope follow-ups

- Persist last-used Discover date range in localStorage.
- Preset button labeled “This month” inside `DateRangePicker` (month-to-date can be the page `defaultValue` without a new preset).
