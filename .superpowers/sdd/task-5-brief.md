### Task 5: Portal BFF navigation + useNavigation

**Files:**
- Create: `affiliate-tool-portal/app/api/navigation/[area]/route.ts`
- Create: `affiliate-tool-portal/services/navigation.ts`
- Modify: `affiliate-tool-portal/hooks/use-navigation.ts`
- Modify: `affiliate-tool-portal/types/auth.ts` (platformMembership, redirectTo)

**Interfaces:**
- BFF reads access token; `apiFetch(/api/v1/navigation/${area}, { accessToken })`
- Hook fetches `/api/navigation/${area}` with credentials

- [ ] **Step 1: Implement BFF route**

```ts
export async function GET(_req: Request, ctx: { params: Promise<{ area: string }> }) {
  const { area } = await ctx.params;
  if (area !== "dashboard" && area !== "backoffice") {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid area" } }, { status: 400 });
  }
  const accessToken = await getAccessToken();
  if (!accessToken) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, { status: 401 });
  try {
    const data = await apiFetch(`/api/v1/navigation/${area}`, { accessToken });
    return NextResponse.json(data);
  } catch (err) { /* ApiClientError mapping like /me */ }
}
```

- [ ] **Step 2: Point useNavigation at BFF**

```ts
async function fetchNavigation(area: NavArea): Promise<NavResponse> {
  const res = await fetch(`/api/navigation/${area}`, { credentials: "include" });
  if (!res.ok) throw new Error("Couldn't load navigation");
  return res.json();
}
```

Keep static JSON files as fallback only if you must â€” **preferred: remove usage entirely** (files may remain unused).

- [ ] **Step 3: Manual check** â€” logged-in merchant loads dashboard shell without error.

- [ ] **Step 4: Commit (portal)**

```bash
git commit -m "feat: load navigation from API BFF instead of static JSON"
```

---


