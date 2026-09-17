### Task 1: Authenticated BFF helper + org current GET/PATCH

**Files:**
- Create: `affiliate-tool-portal/lib/api/authenticated-fetch.ts`
- Create: `affiliate-tool-portal/types/orgs.ts`
- Create: `affiliate-tool-portal/app/api/orgs/current/route.ts`
- Create: `affiliate-tool-portal/validations/org.validations.ts`
- Test: manual or thin unit for mapper if any

**Interfaces:**
```ts
// types/orgs.ts
export type OrganizationCurrent = {
  id: string;
  name: string;
  slug: string;
  seatLimit: number;
  shopLimit: number;
  dailyInviteQuota: number;
  plan: { id: string; code: string; name: string };
  subscriptionStatus: string | null;
};

export async function authenticatedApiFetch<T>(path: string, init?: RequestInit): Promise<T>
// throws / returns NextResponse pattern used by routes
```

- [ ] **Step 1: Implement `authenticatedApiFetch`**

```ts
import { apiFetch, ApiClientError } from "@/lib/auth/api";
import { getAccessToken } from "@/lib/auth/session";

export async function authenticatedApiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new ApiClientError(401, "UNAUTHORIZED", "Not authenticated");
  }
  return apiFetch<T>(path, { ...init, accessToken });
}
```

- [ ] **Step 2: GET/PATCH `/api/orgs/current`**

Map ApiClientError → JSON like `/api/auth/me`. PATCH body `{ name }` via zod.

- [ ] **Step 3: Commit (portal)**

```bash
git commit -m "feat: add org current BFF with authenticated fetch helper"
```

---


