import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import * as React from "react";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { PasswordResetEmail } from "../emails/password-reset.js";
import { OrgInviteEmail } from "../emails/org-invite.js";
import { StaffWelcomeEmail } from "../emails/staff-welcome.js";
import { OutreachEmail } from "../emails/outreach.js";
import { BillingNoticeEmail } from "../emails/billing-notice.js";
import { WelcomeEmail } from "../emails/welcome.js";
import type { BillingLifecycleType } from "@prisma/client";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export type EmailDeliveryStatus = {
  provider: "console" | "smtp" | "resend";
  fromSet: boolean;
  live: boolean;
  ready: boolean;
  missing: string[];
  note: string;
};

function portalOrigin(): string {
  const origin =
    env.CORS_ORIGINS.split(",")[0]?.trim() || "http://localhost:3000";
  return origin.replace(/\/$/, "");
}

export function emailLogoUrl(): string {
  if (env.EMAIL_LOGO_URL) return env.EMAIL_LOGO_URL;
  return `${portalOrigin()}/images/brandings/logo.png`;
}

class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    logger.info("email.send (console)", {
      to: message.to,
      subject: message.subject,
      text: message.text,
      htmlLength: message.html?.length ?? 0,
    });
  }
}

class SmtpEmailProvider implements EmailProvider {
  private transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });

  async send(message: EmailMessage): Promise<void> {
    if (!env.SMTP_HOST || !env.EMAIL_FROM) {
      throw new Error("SMTP_HOST and EMAIL_FROM are required for smtp provider");
    }
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    logger.info("email.send (smtp)", {
      to: message.to,
      subject: message.subject,
    });
  }
}

class ResendEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      throw new Error(
        "RESEND_API_KEY and EMAIL_FROM are required for resend provider",
      );
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html ?? message.text,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
      id?: string;
    };
    if (!res.ok) {
      throw new Error(
        json.message ?? json.name ?? `Resend error (HTTP ${res.status})`,
      );
    }
    logger.info("email.send (resend)", {
      to: message.to,
      subject: message.subject,
      id: json.id,
    });
  }
}

let cached: EmailProvider | null = null;

export function getEmailDeliveryStatus(): EmailDeliveryStatus {
  const provider = env.EMAIL_PROVIDER;
  const missing: string[] = [];
  if (!env.EMAIL_FROM) missing.push("EMAIL_FROM");

  if (provider === "smtp") {
    if (!env.SMTP_HOST) missing.push("SMTP_HOST");
    const ready = missing.length === 0;
    return {
      provider,
      fromSet: Boolean(env.EMAIL_FROM),
      live: true,
      ready,
      missing,
      note: ready
        ? "SMTP ready for live outreach."
        : `SMTP incomplete: set ${missing.join(", ")}.`,
    };
  }

  if (provider === "resend") {
    if (!env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
    const ready = missing.length === 0;
    return {
      provider,
      fromSet: Boolean(env.EMAIL_FROM),
      live: true,
      ready,
      missing,
      note: ready
        ? "Resend ready for live outreach."
        : `Resend incomplete: set ${missing.join(", ")}.`,
    };
  }

  return {
    provider: "console",
    fromSet: Boolean(env.EMAIL_FROM),
    live: false,
    ready: env.NODE_ENV !== "production",
    missing:
      env.NODE_ENV === "production" ? ["EMAIL_PROVIDER=smtp|resend"] : [],
    note:
      env.NODE_ENV === "production"
        ? "Console email is not allowed for outreach in production. Set EMAIL_PROVIDER=smtp or resend."
        : "Console provider logs emails only (dev). Set EMAIL_PROVIDER=smtp or resend for live delivery.",
  };
}

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;

  if (env.EMAIL_PROVIDER === "smtp") {
    cached = new SmtpEmailProvider();
  } else if (env.EMAIL_PROVIDER === "resend") {
    cached = new ResendEmailProvider();
  } else {
    cached = new ConsoleEmailProvider();
  }
  return cached;
}

export function resetEmailProviderForTests() {
  cached = null;
}

async function dispatch(
  to: string,
  subject: string,
  text: string,
  element: React.ReactElement,
) {
  const html = await render(element);
  await getEmailProvider().send({ to, subject, text, html });
}

