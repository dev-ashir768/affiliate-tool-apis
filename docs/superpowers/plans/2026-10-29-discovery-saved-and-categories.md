# Discovery Saved Flag + Category Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show human-readable marketplace category names on Discover, and permanently show **Saved** when a profile’s handle already exists in the org CRM.

**Architecture:** Keep raw TikTok category IDs in Postgres. Map IDs→names in `toProfile` via a static lookup module. Pass `organizationId` into merchant `searchDiscovery`, batch-lookup matching `Creator` handles, and attach `savedToCrm` on each row. Portal disables the Save button when `savedToCrm` is true and invalidates discovery queries after save.

**Tech Stack:** Express + Prisma + Vitest (apis); Next.js + React Query + TanStack Table (portal)

**Spec:** `docs/superpowers/specs/2026-10-29-discovery-saved-and-categories-design.md`

## Global Constraints

- Dual repos: commit API work in `affiliate-tool-apis`, portal work in `affiliate-tool-portal`
- DB `CreatorDiscoveryProfile.categories` stays raw TikTok IDs — map only at response time
- Match CRM with `organizationId + platform: TIKTOK + handle` (same as `Creator` unique + save path)
- Unknown category IDs pass through unchanged
- Platform discovery search may omit org → `savedToCrm: false` for all rows
- Do not add un-save / remove-from-CRM from Discover

## File map

| File | Responsibility |
|------|----------------|
| `affiliate-tool-apis/src/modules/discovery/marketplace-categories.ts` | Static ID→name map + `formatMarketplaceCategories` |
| `affiliate-tool-apis/tests/marketplace-categories.test.ts` | Unit tests for mapping |
| `affiliate-tool-apis/src/modules/discovery/discovery.service.ts` | Map categories in `toProfile`; enrich search with `savedToCrm` |
| `affiliate-tool-apis/src/modules/discovery/discovery.routes.ts` | Pass `organizationId` on merchant `/creators` search |
| `affiliate-tool-apis/tests/discovery-saved-flag.test.ts` | Unit test for CRM handle set enrichment helper |
| `affiliate-tool-portal/types/commerce.ts` | `savedToCrm?: boolean` on `DiscoveryProfile` |
| `affiliate-tool-portal/components/discover/discover-columns.tsx` | Save vs Saved button |
| `affiliate-tool-portal/hooks/use-commerce.ts` | Invalidate `["discovery"]` on save success |

---

### Task 1: Marketplace category map (API)

**Files:**
- Create: `affiliate-tool-apis/src/modules/discovery/marketplace-categories.ts`
- Create: `affiliate-tool-apis/tests/marketplace-categories.test.ts`

**Interfaces:**
- Produces: `formatMarketplaceCategories(ids: string[]): string[]`
- Produces: `MARKETPLACE_CATEGORY_NAMES: Readonly<Record<string, string>>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { formatMarketplaceCategories } from "../src/modules/discovery/marketplace-categories.js";

describe("formatMarketplaceCategories", () => {
  it("maps known TikTok marketplace ids to names", () => {
    expect(
      formatMarketplaceCategories(["604453", "602118", "600001"]),
    ).toEqual(["Furniture", "Pet Supplies", "Home Supplies"]);
  });

  it("passes through unknown ids unchanged", () => {
    expect(formatMarketplaceCategories(["999999", "604453"])).toEqual([
      "999999",
      "Furniture",
    ]);
  });

  it("returns empty for empty input", () => {
    expect(formatMarketplaceCategories([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd affiliate-tool-apis && npx vitest run tests/marketplace-categories.test.ts`

Expected: FAIL (module not found / export missing)

- [ ] **Step 3: Implement the map module**

Create `src/modules/discovery/marketplace-categories.ts` with the full marketplace set (at minimum include the IDs below; prefer the complete published list):

