import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import * as React from "react";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { PasswordResetEmail } from "../emails/password-reset.js";
import { OrgInviteEmail } from "../emails/org-invite.js";
import { StaffWelcomeEmail } from "../emails/staff-welcome.js";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

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

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;

  if (env.EMAIL_PROVIDER === "smtp") {
    cached = new SmtpEmailProvider();
  } else {
    if (env.EMAIL_PROVIDER === "resend") {
      logger.info(
        "EMAIL_PROVIDER=resend not implemented; using console. Prefer EMAIL_PROVIDER=smtp.",
      );
    }
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
