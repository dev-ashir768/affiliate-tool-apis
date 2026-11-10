# Shop Open-Collab Creators Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync open-collaboration product creators from an OAuth-connected TikTok Shop into org CRM (`Creator` upsert + **Shop collaborators** list), triggered on OAuth connect and via a manual button, as a background BullMQ job.

**Architecture:** Add TikTok Open Collab client helpers → pure mapper → `open-collab-creators-sync.service` that pages Search Open Collaborations + creator_content_details, upserts CRM, ensures list membership, writes status JSON on `Shop`. Dedicated Bull queue + worker. Merchant routes enqueue/status; OAuth complete best-effort enqueues. Portal BFF + Shops UI button/summary.

**Tech Stack:** Express + Zod + Prisma + BullMQ + Vitest (apis); Next.js + React Query (portal)

**Spec:** `docs/superpowers/specs/2026-11-10-shop-open-collab-creators-sync-design.md`

## Global Constraints

- Dual repos: commit API work in `affiliate-tool-apis`, portal work in `affiliate-tool-portal`
- Product scope: **open collaboration products only** (not full catalog)
- Destination: CRM upsert + list name exactly **`Shop collaborators`**
- New creators: `stage = ACTIVE`; never overwrite existing `stage` / `notes` / `contactEmail`
- Caps: max **500** open-collab products / run; max **10_000** unique creators / run → status `PARTIAL`
- One concurrent job per shop (stable Bull jobId)
- Scope: `seller.affiliate_collaboration.read` (not marketplace)
- Agency Manage Partnerships / internal `relation/list` is **out of scope**
- Reuse `tikTokFetch` pacing in `client.ts`
- YAGNI: no per-shop lists, no Meili indexing for this sync

## File map

| File | Responsibility |
|------|----------------|
| `affiliate-tool-apis/src/lib/tiktok-shop/client.ts` | Paths + `searchOpenCollaborations` + `getOpenCollabCreatorContentDetails` |
| `affiliate-tool-apis/src/modules/shops/open-collab-creator-map.ts` | Normalize TikTok creator row → CRM upsert input |
| `affiliate-tool-apis/tests/shops/open-collab-creator-map.test.ts` | Mapper unit tests |
| `affiliate-tool-apis/src/modules/shops/open-collab-creators-sync.service.ts` | Enqueue, run sync, status read/write |
| `affiliate-tool-apis/tests/shops/open-collab-creators-sync.test.ts` | Service tests with mocked TikTok + prisma |
| `affiliate-tool-apis/prisma/schema.prisma` | `Shop.openCollabCreatorsSync Json?` |
| `affiliate-tool-apis/src/lib/queue.ts` | `SHOP_OPEN_COLLAB_CREATORS_QUEUE` |
| `affiliate-tool-apis/src/workers/shop-open-collab-creators.processor.ts` | Worker |
| `affiliate-tool-apis/src/worker.ts` / `server.ts` | Start/close queue |
| `affiliate-tool-apis/src/modules/shops/shops.routes.ts` | POST/GET sync endpoints |
| `affiliate-tool-apis/src/modules/shops/tiktok-oauth.service.ts` | Best-effort enqueue after OAuth |
| `affiliate-tool-apis/src/modules/shops/shops.service.ts` | Include sync status in shop DTO if needed |
| `affiliate-tool-portal/app/api/shops/[id]/sync-open-collab-creators/route.ts` | BFF POST |
| `affiliate-tool-portal/app/api/shops/[id]/sync-open-collab-creators/status/route.ts` | BFF GET |
| `affiliate-tool-portal/services/shops.ts` + `hooks/use-shops.ts` | Client + hooks |
| `affiliate-tool-portal/components/shops/shops-table.tsx` (+ page if needed) | Sync button + summary |
| `affiliate-tool-portal/types/shops.ts` | Types for sync status |

---

### Task 1: TikTok client — open collab search + creator content details

