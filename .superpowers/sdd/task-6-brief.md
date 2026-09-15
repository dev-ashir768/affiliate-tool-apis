### Task 6: Stripe billing (plans, checkout, portal, webhook)

**Files:**
- Create: `src/modules/billing/stripe.ts`
- Create: `src/modules/billing/billing.service.ts`
- Create: `src/modules/billing/billing.routes.ts`
- Create: `src/modules/billing/webhook.service.ts`
- Create: `tests/billing/webhook.service.test.ts`
- Modify: `src/app.ts` (raw body for webhook)

**Interfaces:**
- Consumes: Stripe SDK, Plan.stripePriceId, Organization.stripeCustomerId
- Produces:
  - `GET /api/v1/billing/plans`
  - `POST /api/v1/billing/checkout-session` `{ planCode }`
  - `POST /api/v1/billing/portal-session`
  - `POST /api/v1/webhooks/stripe`
  - `applySubscriptionFromStripe(event)` idempotent via `StripeEvent`

- [ ] **Step 1: Install Stripe**

```bash
npm install stripe
```

- [ ] **Step 2: Failing test â€” processing same event twice is idempotent**

```ts
it("ignores duplicate stripe event ids", async () => {
  const event = {
    id: `evt_test_${Date.now()}`,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_test",
        status: "active",
        customer: "cus_test",
        items: { data: [{ price: { id: "price_growth" } }] },
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
      },
    },
  };
  // seed org with stripeCustomerId cus_test and plan stripePriceId price_growth
  await handleStripeEvent(event as any);
  await handleStripeEvent(event as any); // no throw
  const count = await prisma.stripeEvent.count({ where: { eventId: event.id } });
  expect(count).toBe(1);
});
```

- [ ] **Step 3: Implement webhook handler**

On `checkout.session.completed` / `customer.subscription.*`:
1. Insert `StripeEvent` (unique); on conflict return early
2. Resolve org by `stripeCustomerId` or `client_reference_id` / metadata `organizationId`
3. Upsert `Subscription`
4. Find `Plan` by `stripePriceId`; copy `seatLimit`, `shopLimit`, `dailyInviteQuota`, `planId` onto Organization

Checkout session creation:

```ts
await stripe.checkout.sessions.create({
  mode: "subscription",
  customer: org.stripeCustomerId ?? undefined,
  customer_email: org.stripeCustomerId ? undefined : actorEmail,
  line_items: [{ price: plan.stripePriceId!, quantity: 1 }],
  success_url: `${portalUrl}/billing/success`,
  cancel_url: `${portalUrl}/billing/cancel`,
  metadata: { organizationId: org.id },
  client_reference_id: org.id,
});
```

Ensure webhook route uses:

```ts
app.post(
  "/api/v1/webhooks/stripe",
  express.raw({ type: "application/json" }),
  billingWebhookHandler
);
```

Mount this **before** `express.json()`.

- [ ] **Step 4: Run tests; commit**

```bash
git commit -m "feat: add Stripe checkout, portal, and idempotent webhooks"
```

---


