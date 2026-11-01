# Discover updatedAt Date Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Discover filter creators by `updatedAt` with a dedicated date range picker defaulting to this month → today, with correct server-side totals on Postgres and Meilisearch.

**Architecture:** Add optional `updatedFrom` / `updatedTo` (`yyyy-MM-dd`) to discovery search. Parse to inclusive-day UTC bounds via a small helper used by both Prisma `where.updatedAt` and Meili `updatedAt` ms filters. Portal reuses `DateRangePicker` with a new `rangeFromMonthToDate()` default above the Filters card.

**Tech Stack:** Express + Zod + Prisma + Meilisearch + Vitest (apis); Next.js + React Query + existing `DateRangePicker` (portal)

**Spec:** `docs/superpowers/specs/2026-11-01-discover-updated-date-range-design.md`

## Global Constraints

- Dual repos: commit API work in `affiliate-tool-apis`, portal work in `affiliate-tool-portal`
- Filter field is **`updatedAt` only** (not `createdAt` / `metricsSyncedAt`)
- Day bounds: `updatedFrom` → `gte` start of that UTC calendar day; `updatedTo` → `lt` start of next UTC day (inclusive single-day)
- Empty `from`/`to` → omit params / no date filter (“All time”)
- Default UI range: first day of current month → today (`yyyy-MM-dd`)
- Do not change Sync-from-shop or job-tracking UI
- YAGNI — no localStorage persistence, no new “This month” preset inside the shared picker (page `defaultValue` is enough)

## File map

| File | Responsibility |
|------|----------------|
| `affiliate-tool-apis/src/modules/discovery/discovery-date-bounds.ts` | Parse `yyyy-MM-dd` → `{ gte?: Date; lt?: Date }` |
| `affiliate-tool-apis/tests/discovery-date-bounds.test.ts` | Unit tests for bound math |
| `affiliate-tool-apis/src/modules/discovery/discovery.schemas.ts` | Optional `updatedFrom` / `updatedTo` validation |
| `affiliate-tool-apis/src/modules/discovery/discovery.service.ts` | Pass params; apply Prisma `updatedAt` filter |
| `affiliate-tool-apis/src/lib/meilisearch.ts` | Meili filter on `updatedAt` ms |
| `affiliate-tool-portal/components/ui/date-range-picker.tsx` | Export `rangeFromMonthToDate()` |
| `affiliate-tool-portal/services/commerce.ts` | Accept `updatedFrom` / `updatedTo` on `searchDiscovery` |
| `affiliate-tool-portal/hooks/use-commerce.ts` | Thread params through `useDiscoverySearch` |
| `affiliate-tool-portal/components/discover/discover-page-content.tsx` | Picker state + placement |

---

### Task 1: Date bound helper (API)

**Files:**
- Create: `affiliate-tool-apis/src/modules/discovery/discovery-date-bounds.ts`
- Create: `affiliate-tool-apis/tests/discovery-date-bounds.test.ts`

**Interfaces:**
- Produces: `updatedAtBounds(from?: string, to?: string): { gte?: Date; lt?: Date }`
- Consumes: none

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { updatedAtBounds } from "../src/modules/discovery/discovery-date-bounds.js";

