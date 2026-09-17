### Task 3: Extend AccessClaims + auth issueSession/getMe

**Files:**
- Modify: `affiliate-tool-apis/src/lib/tokens.ts`
- Modify: `affiliate-tool-apis/src/modules/auth/auth.service.ts`
- Modify: any middleware using `req.auth.role` â†’ `req.auth.orgRole`
- Create: `affiliate-tool-apis/tests/auth/claims.test.ts`

**Interfaces:**
- Produces:

```ts
export type AccessClaims = {
  sub: string;
  orgId: string | null;
  orgRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  platformRole: "SUPERADMIN" | "FINANCE" | "OPS" | null;
};
```

- `getMe` returns:
```ts
{
  user: {...},
  currentOrganizationId: string | null,
  platformMembership: { role, status } | null,
  memberships: [...existing shape...],
  redirectTo: string  // "/backoffice/users" | "/home"
}
```

- [ ] **Step 1: Failing test â€” staff login claims include platformRole**

```ts
it("issues platformRole for SUPERADMIN without requiring org", async () => {
  // arrange: user with PlatformMembership only
  const session = await login({ email: staffEmail, password });
  const claims = await verifyAccessToken(session.accessToken);
  expect(claims.platformRole).toBe("SUPERADMIN");
  expect(claims.orgId).toBeNull();
});
```

- [ ] **Step 2: Run â€” expect FAIL**

```bash
npm test -- tests/auth/claims.test.ts
```

- [ ] **Step 3: Update tokens.ts**

```ts
export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({
    orgId: claims.orgId,
    orgRole: claims.orgRole,
    platformRole: claims.platformRole,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(accessKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, accessKey());
  return {
    sub: String(payload.sub),
    orgId: payload.orgId == null ? null : String(payload.orgId),
    orgRole: (payload.orgRole as AccessClaims["orgRole"]) ?? null,
    platformRole: (payload.platformRole as AccessClaims["platformRole"]) ?? null,
  };
}
```

- [ ] **Step 4: Update issueSession helpers in auth.service**

On login/register/refresh:
1. Load `platformMembership` where ACTIVE
2. Load first ACTIVE org membership (or keep existing org from prior token on refresh when still valid)
3. Set claims accordingly
4. Register still creates org OWNER (unchanged) with `platformRole: null`
5. `redirectTo`: platformRole ? `/backoffice/users` : `/home`

Update `authenticate` / `requireOrg` / `requireRole`:
- `requireOrg` fails if `!orgId`
- `requireRole` uses `orgRole`
- Add `requirePlatform(...roles)` for later slices (export now)

Fix all compile breakages from renaming `role` â†’ `orgRole`.

- [ ] **Step 5: Tests pass + commit**

```bash
npm test
git commit -m "feat: extend JWT and /me with platformRole and redirectTo"
```

Also return `redirectTo` from login/register HTTP responses (not only me).

---