```ts
/** TikTok Shop Creator Marketplace niche category ids → display names. */
export const MARKETPLACE_CATEGORY_NAMES: Readonly<Record<string, string>> = {
  "605196": "Automotive & Motorcycle",
  "602284": "Baby & Maternity",
  "601450": "Beauty & Personal Care",
  "801928": "Books, Magazines & Audio",
  "951432": "Collectibles",
  "601755": "Computers & Office Equipment",
  "605248": "Fashion Accessories",
  "700437": "Food & Beverages",
  "604453": "Furniture",
  "700645": "Health",
  "604968": "Home Improvement",
  "600001": "Home Supplies",
  "600942": "Household Appliances",
  "953224": "Jewelry Accessories & Derivatives",
  "802184": "Kids' Fashion",
  "600024": "Kitchenware",
  "824584": "Luggage & Bags",
  "824328": "Menswear & Underwear",
  "602118": "Pet Supplies",
  "601739": "Phones & Electronics",
  "856720": "Pre-Owned",
  "601352": "Shoes",
  "603014": "Sports & Outdoor",
  "600154": "Textiles & Soft Furnishings",
  "604579": "Tools & Hardware",
  "604206": "Toys & Hobbies",
  "601152": "Womenswear & Underwear",
};

export function formatMarketplaceCategories(ids: string[]): string[] {
  return ids.map((id) => MARKETPLACE_CATEGORY_NAMES[id] ?? id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd affiliate-tool-apis && npx vitest run tests/marketplace-categories.test.ts`

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd affiliate-tool-apis
git add src/modules/discovery/marketplace-categories.ts tests/marketplace-categories.test.ts
git commit -m "feat(discovery): map marketplace category ids to display names"
```

---

### Task 2: Wire category names + savedToCrm into discovery search (API)

**Files:**
- Modify: `affiliate-tool-apis/src/modules/discovery/discovery.service.ts`
- Modify: `affiliate-tool-apis/src/modules/discovery/discovery.routes.ts`
- Create: `affiliate-tool-apis/tests/discovery-saved-flag.test.ts`

**Interfaces:**
- Consumes: `formatMarketplaceCategories` from Task 1
- Produces: `toProfile` returns `categories` as display names
- Produces: `searchDiscovery(params & { organizationId?: string })` returns `savedToCrm: boolean` per row
- Produces: `markSavedToCrm(profiles, savedHandles: Set<string>)` helper (exported for unit test) OR inline enrichment tested via helper

- [ ] **Step 1: Write failing tests for saved-handle enrichment**

```ts
import { describe, expect, it } from "vitest";
import { attachSavedToCrm } from "../src/modules/discovery/discovery.service.js";

