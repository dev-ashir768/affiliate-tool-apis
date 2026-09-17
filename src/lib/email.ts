import { env } from "../config/env.js";
import { logger } from "./logger.js";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    logger.info("email.send (console)", {
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  if (env.EMAIL_PROVIDER === "resend") {
    logger.info(
      "EMAIL_PROVIDER=resend requested but Resend adapter not wired yet; using console",
    );
  }
  cached = new ConsoleEmailProvider();
  return cached;
}

/** Test helper */
export function resetEmailProviderForTests() {
  cached = null;
}