**Files:**
- Modify: `affiliate-tool-apis/src/lib/tiktok-shop/client.ts`

**Interfaces:**
- Produces:
  - `OPEN_COLLAB_SEARCH_PATH = "/affiliate_seller/202508/open_collaborations/search"`
  - `OPEN_COLLAB_CREATOR_CONTENT_PATH = "/affiliate_seller/202508/open_collaborations/creator_content_details"`
  - `searchOpenCollaborations(input): Promise<{ items: Array<{ id: string; productId: string }>; nextPageToken: string | null; totalCount: number | null }>`
  - `getOpenCollabCreatorContentDetails(input): Promise<{ creators: Array<Record<string, unknown>>; nextPageToken: string | null; totalCount: number | null }>`
- Consumes: existing `tikTokFetch`, `TikTokShopCredentials`

- [ ] **Step 1: Add path constants** (near other affiliate_seller paths)

```ts
/**
 * Search Open Collaborations (seller).
 * @see https://partner.tiktokshop.com/docv2/page/search-open-collaborations-202508
 * Scope: seller.affiliate_collaboration.read
 */
export const OPEN_COLLAB_SEARCH_PATH =
  "/affiliate_seller/202508/open_collaborations/search";

/**
 * Get Open Collaboration Creator Content Details.
 * @see https://partner.tiktokshop.com/docv2/page/get-open-collaboration-creator-content-details-202508
 * Scope: seller.affiliate_collaboration.read
 */
export const OPEN_COLLAB_CREATOR_CONTENT_PATH =
  "/affiliate_seller/202508/open_collaborations/creator_content_details";
```

If Partner Center documents `202412` for search instead of `202508`, use the version on the live doc page at implement time (prefer the path that View app categories shows for US seller affiliate).

- [ ] **Step 2: Implement `searchOpenCollaborations`**

```ts
export async function searchOpenCollaborations(input: {
  credentials: TikTokShopCredentials;
  pageSize?: number;
  pageToken?: string | null;
}): Promise<{
  items: Array<{ id: string; productId: string }>;
  nextPageToken: string | null;
  totalCount: number | null;
}> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
  const query: Record<string, string> = { page_size: String(pageSize) };
  if (input.pageToken) query.page_token = input.pageToken;

  const data = await tikTokFetch<{
    open_collaborations?: Array<Record<string, unknown>>;
    next_page_token?: string;
    total_count?: number;
  }>(OPEN_COLLAB_SEARCH_PATH, {
    method: "POST",
    query,
    body: {},
    credentials: input.credentials,
  });

  const items = (data?.open_collaborations ?? [])
    .map((row) => {
      const id = row.id != null ? String(row.id) : "";
      const product =
        row.product && typeof row.product === "object"
          ? (row.product as Record<string, unknown>)
          : null;
      const productId =
        product?.id != null
          ? String(product.id)
          : row.product_id != null
            ? String(row.product_id)
            : "";
      if (!productId) return null;
      return { id: id || productId, productId };
    })
    .filter((x): x is { id: string; productId: string } => Boolean(x));

  return {
    items,
    nextPageToken: data?.next_page_token || null,
    totalCount:
      typeof data?.total_count === "number" ? data.total_count : null,
  };
}
```

- [ ] **Step 3: Implement `getOpenCollabCreatorContentDetails`**

