import type { BillingLifecycleType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { sendBillingNoticeEmail, sendWelcomeEmail } from "./email.js";

async function orgOwnerRecipients(organizationId: string) {
  const owners = await prisma.membership.findMany({
    where: {
      organizationId,
      role: "OWNER",
      status: "ACTIVE",
    },
    include: {
      user: { select: { email: true, name: true } },
      organization: { select: { name: true } },
    },
  });
  return owners.map((o) => ({
    email: o.user.email,
    name: o.user.name,
    organizationName: o.organization.name,
  }));
}

/** Fire-and-forget billing emails to org owners (never throws to callers). */
export async function notifyBillingLifecycle(input: {
  organizationId: string;
  type: BillingLifecycleType | "PAYMENT_FAILED" | "PAST_DUE";
  fromPlanCode?: string | null;
  toPlanCode?: string | null;
  periodEnd?: string | null;
}) {
  if (input.type === "REGISTERED") return;

  try {
    const recipients = await orgOwnerRecipients(input.organizationId);
    if (recipients.length === 0) {
      logger.warn("billing email skipped: no active owners", {
        organizationId: input.organizationId,
        type: input.type,
      });
      return;
    }

    await Promise.all(
      recipients.map((r) =>
        sendBillingNoticeEmail({
          to: r.email,
          recipientName: r.name,
          organizationName: r.organizationName,
          type: input.type,
          fromPlanCode: input.fromPlanCode,
          toPlanCode: input.toPlanCode,
          periodEnd: input.periodEnd,
        }).catch((err) => {
          logger.error("billing email send failed", {
            to: r.email,
            type: input.type,
            err: err instanceof Error ? err.message : String(err),
          });
        }),
      ),
    );
  } catch (err) {
    logger.error("billing email notify failed", {
      organizationId: input.organizationId,
      type: input.type,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function notifyWelcomeEmail(input: {
  to: string;
  recipientName: string;
  organizationName: string;
}) {
  try {
    await sendWelcomeEmail(input);
  } catch (err) {
    logger.error("welcome email send failed", {
      to: input.to,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
