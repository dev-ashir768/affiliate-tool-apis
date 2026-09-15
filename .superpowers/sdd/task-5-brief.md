### Task 5: Org context middleware + orgs/members/invites

**Files:**
- Create: `src/middleware/require-org.ts`
- Create: `src/middleware/require-role.ts`
- Create: `src/modules/orgs/orgs.schemas.ts`
- Create: `src/modules/orgs/orgs.service.ts`
- Create: `src/modules/orgs/orgs.routes.ts`
- Create: `tests/orgs/invites.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `AccessClaims` on `req.auth`
- Produces:
  - `GET/PATCH /api/v1/orgs/current`
  - `GET /api/v1/orgs/current/members`
  - `POST /api/v1/orgs/current/invites` `{ email, role }`
  - `POST /api/v1/orgs/invites/:token/accept`
  - Seat limit throws `PLAN_LIMIT` (403)

- [ ] **Step 1: Failing test â€” inviting beyond seatLimit throws PLAN_LIMIT**

```ts
import { describe, it, expect } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import { createInvite } from "../../src/modules/orgs/orgs.service.js";

// Arrange: org with seatLimit 1 and existing OWNER
// Act/Assert:
await expect(
  createInvite({
    organizationId: "...",
    actorUserId: "...",
    email: "va@test.com",
    role: "MEMBER",
  })
).rejects.toMatchObject({ code: "PLAN_LIMIT" });
```

Build arrange helpers that create org with `seatLimit: 1` via prisma in `beforeAll`.

- [ ] **Step 2: Implement createInvite / acceptInvite / listMembers / getCurrent / patchCurrent**

Rules:
- Count seats = memberships where status in `ACTIVE | INVITED`
- Invite stores `inviteTokenHash = sha256(rawToken)`, `inviteExpiresAt = now + INVITE_TTL_SEC`, status `INVITED`, creates User stub only on accept if needed â€” v1: invitee must already register first OR accept creates user password later. **Locked for plan:** invitee registers normally, then `accept` links membership if email matches; if no user yet, create membership row with email pending via creating User on accept requiring password body:

```ts
acceptInviteSchema = z.object({
  password: z.string().min(8).optional(), // required if user does not exist
  name: z.string().min(1).optional(),
});
```

If user exists and is authenticated as that email, activate membership. If user missing, require password+name and create user.

- [ ] **Step 3: Mount routes; run tests; commit**

```bash
git commit -m "feat: add org current endpoints and seat-limited invites"
```

---