export async function sendOutreachEmail(input: {
  to: string;
  subject: string;
  bodyText: string;
}) {
  const logoUrl = emailLogoUrl();
  await dispatch(
    input.to,
    input.subject,
    input.bodyText,
    React.createElement(OutreachEmail, {
      logoUrl,
      preview: input.subject,
      bodyText: input.bodyText,
    }),
  );
}

export async function sendPasswordResetEmail(input: {
  to: string;
  resetUrl: string;
  expiresMinutes: number;
  recipientName?: string;
}) {
  const logoUrl = emailLogoUrl();
  await dispatch(
    input.to,
    "Reset your influxa password",
    `Reset your password: ${input.resetUrl}\n\nThis link expires in ${input.expiresMinutes} minutes.`,
    React.createElement(PasswordResetEmail, {
      logoUrl,
      resetUrl: input.resetUrl,
      expiresMinutes: input.expiresMinutes,
      recipientName: input.recipientName,
    }),
  );
}

export async function sendOrgInviteEmail(input: {
  to: string;
  inviteUrl: string;
  organizationName: string;
  role: string;
  inviterName?: string;
}) {
  const logoUrl = emailLogoUrl();
  await dispatch(
    input.to,
    `You're invited to ${input.organizationName} on Tiksly`,
    `You've been invited as ${input.role} to ${input.organizationName}.\n\nAccept: ${input.inviteUrl}`,
    React.createElement(OrgInviteEmail, {
      logoUrl,
      inviteUrl: input.inviteUrl,
      organizationName: input.organizationName,
      role: input.role,
      inviterName: input.inviterName,
    }),
  );
}

export async function sendStaffWelcomeEmail(input: {
  to: string;
  name: string;
  role: string;
  temporaryPassword?: string;
}) {
  const loginUrl = `${portalOrigin()}/login`;
  const logoUrl = emailLogoUrl();
  const textLines = [
    `Hi ${input.name},`,
    `You've been added as platform staff (${input.role}).`,
    `Login: ${loginUrl}`,
  ];
  if (input.temporaryPassword) {
    textLines.push(`Temporary password: ${input.temporaryPassword}`);
  }
  await dispatch(
    input.to,
    "Your Tiksly backoffice access",
    textLines.join("\n\n"),
    React.createElement(StaffWelcomeEmail, {
      logoUrl,
      loginUrl,
      name: input.name,
      role: input.role,
      temporaryPassword: input.temporaryPassword,
    }),
  );
}

export async function sendWelcomeEmail(input: {
  to: string;
  recipientName: string;
  organizationName: string;
}) {
  const homeUrl = `${portalOrigin()}/onboarding`;
  const logoUrl = emailLogoUrl();
  await dispatch(
    input.to,
    "Welcome to Tiksly — choose a plan to get started",
    `Hi ${input.recipientName},\n\nYour workspace ${input.organizationName} is ready.\n\nChoose a plan: ${homeUrl}`,
    React.createElement(WelcomeEmail, {
      logoUrl,
      recipientName: input.recipientName,
      organizationName: input.organizationName,
      homeUrl,
    }),
  );
}

export async function sendBillingNoticeEmail(input: {
  to: string;
  recipientName?: string;
  organizationName: string;
  type:
    | BillingLifecycleType
    | "PAYMENT_FAILED"
    | "PAST_DUE";
  fromPlanCode?: string | null;
  toPlanCode?: string | null;
  periodEnd?: string | null;
}) {
  const billingUrl = `${portalOrigin()}/billing`;
  const logoUrl = emailLogoUrl();
  const greeting = input.recipientName
    ? `Hi ${input.recipientName},`
    : "Hi,";
  const org = input.organizationName;

  const copy = billingEmailCopy({
    type: input.type,
    organizationName: org,
    fromPlanCode: input.fromPlanCode,
    toPlanCode: input.toPlanCode,
    periodEnd: input.periodEnd,
  });

  await dispatch(
    input.to,
    copy.subject,
    [
      greeting,
      ...copy.paragraphs,
      ...(copy.detailLines ?? []),
      `Manage billing: ${billingUrl}`,
    ].join("\n\n"),
    React.createElement(BillingNoticeEmail, {
      logoUrl,
      preview: copy.preview,
      title: copy.title,
      greeting,
      paragraphs: copy.paragraphs,
      detailLines: copy.detailLines,
      ctaLabel: copy.ctaLabel,
      ctaUrl: billingUrl,
    }),
  );
}