```ts
export async function getOpenCollabCreatorContentDetails(input: {
  credentials: TikTokShopCredentials;
  productId: string;
  pageSize?: number;
  pageToken?: string | null;
}): Promise<{
  creators: Array<Record<string, unknown>>;
  nextPageToken: string | null;
  totalCount: number | null;
}> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 100, 1), 100);
  const query: Record<string, string> = {
    page_size: String(pageSize),
    product_id: input.productId,
  };
  if (input.pageToken) query.page_token = input.pageToken;

  const data = await tikTokFetch<{
    creator_content_details?: Array<Record<string, unknown>>;
    next_page_token?: string;
    total_count?: number;
  }>(OPEN_COLLAB_CREATOR_CONTENT_PATH, {
    method: "GET",
    query,
    credentials: input.credentials,
  });

  return {
    creators: data?.creator_content_details ?? [],
    nextPageToken: data?.next_page_token || null,
    totalCount:
      typeof data?.total_count === "number" ? data.total_count : null,
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `cd affiliate-tool-apis && npx tsc --noEmit`

Expected: PASS (or only pre-existing errors unrelated to these exports)

- [ ] **Step 5: Commit**

```bash
cd affiliate-tool-apis
git add src/lib/tiktok-shop/client.ts
git commit -m "$(cat <<'EOF'
feat(tiktok-shop): add open collaboration creator list client helpers

