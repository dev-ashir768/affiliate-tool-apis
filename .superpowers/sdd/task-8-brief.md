### Task 8: Shop verify queue + stub worker + Playwright scaffold

**Files:**
- Create: `src/lib/queue.ts`
- Create: `src/modules/shops/verify.service.ts`
- Create: `src/workers/shop-verify.processor.ts`
- Create: `src/workers/shop-verify.playwright.scaffold.ts`
- Create: `src/worker.ts`
- Modify: `src/modules/shops/shops.routes.ts` (`POST /:id/verify`)
- Create: `tests/shops/verify-stub.test.ts`

**Interfaces:**
- Consumes: BullMQ, `SHOP_VERIFY_MODE`
- Produces:
  - Queue `shop-verify`
  - Job data `{ shopId, organizationId, mode, verificationJobId }`
  - Stub marks shop `ACTIVE`, bot `ASSIGNED`
  - Playwright scaffold exports `runPlaywrightVerify(job)` throwing `AppError("NOT_IMPLEMENTED", ...)`

- [ ] **Step 1: Install BullMQ**

```bash
npm install bullmq
```

- [ ] **Step 2: Failing test â€” stub processor activates shop**

```ts
it("stub verify marks shop ACTIVE", async () => {
  const shop = await connectShop(...);
  await enqueueAndProcessStub(shop.id); // call processor function directly in test
  const updated = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
  expect(updated.status).toBe("ACTIVE");
  expect(updated.verifiedAt).toBeTruthy();
});
```

- [ ] **Step 3: Implement queue + processor**

```ts
// src/lib/queue.ts
import { Queue } from "bullmq";
import { env } from "../config/env.js";

export const SHOP_VERIFY_QUEUE = "shop-verify";

export function bullConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}

export const shopVerifyQueue = new Queue(SHOP_VERIFY_QUEUE, {
  connection: bullConnection(),
});
```

```ts
// src/workers/shop-verify.processor.ts
import { Worker, type Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { bullConnection, SHOP_VERIFY_QUEUE } from "../lib/queue.js";
import { runPlaywrightVerify } from "./shop-verify.playwright.scaffold.js";
import { logger } from "../lib/logger.js";

export type ShopVerifyJobData = {
  shopId: string;
  organizationId: string;
  mode: "STUB" | "PLAYWRIGHT";
  verificationJobId: string;
};

export async function processShopVerify(job: Job<ShopVerifyJobData>) {
  const { shopId, mode, verificationJobId } = job.data;
  await prisma.shopVerificationJob.update({
    where: { id: verificationJobId },
    data: { status: "RUNNING", attempts: { increment: 1 }, bullJobId: String(job.id) },
  });
  await prisma.shop.update({
    where: { id: shopId },
    data: { status: "VERIFYING" },
  });

  try {
    if (mode === "PLAYWRIGHT") {
      await runPlaywrightVerify(job.data);
    } else {
      await new Promise((r) => setTimeout(r, 200));
      await prisma.$transaction([
        prisma.shop.update({
          where: { id: shopId },
          data: {
            status: "ACTIVE",
            verifiedAt: new Date(),
            sessionVaultCiphertext: null,
            statusReason: null,
          },
        }),
        prisma.botIdentity.updateMany({
          where: { shop: { id: shopId } },
          data: { status: "ASSIGNED" },
        }),
        prisma.shopVerificationJob.update({
          where: { id: verificationJobId },
          data: { status: "SUCCEEDED" },
        }),
      ]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "verify failed";
    await prisma.shop.update({
      where: { id: shopId },
      data: { status: "FAILED", statusReason: message },
    });
    await prisma.shopVerificationJob.update({
      where: { id: verificationJobId },
      data: { status: "FAILED", lastError: message },
    });
    throw err;
  }
}

export function startShopVerifyWorker() {
  const worker = new Worker(SHOP_VERIFY_QUEUE, processShopVerify, {
    connection: bullConnection(),
    concurrency: 5,
  });
  worker.on("failed", (job, err) =>
    logger.error("shop-verify failed", { jobId: job?.id, err: err.message })
  );
  return worker;
}
```

```ts
// src/workers/shop-verify.playwright.scaffold.ts
import { AppError } from "../lib/errors.js";
import type { ShopVerifyJobData } from "./shop-verify.processor.js";

/** Scaffold only â€” real Playwright inbox/accept/login comes later. */
export async function runPlaywrightVerify(_data: ShopVerifyJobData): Promise<void> {
  throw new AppError(
    "NOT_IMPLEMENTED",
    "Playwright shop verify is scaffolded but not implemented",
    501
  );
}
```

```ts
// src/worker.ts
import { startShopVerifyWorker } from "./workers/shop-verify.processor.js";
import { logger } from "./lib/logger.js";

startShopVerifyWorker();
logger.info("worker started");
```

`requestVerify(shopId)`:
- Reject unless status `PENDING_INVITE` or `FAILED` (`SHOP_NOT_READY` otherwise)
- Create `ShopVerificationJob` QUEUED with mode from env
- Enqueue BullMQ job
- Return `{ verificationJobId, status: "VERIFYING" }` after setting shop VERIFYING (or let worker set it â€” keep consistent with processor)

- [ ] **Step 4: Run tests; commit**

```bash
git commit -m "feat: add shop-verify BullMQ worker with stub and Playwright scaffold"
```

---


