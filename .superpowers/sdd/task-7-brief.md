### Task 7: Bots + shops connect/list/disconnect

**Files:**
- Create: `src/modules/bots/bots.service.ts`
- Create: `src/modules/shops/shops.schemas.ts`
- Create: `src/modules/shops/shops.service.ts`
- Create: `src/modules/shops/shops.routes.ts`
- Create: `tests/shops/connect.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: org `shopLimit`, BotIdentity pool
- Produces:
  - `reserveBot(organizationId): BotIdentity` (transactional)
  - `connectShop({ organizationId, region })`
  - `listShops`, `getShop`, `disconnectShop`
  - Routes under `/api/v1/shops`

- [ ] **Step 1: Failing tests**

1. `connectShop` when `shopLimit` is 0 â†’ `PLAN_LIMIT`
2. Happy path: reserves bot, shop status `PENDING_INVITE`, returns bot email
3. Second connect when limit 1 â†’ `PLAN_LIMIT`

```ts
it("connects shop and reserves bot", async () => {
  // bump org shopLimit to 1 for test
  const shop = await connectShop({ organizationId, region: "US" });
  expect(shop.status).toBe("PENDING_INVITE");
  expect(shop.botEmail).toMatch(/@/);
});
```

- [ ] **Step 2: Implement reserveBot with `updateMany` optimistic lock**

```ts
export async function reserveBot(organizationId: string) {
  const bot = await prisma.botIdentity.findFirst({
    where: { status: "AVAILABLE" },
    orderBy: { createdAt: "asc" },
  });
  if (!bot) throw new AppError("CONFLICT", "No bots available", 409);

  const updated = await prisma.botIdentity.updateMany({
    where: { id: bot.id, status: "AVAILABLE" },
    data: {
      status: "RESERVED",
      reservedForOrgId: organizationId,
      reservedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    throw new AppError("CONFLICT", "Bot reservation race; retry", 409);
  }
  return prisma.botIdentity.findUniqueOrThrow({ where: { id: bot.id } });
}
```

`disconnectShop`: set shop `DISCONNECTED`, bot `AVAILABLE`, clear reservation fields.

- [ ] **Step 3: Mount routes (OWNER/ADMIN for connect/delete; member for list/get); test; commit**

```bash
git commit -m "feat: add shop connect, list, and disconnect with bot reservation"
```

---