EOF
)"
```

---

### Task 2: Mapper for open-collab creator → CRM input

**Files:**
- Create: `affiliate-tool-apis/src/modules/shops/open-collab-creator-map.ts`
- Create: `affiliate-tool-apis/tests/shops/open-collab-creator-map.test.ts`

**Interfaces:**
- Produces: `mapOpenCollabCreator(raw: Record<string, unknown>): { handle: string; displayName: string | null; creatorOpenId: string | null; followerCount: number | null; avatarUrl: string | null } | null`
- Consumes: none

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { mapOpenCollabCreator } from "../../src/modules/shops/open-collab-creator-map.js";

describe("mapOpenCollabCreator", () => {
  it("maps nested creator_profile fields", () => {
    const mapped = mapOpenCollabCreator({
      creator_open_id: "oid-1",
      creator_profile: {
        username: "@CoolCreator",
        nickname: "Cool",
        follower_count: 1234,
        avatar: { url: "https://cdn.example/a.jpg" },
      },
    });
    expect(mapped).toEqual({
      handle: "CoolCreator",
      displayName: "Cool",
      creatorOpenId: "oid-1",
      followerCount: 1234,
      avatarUrl: "https://cdn.example/a.jpg",
    });
  });

  it("returns null when username missing", () => {
    expect(
      mapOpenCollabCreator({
        creator_open_id: "oid-2",
        creator_profile: { nickname: "x" },
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd affiliate-tool-apis && npx vitest run tests/shops/open-collab-creator-map.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement mapper**

```ts
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function mapOpenCollabCreator(raw: Record<string, unknown>): {
  handle: string;
  displayName: string | null;
  creatorOpenId: string | null;
  followerCount: number | null;
  avatarUrl: string | null;
} | null {
  const profile = asRecord(raw.creator_profile) ?? raw;
  const usernameRaw =
    profile.username ?? profile.user_name ?? raw.username ?? raw.user_name;
  if (usernameRaw == null || String(usernameRaw).trim() === "") return null;
  const handle = String(usernameRaw).replace(/^@/, "").trim();
  if (!handle) return null;

  const nickname = profile.nickname ?? profile.nick_name ?? null;
  const openId =
    raw.creator_open_id ??
    profile.creator_open_id ??
    raw.creator_user_open_id ??
    null;
  const followers = profile.follower_count ?? profile.fans_cnt ?? null;
  const avatar = asRecord(profile.avatar);
  const avatarUrl =
    (avatar?.url != null ? String(avatar.url) : null) ??
    (profile.image_url != null ? String(profile.image_url) : null);

  return {
    handle,
    displayName: nickname != null ? String(nickname) : null,
    creatorOpenId: openId != null ? String(openId) : null,
    followerCount:
      typeof followers === "number"
        ? followers
        : followers != null && String(followers).trim() !== ""
          ? Number(followers)
          : null,
    avatarUrl,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd affiliate-tool-apis && npx vitest run tests/shops/open-collab-creator-map.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd affiliate-tool-apis
git add src/modules/shops/open-collab-creator-map.ts tests/shops/open-collab-creator-map.test.ts
git commit -m "$(cat <<'EOF'
feat(shops): map open-collab creator payloads to CRM fields

EOF
)"
```

---

### Task 3: Sync service + Shop status JSON + unit tests

**Files:**
- Modify: `affiliate-tool-apis/prisma/schema.prisma` (`Shop` model)
- Create: `affiliate-tool-apis/src/modules/shops/open-collab-creators-sync.service.ts`
- Create: `affiliate-tool-apis/tests/shops/open-collab-creators-sync.test.ts`

**Interfaces:**
- Produces:
  - `SHOP_COLLABORATORS_LIST_NAME = "Shop collaborators"`
  - `MAX_OPEN_COLLAB_PRODUCTS = 500`
  - `MAX_UNIQUE_CREATORS = 10_000`
  - `OpenCollabCreatorsSyncStatus` type
  - `enqueueOpenCollabCreatorsSync(organizationId, shopId, triggeredBy?): Promise<{ jobId: string; status: "QUEUED" | "RUNNING"; shopId: string }>`
  - `getOpenCollabCreatorsSyncStatus(organizationId, shopId): Promise<OpenCollabCreatorsSyncStatus | null>`
  - `runOpenCollabCreatorsSync(job: { organizationId: string; shopId: string }): Promise<OpenCollabCreatorsSyncStatus>`
- Consumes: `getShopOpenApiCredentials`, `searchOpenCollaborations`, `getOpenCollabCreatorContentDetails`, `mapOpenCollabCreator`, prisma, queue (enqueue wired in Task 4 — for Task 3 stub enqueue or implement run first and enqueue in Task 4)

Implement **`runOpenCollabCreatorsSync` + status helpers** in this task; wire Bull enqueue in Task 4 (export a `persistSyncStatus` used by both).

- [ ] **Step 1: Add Prisma field**

On `model Shop` add:

```prisma
  /// Last open-collab → CRM creators sync summary (JSON).
  openCollabCreatorsSync Json?
```

Run: `cd affiliate-tool-apis && npx prisma migrate dev --name shop_open_collab_creators_sync`

- [ ] **Step 2: Write failing service test** (mock prisma + TikTok client modules)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    shop: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    creator: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    creatorList: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    creatorListMember: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../../src/modules/shops/tiktok-oauth.service.js", () => ({
  getShopOpenApiCredentials: vi.fn(),
}));

vi.mock("../../src/lib/tiktok-shop/client.js", () => ({
  searchOpenCollaborations: vi.fn(),
  getOpenCollabCreatorContentDetails: vi.fn(),
}));

import { prisma } from "../../src/lib/prisma.js";
import { getShopOpenApiCredentials } from "../../src/modules/shops/tiktok-oauth.service.js";
import {
  searchOpenCollaborations,
  getOpenCollabCreatorContentDetails,
} from "../../src/lib/tiktok-shop/client.js";
import { runOpenCollabCreatorsSync } from "../../src/modules/shops/open-collab-creators-sync.service.js";

describe("runOpenCollabCreatorsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.shop.findFirst).mockResolvedValue({
      id: "shop1",
      organizationId: "org1",
      oauthConnectedAt: new Date(),
      status: "ACTIVE",
    } as never);
    vi.mocked(getShopOpenApiCredentials).mockResolvedValue({
      appKey: "k",
      appSecret: "s",
      accessToken: "t",
      shopCipher: "c",
    });
    vi.mocked(searchOpenCollaborations).mockResolvedValue({
      items: [{ id: "oc1", productId: "p1" }],
      nextPageToken: null,
      totalCount: 1,
    });
    vi.mocked(getOpenCollabCreatorContentDetails).mockResolvedValue({
      creators: [
        {
          creator_open_id: "oid-1",
          creator_profile: {
            username: "alice",
            nickname: "Alice",
            follower_count: 10,
          },
        },
      ],
      nextPageToken: null,
      totalCount: 1,
    });
    vi.mocked(prisma.creator.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.creator.create).mockResolvedValue({
      id: "cr1",
      handle: "alice",
    } as never);
    vi.mocked(prisma.creatorList.findUnique).mockResolvedValue({
      id: "list1",
      name: "Shop collaborators",
    } as never);
    vi.mocked(prisma.creatorListMember.create).mockResolvedValue({} as never);
    vi.mocked(prisma.shop.update).mockResolvedValue({} as never);
  });

  it("upserts creator and adds to Shop collaborators list", async () => {
    const result = await runOpenCollabCreatorsSync({
      organizationId: "org1",
      shopId: "shop1",
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.productsScanned).toBe(1);
    expect(result.creatorsUpserted).toBe(1);
    expect(prisma.creator.create).toHaveBeenCalled();
    expect(prisma.creatorListMember.create).toHaveBeenCalled();
  });
});
```

Adjust mocks to match real prisma call shapes used in the service (`findUnique` on `organizationId_platform_handle`, etc.).

- [ ] **Step 3: Run test — expect FAIL**

Run: `cd affiliate-tool-apis && npx vitest run tests/shops/open-collab-creators-sync.test.ts`

- [ ] **Step 4: Implement `open-collab-creators-sync.service.ts`**

Core algorithm:

1. Load shop; require `oauthConnectedAt`; else throw `SHOP_NOT_READY`.
2. Write status `{ status: "RUNNING", ...zeros, updatedAt }`.
3. Page `searchOpenCollaborations` until no token or product cap.
4. For each unique `productId` (cap 500): page `getOpenCollabCreatorContentDetails`; on error increment `failedProducts` and continue.
5. Map each creator; dedupe Map keyed by `creatorOpenId ?? handle.toLowerCase()`.
6. Stop accepting new unique creators after 10_000.
7. For each mapped creator:
   - `findUnique` `organizationId_platform_handle`
   - if missing: `create` with `stage: ACTIVE` + fields
   - if present: `update` only `displayName`/`followerCount`/`avatarUrl`/`creatorOpenId` when new values non-null (do **not** touch `stage`)
8. Ensure list: `findUnique` `organizationId_name` for `"Shop collaborators"`; create if missing.
9. `creatorListMember.create` ignore P2002.
10. Final status `SUCCEEDED` if `failedProducts === 0` and caps not hit; else `PARTIAL` if caps/failures; persist via `shop.update({ openCollabCreatorsSync: status })`.

Export type:

```ts
export type OpenCollabCreatorsSyncStatus = {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  jobId?: string | null;
  productsScanned: number;
  creatorsUpserted: number;
  creatorsLinkedToList: number;
  failedProducts: number;
  lastError?: string | null;
  updatedAt: string;
};
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd affiliate-tool-apis && npx vitest run tests/shops/open-collab-creators-sync.test.ts`

- [ ] **Step 6: Commit**

```bash
cd affiliate-tool-apis
git add prisma/schema.prisma prisma/migrations src/modules/shops/open-collab-creators-sync.service.ts tests/shops/open-collab-creators-sync.test.ts
git commit -m "$(cat <<'EOF'
feat(shops): sync open-collab creators into CRM and Shop collaborators list

EOF
)"
```

---

### Task 4: Bull queue + worker + enqueue API wiring

**Files:**
- Modify: `affiliate-tool-apis/src/lib/queue.ts`
- Create: `affiliate-tool-apis/src/workers/shop-open-collab-creators.processor.ts`
- Modify: `affiliate-tool-apis/src/worker.ts`
- Modify: `affiliate-tool-apis/src/server.ts` (close queue on shutdown)
- Modify: `affiliate-tool-apis/src/modules/shops/open-collab-creators-sync.service.ts` (`enqueueOpenCollabCreatorsSync`)

**Interfaces:**
- Produces: `SHOP_OPEN_COLLAB_CREATORS_QUEUE = "shop-open-collab-creators"`; `enqueueOpenCollabCreatorsSync`
- Consumes: `runOpenCollabCreatorsSync`

- [ ] **Step 1: Add queue** in `queue.ts` (mirror discovery sync: RETENTION + SAFE_RETRY)

```ts
export const SHOP_OPEN_COLLAB_CREATORS_QUEUE = "shop-open-collab-creators";
// getShopOpenCollabCreatorsQueue + shopOpenCollabCreatorsQueue.add/close
```

- [ ] **Step 2: Implement enqueue with jobId `shop-open-collab-creators-${shopId}`** (no `:` — BullMQ 6)

```ts
export async function enqueueOpenCollabCreatorsSync(
  organizationId: string,
  shopId: string,
  triggeredBy?: string,
) {
  // verify shop ownership + oauthConnectedAt
  const jobId = `shop-open-collab-creators-${shopId}`;
  const existing = await getShopOpenCollabCreatorsQueue().getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed") {
      return { jobId, status: state === "active" ? "RUNNING" : "QUEUED", shopId };
    }
  }
  await shopOpenCollabCreatorsQueue.add(
    "sync",
    { organizationId, shopId, triggeredBy, requestedAt: new Date().toISOString() },
    { jobId, removeOnComplete: 50, removeOnFail: 50, attempts: 2, backoff: { type: "exponential", delay: 5_000 } },
  );
  await persist queued status on shop (status QUEUED, jobId, updatedAt)
  return { jobId, status: "QUEUED", shopId };
}
```

- [ ] **Step 3: Worker processor**

```ts
// process: call runOpenCollabCreatorsSync; on throw persist FAILED status then rethrow
export function startShopOpenCollabCreatorsWorker() { ... }
```

Register in `worker.ts` alongside discovery worker; close queue in shutdown hooks.

- [ ] **Step 4: Smoke** — start worker locally optional; at minimum `tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
cd affiliate-tool-apis
git add src/lib/queue.ts src/workers/shop-open-collab-creators.processor.ts src/worker.ts src/server.ts src/modules/shops/open-collab-creators-sync.service.ts
git commit -m "$(cat <<'EOF'
feat(shops): queue open-collab creators sync jobs

EOF
)"
```

---

### Task 5: HTTP routes + OAuth auto-enqueue

**Files:**
- Modify: `affiliate-tool-apis/src/modules/shops/shops.routes.ts`
- Modify: `affiliate-tool-apis/src/modules/shops/tiktok-oauth.service.ts`
- Modify: `affiliate-tool-apis/src/modules/shops/shops.service.ts` (expose sync summary on shop list/get if cheap)

**Interfaces:**
- Produces:
  - `POST /api/v1/shops/:shopId/sync-open-collab-creators` → 202 + enqueue result
  - `GET /api/v1/shops/:shopId/sync-open-collab-creators/status` → status JSON or 404 null body `{ status: null }`

- [ ] **Step 1: Add routes** (after existing shopId routes; `requireRole` OWNER/ADMIN for POST like other mutating shop actions)

```ts
shopsRoutes.post(
  "/:shopId/sync-open-collab-creators",
  requireRole("OWNER", "ADMIN"),
  async (req, res) => {
    const result = await enqueueOpenCollabCreatorsSync(
      orgOf(req),
      String(req.params.shopId),
      req.auth?.sub,
    );
    res.status(202).json(result);
  },
);

shopsRoutes.get(
  "/:shopId/sync-open-collab-creators/status",
  async (req, res) => {
    const status = await getOpenCollabCreatorsSyncStatus(
      orgOf(req),
      String(req.params.shopId),
    );
    res.json({ status });
  },
);
```

- [ ] **Step 2: OAuth hook** — after successful `prisma.shop.update` + audit in `completeTikTokShopOAuth`, best-effort:

```ts
try {
  await enqueueOpenCollabCreatorsSync(parsed.orgId, shop.id, parsed.userId);
} catch (err) {
  logger.warn("open-collab creators sync enqueue after oauth failed", {
    shopId: shop.id,
    err: err instanceof Error ? err.message : String(err),
  });
}
```

Do **not** fail OAuth if enqueue fails.

- [ ] **Step 3: Optional** — include `openCollabCreatorsSync` on `toShopDto` so Shops table can show last summary without extra poll (still keep status GET for live RUNNING).

- [ ] **Step 4: Commit**

```bash
cd affiliate-tool-apis
git add src/modules/shops/shops.routes.ts src/modules/shops/tiktok-oauth.service.ts src/modules/shops/shops.service.ts
git commit -m "$(cat <<'EOF'
feat(shops): expose open-collab creators sync endpoints and oauth trigger

EOF
)"
```

---

### Task 6: Portal BFF + Shops UI

**Files:**
- Create: `affiliate-tool-portal/app/api/shops/[id]/sync-open-collab-creators/route.ts`
- Create: `affiliate-tool-portal/app/api/shops/[id]/sync-open-collab-creators/status/route.ts`
- Modify: `affiliate-tool-portal/services/shops.ts`
- Modify: `affiliate-tool-portal/hooks/use-shops.ts`
- Modify: `affiliate-tool-portal/types/shops.ts`
- Modify: `affiliate-tool-portal/components/shops/shops-table.tsx`
- Modify: `affiliate-tool-portal/components/shops/shops-page-content.tsx` (oauth toast copy)

- [ ] **Step 1: BFF routes** — proxy with `authenticatedApiFetch` to `/api/v1/shops/:id/sync-open-collab-creators` (+ `/status`), same pattern as `app/api/shops/[id]/products/route.ts`.

- [ ] **Step 2: Service + hooks**

```ts
export async function syncOpenCollabCreators(shopId: string) {
  const res = await fetch(
    `/api/shops/${encodeURIComponent(shopId)}/sync-open-collab-creators`,
    { method: "POST", credentials: "include" },
  );
  // throw on !ok like other shop helpers
  return res.json();
}

export async function fetchOpenCollabCreatorsSyncStatus(shopId: string, signal?: AbortSignal) {
  const res = await fetch(
    `/api/shops/${encodeURIComponent(shopId)}/sync-open-collab-creators/status`,
    { credentials: "include", signal },
  );
  return res.json();
}
```

Hooks: `useSyncOpenCollabCreators` mutation; optional `useOpenCollabCreatorsSyncStatus(shopId, { refetchInterval })` while RUNNING.

- [ ] **Step 3: UI** — for `oauthConnected` shops, add button **Sync shop creators**; on click mutate + toast; show last `status` / counts from shop DTO or status query.

- [ ] **Step 4: OAuth callback toast** — when `oauth=connected`, toast: `TikTok Shop authorized — syncing open-collab creators…` (in addition to success).

- [ ] **Step 5: Manual smoke** — connect/dev shop with open collab products; click sync; confirm Creators + list **Shop collaborators**.

- [ ] **Step 6: Commit (portal repo)**

```bash
cd affiliate-tool-portal
git add app/api/shops services/shops.ts hooks/use-shops.ts types/shops.ts components/shops
git commit -m "$(cat <<'EOF'
feat(shops): UI to sync open-collab creators into CRM

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Open-collab products only | 1, 3 |
| creator_content_details pagination | 1, 3 |
| CRM upsert + Shop collaborators list | 3 |
| stage ACTIVE on create; no stage overwrite | 3 |
| Caps 500 / 10k → PARTIAL | 3 |
| One job per shop | 4 |
| POST enqueue + GET status | 5 |
| OAuth auto-enqueue best-effort | 5 |
| Manual button + summary UI | 6 |
| Agency Manage Partnerships out of scope | Global Constraints |

## Placeholder / consistency self-review

- No TBD steps; TikTok search path version note: verify live Partner Center page at implement time if `202508` vs `202412`.
- Function names consistent: `enqueueOpenCollabCreatorsSync`, `runOpenCollabCreatorsSync`, `getOpenCollabCreatorsSyncStatus`, `mapOpenCollabCreator`.
- List name exact: `Shop collaborators`.