function billingEmailCopy(input: {
  type: BillingLifecycleType | "PAYMENT_FAILED" | "PAST_DUE";
  organizationName: string;
  fromPlanCode?: string | null;
  toPlanCode?: string | null;
  periodEnd?: string | null;
}) {
  const planLabel = (code?: string | null) =>
    code ? code.charAt(0).toUpperCase() + code.slice(1) : "your plan";
  const period =
    input.periodEnd != null
      ? new Date(input.periodEnd).toLocaleDateString()
      : null;

  switch (input.type) {
    case "SUBSCRIBED":
      return {
        subject: `You're subscribed on ${input.organizationName}`,
        preview: "Your Tiksly subscription is active",
        title: "Subscription started",
        paragraphs: [
          `Thanks for subscribing on ${input.organizationName}. Your product access is unlocked.`,
        ],
        detailLines: [
          `Plan: ${planLabel(input.toPlanCode)}`,
          ...(period ? [`Current period ends: ${period}`] : []),
        ],
        ctaLabel: "Open billing",
      };
    case "RENEWED":
      return {
        subject: `Subscription renewed — ${input.organizationName}`,
        preview: "Your Tiksly subscription renewed",
        title: "Subscription renewed",
        paragraphs: [
          `Your subscription for ${input.organizationName} renewed successfully.`,
        ],
        detailLines: [
          `Plan: ${planLabel(input.toPlanCode)}`,
          ...(period ? [`Next period ends: ${period}`] : []),
        ],
        ctaLabel: "View billing",
      };
    case "UPGRADED":
      return {
        subject: `Plan upgraded — ${planLabel(input.fromPlanCode)} → ${planLabel(input.toPlanCode)}`,
        preview: "Your Tiksly plan was upgraded",
        title: "Plan upgraded",
        paragraphs: [
          `Your plan on ${input.organizationName} was upgraded. New limits apply immediately.`,
        ],
        detailLines: [
          `${planLabel(input.fromPlanCode)} → ${planLabel(input.toPlanCode)}`,
        ],
        ctaLabel: "See plan details",
      };
    case "DOWNGRADED":
      return {
        subject: `Plan changed — ${planLabel(input.fromPlanCode)} → ${planLabel(input.toPlanCode)}`,
        preview: "Your Tiksly plan was changed",
        title: "Plan changed",
        paragraphs: [
          `Your plan on ${input.organizationName} was changed. Limits now match your new plan.`,
        ],
        detailLines: [
          `${planLabel(input.fromPlanCode)} → ${planLabel(input.toPlanCode)}`,
        ],
        ctaLabel: "Review billing",
      };
    case "CANCELED":
      return {
        subject: `Subscription canceled — ${input.organizationName}`,
        preview: "Your Tiksly subscription was canceled",
        title: "Subscription canceled",
        paragraphs: [
          `The subscription for ${input.organizationName} was canceled. Product features stay locked until you renew.`,
        ],
        detailLines: input.fromPlanCode
          ? [`Previous plan: ${planLabel(input.fromPlanCode)}`]
          : undefined,
        ctaLabel: "Resubscribe",
      };
    case "PAYMENT_FAILED":
      return {
        subject: `Payment failed — action needed for ${input.organizationName}`,
        preview: "Update your payment method",
        title: "Payment failed",
        paragraphs: [
          `We couldn't process a payment for ${input.organizationName}. Update your payment method to avoid losing access.`,
        ],
        ctaLabel: "Update payment method",
      };
    case "PAST_DUE":
      return {
        subject: `Subscription past due — ${input.organizationName}`,
        preview: "Your subscription is past due",
        title: "Subscription past due",
        paragraphs: [
          `Your subscription for ${input.organizationName} is past due. Please update billing to keep product access.`,
        ],
        ctaLabel: "Fix billing",
      };
    case "REGISTERED":
    default:
      return {
        subject: `Welcome to Tiksly — ${input.organizationName}`,
        preview: "Your workspace is ready",
        title: "Welcome",
        paragraphs: [
          `Your workspace ${input.organizationName} is ready. Choose a plan to unlock the product.`,
        ],
        ctaLabel: "Choose a plan",
      };
  }
}

