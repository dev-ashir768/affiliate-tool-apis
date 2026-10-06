import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { ShopVerifyTerminalError } from "../workers/shop-verify.errors.js";

export type InviteMailHit = {
  subject: string;
  from: string;
  receivedAt: string;
  /** Invite link found in the mail body; null when none matched the pattern. */
  inviteUrl: string | null;
};

export type BotInboxProvider = {
  name: string;
  waitForInviteEmail: (input: {
    botEmail: string;
    since: Date;
    subjectIncludes: string;
    timeoutMs: number;
    pollMs: number;
  }) => Promise<InviteMailHit>;
};

/** Undo quoted-printable soft breaks and =XX escapes so links survive intact. */
function decodeQuotedPrintable(raw: string): string {
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_m, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function decodeHtmlEntities(url: string): string {
  return url.replace(/&amp;/g, "&").replace(/&#x3D;|&#61;/g, "=");
}

/** Decoded text of every base64 MIME part (HTML bodies are often base64). */
function decodeBase64Parts(raw: string): string {
  const out: string[] = [];
  const re =
    /Content-Transfer-Encoding:\s*base64[^\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)/gi;
  for (const m of raw.matchAll(re)) {
    out.push(Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8"));
  }
  return out.join("\n");
}

const INVITE_HINT = /invit|accept|join|collab|authori[sz]e/i;

/** Pick the most invite-looking TikTok link out of a raw RFC822 message. */
export function extractInviteUrl(
  rawSource: string,
  pattern = env.BOT_INVITE_LINK_PATTERN,
): string | null {
  const text = /Content-Transfer-Encoding:\s*quoted-printable/i.test(rawSource)
    ? decodeQuotedPrintable(rawSource)
    : rawSource;
  const body = `${text}\n${decodeBase64Parts(rawSource)}`;
  const re = new RegExp(pattern, "gi");
  const links = [...new Set((body.match(re) ?? []).map(decodeHtmlEntities))];
  if (links.length === 0) return null;
  return links.find((l) => INVITE_HINT.test(l)) ?? links[0];
}

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
      inviteUrl: null,
    };
  },
};

type ImapClient = {
  connect: () => Promise<void>;
  mailboxOpen: (name: string) => Promise<unknown>;
  search: (
    query: Record<string, unknown>,
    opts: { uid: true },
  ) => Promise<number[] | false>;
  fetchOne: (
    uid: number,
    query: Record<string, unknown>,
    opts: { uid: true },
  ) => Promise<{
    envelope?: { subject?: string; from?: Array<{ address?: string }> };
    internalDate?: string | Date;
    source?: Buffer;
  } | false>;
  messageFlagsAdd: (
    uid: number,
    flags: string[],
    opts: { uid: true },
  ) => Promise<unknown>;
  logout: () => Promise<void>;
};

const imapInbox: BotInboxProvider = {
  name: "imap",
  async waitForInviteEmail({ botEmail, since, subjectIncludes, timeoutMs, pollMs }) {
    if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASS) {
      throw new ShopVerifyTerminalError("INBOX_MISCONFIGURED");
    }

    let ImapFlow: new (opts: Record<string, unknown>) => ImapClient;
    try {
      const mod = await import("imapflow");
      ImapFlow = mod.ImapFlow as unknown as typeof ImapFlow;
    } catch {
      throw new ShopVerifyTerminalError(
        "INBOX_MISCONFIGURED",
        "imapflow is not installed; npm i imapflow or set BOT_INBOX_PROVIDER=none",
      );
    }

    const client = new ImapFlow({
      host: env.IMAP_HOST,
      port: env.IMAP_PORT,
      secure: env.IMAP_TLS,
      auth: { user: env.IMAP_USER, pass: env.IMAP_PASS },
      logger: false,
    });

    const needle = subjectIncludes.trim().toLowerCase();
    const deadline = Date.now() + timeoutMs;

    try {
      await client.connect();
      await client.mailboxOpen("INBOX");

      while (Date.now() < deadline) {
        // Every bot alias lands in one catch-all mailbox, so match on recipient.
        const uids =
          (await client.search({ to: botEmail, since }, { uid: true })) || [];
        for (const uid of uids.slice(-20).reverse()) {
          const msg = await client.fetchOne(
            uid,
            { envelope: true, internalDate: true, source: true },
            { uid: true },
          );
          if (!msg) continue;
          const subject = msg.envelope?.subject ?? "";
          if (needle && !subject.toLowerCase().includes(needle)) continue;

          const inviteUrl = msg.source
            ? extractInviteUrl(msg.source.toString("utf8"))
            : null;
          if (!inviteUrl) continue;

          const from = msg.envelope?.from?.[0]?.address ?? "";
          const receivedAt = msg.internalDate
            ? new Date(msg.internalDate).toISOString()
            : new Date().toISOString();
          await client
            .messageFlagsAdd(uid, ["\\Seen"], { uid: true })
            .catch(() => undefined);
          logger.info("bot-inbox imap: invite found", { botEmail, subject, from });
          return { subject, from, receivedAt, inviteUrl };
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

export async function waitForBotInviteIfConfigured(botEmail: string, since: Date) {
  const provider = getBotInboxProvider();
  if (!provider) return null;
  return provider.waitForInviteEmail({
    botEmail,
    since,
    subjectIncludes: env.BOT_INBOX_SUBJECT_INCLUDES,
    timeoutMs: env.BOT_INBOX_TIMEOUT_MS,
    pollMs: env.BOT_INBOX_POLL_MS,
  });
}
