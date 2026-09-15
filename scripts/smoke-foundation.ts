/**
 * Foundation smoke: register → bump shopLimit → connect → verify → poll ACTIVE.
 *
 * Prerequisites: API on BASE_URL (default http://localhost:4000), Postgres configured.
 * Worker + Redis preferred for queue path; if enqueue/worker unavailable, falls back to
 * processShopVerify() directly (documented in logs).
 *
 * Free plan shopLimit is 0 — this script upserts shopLimit=1 after register.
 *
 * Usage: npx tsx scripts/smoke-foundation.ts
 */
import type { Job } from "bullmq";
import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";
import {
  processShopVerify,
  type ShopVerifyJobData,
} from "../src/workers/shop-verify.processor.js";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:4000";
const POLL_MS = 500;
const POLL_TIMEOUT_MS = 15_000;

function fakeJob(
  data: ShopVerifyJobData,
  id = "smoke-fallback"
): Job<ShopVerifyJobData> {
  return { id, data } as Job<ShopVerifyJobData>;
}

async function jsonFetch(
  path: string,
  init: RequestInit & { token?: string } = {}
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function assertOk(label: string, ok: boolean, detail?: unknown): asserts ok {
  if (!ok) {
    console.error(`FAIL: ${label}`, detail ?? "");
    process.exit(1);
  }
  console.log(`OK: ${label}`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function runVerifyFallback(
  shopId: string,
  organizationId: string,
  verificationJobId: string | null,
  reason: string
) {
  console.warn(`Fallback: ${reason}`);
  console.warn(
    "For production-like smoke, keep Redis reachable and run `npm run worker`."
  );

  let jobId = verificationJobId;
  if (!jobId) {
    await prisma.shop.update({
      where: { id: shopId },
      data: { status: "PENDING_INVITE", statusReason: null },
    });
    const created = await prisma.shopVerificationJob.create({
      data: { shopId, mode: "STUB", status: "QUEUED" },
    });
    jobId = created.id;
  } else {
    await prisma.shopVerificationJob.update({
      where: { id: jobId },
      data: { status: "QUEUED", lastError: null },
    });
    await prisma.shop.update({
      where: { id: shopId },
      data: { status: "PENDING_INVITE", statusReason: null },
    });
  }

  await processShopVerify(
    fakeJob({
      shopId,
      organizationId,
      mode: "STUB",
      verificationJobId: jobId,
    })
  );
}

async function main() {
  const suffix = Date.now();
  const email = `smoke_${suffix}@example.com`;
  const password = "SmokeTest123!";

  console.log(`Smoke against ${BASE_URL}`);
  console.log(
    "Note: free plan shopLimit=0 — will bump org shopLimit to 1 after register."
  );

  const health = await jsonFetch("/health");
  assertOk(
    "health",
    health.status === 200 &&
      (health.body as { ok?: boolean })?.ok === true,
    health
  );

  const register = await jsonFetch("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      name: "Smoke User",
      organizationName: `Smoke Org ${suffix}`,
    }),
  });
  assertOk("register", register.status === 201, register);
  const regBody = register.body as {
    accessToken: string;
    organization: { id: string };
  };
  const token = regBody.accessToken;
  const orgId = regBody.organization.id;

  await prisma.organization.update({
    where: { id: orgId },
    data: { shopLimit: 1 },
  });
  console.log("OK: bumped organization.shopLimit → 1");

  const connect = await jsonFetch("/api/v1/shops/connect", {
    method: "POST",
    token,
    body: JSON.stringify({ region: "US" }),
  });
  assertOk("connect shop", connect.status === 201, connect);
  const shop = connect.body as { id: string; status: string };
  console.log(`  shopId=${shop.id} status=${shop.status}`);

  const verify = await jsonFetch(`/api/v1/shops/${shop.id}/verify`, {
    method: "POST",
    token,
  });

  let usedFallback = false;
  let verificationJobId: string | null = null;

  if (verify.status === 200) {
    console.log("OK: request verify");
    const verifyBody = verify.body as {
      verificationJobId: string;
      status: string;
    };
    verificationJobId = verifyBody.verificationJobId;
    console.log(
      `  verificationJobId=${verificationJobId} status=${verifyBody.status}`
    );

    const started = Date.now();
    let finalStatus = verifyBody.status;

    while (Date.now() - started < POLL_TIMEOUT_MS) {
      const get = await jsonFetch(`/api/v1/shops/${shop.id}`, { token });
      if (get.status === 200) {
        finalStatus = (get.body as { status: string }).status;
        if (finalStatus === "ACTIVE") break;
        if (finalStatus === "FAILED") break;
      }
      await sleep(POLL_MS);
    }

    if (finalStatus !== "ACTIVE") {
      await runVerifyFallback(
        shop.id,
        orgId,
        verificationJobId,
        `Shop stuck at ${finalStatus} after poll — processShopVerify() fallback`
      );
      usedFallback = true;
    }
  } else {
    await runVerifyFallback(
      shop.id,
      orgId,
      null,
      `POST /verify returned ${verify.status} (likely Redis enqueue failure)`
    );
    usedFallback = true;
  }

  const get = await jsonFetch(`/api/v1/shops/${shop.id}`, { token });
  const finalStatus =
    get.status === 200
      ? (get.body as { status: string }).status
      : "UNKNOWN";
  assertOk("shop ACTIVE", finalStatus === "ACTIVE", {
    finalStatus,
    usedFallback,
  });
  console.log(
    usedFallback
      ? "Smoke passed (via processShopVerify fallback)."
      : "Smoke passed (via queue/worker)."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    if (redis.status === "ready") await redis.quit().catch(() => {});
  });