describe("attachSavedToCrm", () => {
  it("flags profiles whose handle is in the CRM set", () => {
    const rows = [
      { handle: "alpha", id: "1" },
      { handle: "beta", id: "2" },
    ];
    const out = attachSavedToCrm(rows, new Set(["alpha"]));
    expect(out[0].savedToCrm).toBe(true);
    expect(out[1].savedToCrm).toBe(false);
  });

  it("treats empty CRM set as all unsaved", () => {
    const out = attachSavedToCrm([{ handle: "x", id: "1" }], new Set());
    expect(out[0].savedToCrm).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd affiliate-tool-apis && npx vitest run tests/discovery-saved-flag.test.ts`

Expected: FAIL (`attachSavedToCrm` not exported)

- [ ] **Step 3: Implement helper + `toProfile` category mapping + search enrichment**

In `discovery.service.ts`:

1. Import `formatMarketplaceCategories`.
2. Change `categories: row.categories` in `toProfile` to:

```ts
categories: formatMarketplaceCategories(row.categories ?? []),
```

3. Add and export:

```ts
export function attachSavedToCrm<T extends { handle: string }>(
  profiles: T[],
  savedHandles: Set<string>,
): Array<T & { savedToCrm: boolean }> {
  return profiles.map((p) => ({
    ...p,
    savedToCrm: savedHandles.has(p.handle),
  }));
}
```

4. Extend `searchDiscovery` params with optional `organizationId?: string`.

5. After building the `data` array via `rows.map(toProfile)` (both Meili and Postgres paths), if `organizationId` is set and there are profiles:

```ts
const handles = [...new Set(data.map((p) => p.handle))];
const saved = handles.length
  ? await prisma.creator.findMany({
      where: {
        organizationId,
        platform: "TIKTOK",
        handle: { in: handles },
      },
      select: { handle: true },
    })
  : [];
const savedHandles = new Set(saved.map((c) => c.handle));
return {
  data: attachSavedToCrm(data, savedHandles),
  meta: { ... },
};
```

If no `organizationId`, still attach `savedToCrm: false` via `attachSavedToCrm(data, new Set())` so the field is always present for the portal.

Apply the same enrichment on **both** early Meili empty-data return (`data: []` → fine) and both success paths.

- [ ] **Step 4: Pass org id from merchant route**

In `discovery.routes.ts` merchant `GET /creators`:

```ts
if (!req.auth?.orgId) {
  throw new AppError("UNAUTHORIZED", "Missing org", 401);
}
res.json(
  await searchDiscovery({
    ...(req.query as any),
    organizationId: req.auth.orgId,
  }),
);
```

Leave platform `searchDiscovery({ ...enabledOnly: false })` without `organizationId` (all `savedToCrm: false`).

- [ ] **Step 5: Run tests**

Run:

```bash
cd affiliate-tool-apis
npx vitest run tests/marketplace-categories.test.ts tests/discovery-saved-flag.test.ts
npx tsc -p tsconfig.json --noEmit
```

Expected: tests PASS; typecheck exit 0

- [ ] **Step 6: Commit**

```bash
cd affiliate-tool-apis
git add src/modules/discovery/discovery.service.ts src/modules/discovery/discovery.routes.ts tests/discovery-saved-flag.test.ts
git commit -m "feat(discovery): enrich search with savedToCrm and category names"
```

---

### Task 3: Portal Saved button + types

**Files:**
- Modify: `affiliate-tool-portal/types/commerce.ts`
- Modify: `affiliate-tool-portal/components/discover/discover-columns.tsx`
- Modify: `affiliate-tool-portal/hooks/use-commerce.ts`

**Interfaces:**
- Consumes: API `savedToCrm: boolean` on each `DiscoveryProfile`
- Produces: UI shows disabled **Saved** when true; invalidates discovery after save

- [ ] **Step 1: Extend `DiscoveryProfile`**

In `types/commerce.ts` add:

```ts
  /** True when this handle already exists in the org CRM. */
  savedToCrm?: boolean;
```

- [ ] **Step 2: Update actions column**

In `discover-columns.tsx` actions cell:

```tsx
const row = info.row.original;
const saving = actions.savingId === row.id;
const saved = Boolean(row.savedToCrm);
return (
  <div className="text-right">
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={saving || saved}
      onClick={() => {
        if (!saved) actions.onSave(row.id);
      }}
    >
      {saving ? "Saving…" : saved ? "Saved" : "Save"}
    </Button>
  </div>
);
```

- [ ] **Step 3: Invalidate discovery on save**

In `useSaveDiscoveryToCrm`:

```ts
onSuccess: () => {
  void qc.invalidateQueries({ queryKey: ["creators"] });
  void qc.invalidateQueries({ queryKey: ["discovery"] });
},
```

- [ ] **Step 4: Verify portal typecheck / lint on touched files**

Run:

```bash
cd affiliate-tool-portal
npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0 (or only pre-existing unrelated errors — fix any introduced by this task)

- [ ] **Step 5: Commit**

```bash
cd affiliate-tool-portal
git add types/commerce.ts components/discover/discover-columns.tsx hooks/use-commerce.ts
git commit -m "feat(discover): show Saved for CRM creators"
```

---

### Task 4: Manual smoke + push (optional handoff)

**Files:** none (verification)

- [ ] **Step 1: Smoke checklist**

1. Open Discover as an org member with a TikTok-synced index.
2. Confirm Categories show names (e.g. Furniture / Pet Supplies / Home Supplies), not bare ids for known codes.
3. Save a creator → button becomes **Saved** after refetch; toast still works.
4. Reload page → same row still **Saved**.
5. Platform discovery admin (if used) still lists creators; Save column N/A or all unsaved is fine.

- [ ] **Step 2: Push both repos when user requests**

```bash
cd affiliate-tool-apis && git push origin main
cd affiliate-tool-portal && git push origin main
```

Only when explicitly asked.

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| `savedToCrm` via CRM handle lookup | Task 2 |
| Permanent Saved after reload | Task 2 + 3 |
| Static category ID→name map | Task 1 |
| Map at `toProfile` / response | Task 2 |
| Unknown id passthrough | Task 1 |
| Portal Saved disabled button | Task 3 |
| Invalidate after save | Task 3 |
| Platform search without org | Task 2 (no organizationId) |
| IDs remain in DB | Task 1–2 (no write of names) |