describe("updatedAtBounds", () => {
  it("returns empty object when both missing", () => {
    expect(updatedAtBounds()).toEqual({});
    expect(updatedAtBounds(undefined, undefined)).toEqual({});
    expect(updatedAtBounds("", "")).toEqual({});
  });

  it("maps from to gte start of UTC day", () => {
    const { gte, lt } = updatedAtBounds("2026-11-01");
    expect(lt).toBeUndefined();
    expect(gte?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("maps to to lt start of next UTC day (inclusive)", () => {
    const { gte, lt } = updatedAtBounds(undefined, "2026-11-01");
    expect(gte).toBeUndefined();
    expect(lt?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("supports both ends for a single day", () => {
    const { gte, lt } = updatedAtBounds("2026-11-15", "2026-11-15");
    expect(gte?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(lt?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("supports a multi-day window", () => {
    const { gte, lt } = updatedAtBounds("2026-11-01", "2026-11-30");
    expect(gte?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(lt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd affiliate-tool-apis && npx vitest run tests/discovery-date-bounds.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement the helper**

Create `affiliate-tool-apis/src/modules/discovery/discovery-date-bounds.ts`:

```ts
/**
 * Inclusive calendar-day bounds for Discover `updatedAt` filters.
 * `from`/`to` are `yyyy-MM-dd`; empty/missing → omitted.
 * Upper bound is exclusive next-day midnight so a single day includes the whole day.
 */
export function updatedAtBounds(
  from?: string,
  to?: string,
): { gte?: Date; lt?: Date } {
  const out: { gte?: Date; lt?: Date } = {};
  const fromDay = from?.trim();
  const toDay = to?.trim();
  if (fromDay) {
    out.gte = new Date(`${fromDay}T00:00:00.000Z`);
  }
  if (toDay) {
    const start = new Date(`${toDay}T00:00:00.000Z`);
    out.lt = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd affiliate-tool-apis && npx vitest run tests/discovery-date-bounds.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (apis repo)**

```bash
cd affiliate-tool-apis
git add src/modules/discovery/discovery-date-bounds.ts tests/discovery-date-bounds.test.ts
git commit -m "feat(discovery): add updatedAt day-bound helper"
```

---

### Task 2: Wire bounds into schema, Postgres, and Meili (API)

**Files:**
- Modify: `affiliate-tool-apis/src/modules/discovery/discovery.schemas.ts`
- Modify: `affiliate-tool-apis/src/modules/discovery/discovery.service.ts`
- Modify: `affiliate-tool-apis/src/lib/meilisearch.ts`
- Modify: `affiliate-tool-apis/tests/discovery-date-bounds.test.ts` (optional: keep helper-only; no DB test required if helper is covered)

**Interfaces:**
- Consumes: `updatedAtBounds(from?: string, to?: string): { gte?: Date; lt?: Date }`
- Produces: `discoverySearchSchema` fields `updatedFrom?`, `updatedTo?`
- Produces: `searchDiscovery` / `MeiliDiscoverySearchParams` accept optional `updatedFrom` / `updatedTo`

- [ ] **Step 1: Extend Zod schema**

In `discovery.schemas.ts`, after `savedToCrm` (before `sortBy`), add:

```ts
  /** Inclusive lower bound on profile updatedAt (`yyyy-MM-dd`). */
  updatedFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "updatedFrom must be yyyy-MM-dd")
    .optional(),
  /** Inclusive upper bound on profile updatedAt (`yyyy-MM-dd`). */
  updatedTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "updatedTo must be yyyy-MM-dd")
    .optional(),
```

- [ ] **Step 2: Extend `searchDiscovery` params and Postgres `where`**

In `discovery.service.ts`:

1. Import: `import { updatedAtBounds } from "./discovery-date-bounds.js";`
2. Add to `searchDiscovery` params type: `updatedFrom?: string; updatedTo?: string;`
3. After building other `where` clauses (before `orderBy`), apply:

```ts
  const atBounds = updatedAtBounds(params.updatedFrom, params.updatedTo);
  if (atBounds.gte || atBounds.lt) {
    where.updatedAt = {
      ...(atBounds.gte ? { gte: atBounds.gte } : {}),
      ...(atBounds.lt ? { lt: atBounds.lt } : {}),
    };
  }
```

Note: `searchDiscoveryInMeili(params)` already receives the full params object when `savedToCrm == null` — once Meili params include the fields, no extra call-site change is needed beyond typing.

- [ ] **Step 3: Extend Meili search filters**

In `meilisearch.ts`:

1. Add to `MeiliDiscoverySearchParams`: `updatedFrom?: string; updatedTo?: string;`
2. Import: `import { updatedAtBounds } from "../modules/discovery/discovery-date-bounds.js";`
3. After the `hasEmail` filters block, before `sort`:

```ts
  const atBounds = updatedAtBounds(params.updatedFrom, params.updatedTo);
  if (atBounds.gte) filters.push(`updatedAt >= ${atBounds.gte.getTime()}`);
  if (atBounds.lt) filters.push(`updatedAt < ${atBounds.lt.getTime()}`);
```

- [ ] **Step 4: Re-run helper tests + typecheck**

Run:

```bash
cd affiliate-tool-apis
npx vitest run tests/discovery-date-bounds.test.ts
npx tsc --noEmit
```

Expected: tests PASS; `tsc` clean (or no new errors from these files)

- [ ] **Step 5: Commit (apis repo)**

```bash
cd affiliate-tool-apis
git add src/modules/discovery/discovery.schemas.ts src/modules/discovery/discovery.service.ts src/lib/meilisearch.ts
git commit -m "feat(discovery): filter search by updatedFrom/updatedTo"
```

---

### Task 3: Portal DateRangePicker + Discover wiring

**Files:**
- Modify: `affiliate-tool-portal/components/ui/date-range-picker.tsx`
- Modify: `affiliate-tool-portal/services/commerce.ts`
- Modify: `affiliate-tool-portal/hooks/use-commerce.ts`
- Modify: `affiliate-tool-portal/components/discover/discover-page-content.tsx`

**Interfaces:**
- Consumes: API query params `updatedFrom` / `updatedTo`
- Produces: `rangeFromMonthToDate(): DateRangeValue`
- Produces: Discover search passes `updatedFrom` / `updatedTo` from picker state

- [ ] **Step 1: Add `rangeFromMonthToDate` helper**

In `date-range-picker.tsx`, next to `rangeFromDays`, add:

```ts
import { format, isValid, parse, startOfMonth, subDays } from "date-fns";

export function rangeFromMonthToDate(): DateRangeValue {
  const to = new Date();
  return { from: toIso(startOfMonth(to)), to: toIso(to) };
}
```

(Ensure `startOfMonth` is added to the existing `date-fns` import; keep `toIso` as the file’s private helper.)

- [ ] **Step 2: Thread params through service + hook**

In `services/commerce.ts` `searchDiscovery` params type, add:

```ts
    updatedFrom?: string;
    updatedTo?: string;
```

In `hooks/use-commerce.ts` `useDiscoverySearch` params type, add the same two optional fields. Existing `queryKey: ["discovery", params]` and spread into `searchDiscovery` already pick them up — no other hook logic required.

- [ ] **Step 3: Wire Discover page UI**

In `discover-page-content.tsx`:

1. Imports:

```ts
import {
  DateRangePicker,
  rangeFromMonthToDate,
  type DateRangeValue,
} from "@/components/ui/date-range-picker";
```

2. State (near other filters):

```ts
  const [dateRange, setDateRange] = useState<DateRangeValue>(() =>
    rangeFromMonthToDate(),
  );
```

3. Include `dateRange.from` and `dateRange.to` in `filtersSignature` (so page resets to 1 when range changes).

4. Pass into `useDiscoverySearch`:

```ts
    updatedFrom: dateRange.from || undefined,
    updatedTo: dateRange.to || undefined,
```

5. Place the picker **above** the Filters `SectionCard` (dedicated row), e.g. immediately before that card:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Updated</p>
        <DateRangePicker
          value={dateRange}
          onChange={setDateRange}
          defaultValue={rangeFromMonthToDate()}
        />
      </div>
```

Alternatively put `DateRangePicker` in the Filters `SectionCard` `actions` prop if that component supports header actions — prefer a dedicated row above Filters so it stays visually separate from the FormGrid (per spec).

- [ ] **Step 4: Typecheck portal**

Run: `cd affiliate-tool-portal && npm run typecheck`

Expected: exit 0

- [ ] **Step 5: Manual smoke (brief)**

1. Open Discover — picker shows month-start → today (custom label, not “Last 30 days”).
2. Change range / Apply — table refetches; page resets if needed.
3. Choose “All time” — request omits `updatedFrom`/`updatedTo` (or empty skipped by `URLSearchParams` loop).
4. Reset — restores month-to-date.

- [ ] **Step 6: Commit (portal repo)**

```bash
cd affiliate-tool-portal
git add components/ui/date-range-picker.tsx services/commerce.ts hooks/use-commerce.ts components/discover/discover-page-content.tsx
git commit -m "feat(discover): month-to-date updatedAt date range picker"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Filter by `updatedAt` | Task 2 |
| Default month start → today | Task 3 (`rangeFromMonthToDate`) |
| Dedicated picker (not FormGrid mix) | Task 3 |
| Reset → month-to-date | Task 3 `defaultValue` |
| All time omits bounds | Task 2 + Task 3 empty strings skipped |
| Inclusive day semantics | Task 1 + Task 2 |
| Postgres path | Task 2 |
| Meili path | Task 2 |
| Portal search wiring | Task 3 |
| Helper unit tests | Task 1 |
