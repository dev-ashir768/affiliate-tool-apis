import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { ShopVerifyTerminalError } from "../workers/shop-verify.errors.js";

export type InviteMailHit = {
  subject: string;
  from: string;
  receivedAt: string;
};

export type BotInboxProvider = {
  name: string;
  waitForInviteEmail: (input: {
    botEmail: string;
    subjectIncludes: string;
    timeoutMs: number;
    pollMs: number;
  }) => Promise<InviteMailHit>;
};

const consoleInbox: BotInboxProvider = {
  name: "console",
  async waitForInviteEmail({ botEmail, subjectIncludes }) {
    logger.info("bot-inbox console: assuming invite present", {
      botEmail,
      subjectIncludes,
    });
    return {
      subject: `console:${subjectIncludes}`,
      from: "console@local",
      receivedAt: new Date().toISOString(),
    };
  },
};

const imapInbox: BotInboxProvider = {
  name: "imap",
  async waitForInviteEmail({ botEmail, subjectIncludes, timeoutMs, pollMs }) {
    if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASS) {
      throw new ShopVerifyTerminalError("INBOX_MISCONFIGURED");
    }

    let ImapFlow: new (opts: Record<string, unknown>) => {
      connect: () => Promise<void>;
      mailboxOpen: (name: string) => Promise<unknown>;
      search: (query: Record<string, unknown>) => Promise<number[]>;
      fetchOne: (
        uid: number,
        opts: Record<string, unknown>
      ) => Promise<{
        envelope?: { subject?: string; from?: Array<{ address?: string }> };
        internalDate?: string | Date;
      } | null>;
      logout: () => Promise<void>;
    };

    try {
      const mod = await import("imapflow");
      ImapFlow = mod.ImapFlow as typeof ImapFlow;
    } catch {
      throw new ShopVerifyTerminalError(
        "INBOX_MISCONFIGURED",
        "imapflow is not installed; npm i imapflow or set BOT_INBOX_PROVIDER=none"
      );
    }

    const client = new ImapFlow({
      host: env.IMAP_HOST,
      port: env.IMAP_PORT,
      secure: env.IMAP_TLS,
      auth: { user: env.IMAP_USER, pass: env.IMAP_PASS },
      logger: false,
    });

    const needle = subjectIncludes.toLowerCase();
    const deadline = Date.now() + timeoutMs;

    try {
      await client.connect();
      await client.mailboxOpen("INBOX");

      while (Date.now() < deadline) {
        const uids = await client.search({ seen: false });
        for (const uid of uids.slice(-20).reverse()) {
          const msg = await client.fetchOne(uid, { envelope: true });
          const subject = msg?.envelope?.subject ?? "";
          if (!subject.toLowerCase().includes(needle)) continue;
          const from = msg?.envelope?.from?.[0]?.address ?? "";
          const receivedAt = msg?.internalDate
            ? new Date(msg.internalDate).toISOString()
            : new Date().toISOString();
          logger.info("bot-inbox imap: invite found", {
            botEmail,
            subject,
            from,
          });
          return { subject, from, receivedAt };
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }

      throw new ShopVerifyTerminalError("INBOX_TIMEOUT");
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
};

export function getBotInboxProvider(): BotInboxProvider | null {
  if (env.BOT_INBOX_PROVIDER === "none") return null;
  if (env.BOT_INBOX_PROVIDER === "imap") return imapInbox;
  return consoleInbox;
}

export async function waitForBotInviteIfConfigured(botEmail: string) {
  const provider = getBotInboxProvider();
  if (!provider) return null;
  return provider.waitForInviteEmail({
    botEmail,
    subjectIncludes: env.BOT_INBOX_SUBJECT_INCLUDES,
    timeoutMs: env.BOT_INBOX_TIMEOUT_MS,
    pollMs: env.BOT_INBOX_POLL_MS,
  });
}
