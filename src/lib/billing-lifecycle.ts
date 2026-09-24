import type { BillingLifecycleType, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { notifyBillingLifecycle } from "./billing-emails.js";

export async function recordBillingLifecycleEvent(input: {
  organizationId: string;
  type: BillingLifecycleType;
  fromPlanCode?: string | null;
  toPlanCode?: string | null;
  actorUserId?: string | null;
  stripeEventId?: string | null;
  meta?: Record<string, unknown> | null;
  /** ISO period end for email copy */
  periodEnd?: string | null;
  /** Skip transactional email (rare) */
  silent?: boolean;
}) {
  try {
    await prisma.billingLifecycleEvent.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        fromPlanCode: input.fromPlanCode ?? null,
        toPlanCode: input.toPlanCode ?? null,
        actorUserId: input.actorUserId ?? null,
        stripeEventId: input.stripeEventId ?? null,
        meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    logger.error("billing lifecycle event write failed", {
      type: input.type,
      organizationId: input.organizationId,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!input.silent) {
    void notifyBillingLifecycle({
      organizationId: input.organizationId,
      type: input.type,
      fromPlanCode: input.fromPlanCode,
      toPlanCode: input.toPlanCode,
      periodEnd: input.periodEnd,
    });
  }
}
