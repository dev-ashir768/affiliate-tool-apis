### Task 9: Rate limits, README, smoke script

**Files:**
- Create: `src/middleware/rate-limit.ts`
- Modify: auth + verify routes to use rate limit
- Create: `README.md`
- Create: `scripts/smoke-foundation.ts`
- Create: `tests/smoke/foundation.http.test.ts` (optional gated)

**Interfaces:**
- Consumes: redis
- Produces: rate limit on `/api/v1/auth/*` and `POST /shops/:id/verify`; README with run instructions; smoke script covering register â†’ (optional webhook mock) â†’ connect â†’ stub verify

- [ ] **Step 1: Implement Redis sliding window rate limit (e.g. 20 req / 60s for auth)**

```ts
export function rateLimit({ key, limit, windowSec }: {
  key: (req: Request) => string;
  limit: number;
  windowSec: number;
}): RequestHandler
```

- [ ] **Step 2: Write README**

Cover: copy `.env.example`, Postgres/Redis, `prisma migrate`, `seed`, `npm run dev`, `npm run worker`, Stripe CLI webhook forward, portal CORS.

- [ ] **Step 3: Smoke script**

```ts
// scripts/smoke-foundation.ts
// 1. POST /api/v1/auth/register
// 2. Manually upsert org shopLimit=1 (or call billing webhook helper)
// 3. POST /api/v1/shops/connect
// 4. POST /api/v1/shops/:id/verify
// 5. Poll GET until ACTIVE (worker must be running)
```

- [ ] **Step 4: Commit**

```bash
git add src README.md scripts
git commit -m "docs: add Foundation README, rate limits, and smoke script"
```

---


