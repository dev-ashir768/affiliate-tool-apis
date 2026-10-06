/**
 * Capture a bot's TikTok Seller Center session for live shop verify.
 *
 *   npm run bot:login -- bot1@dealhoper.com [US|UK]
 *
 * Opens a visible browser. A staff member signs in as the bot (including any
 * captcha / OTP), then presses Enter here. The session is encrypted with
 * SESSION_VAULT_KEY and stored on the bot, so DATABASE_URL and SESSION_VAULT_KEY
 * must match the environment whose worker will run verify.
 */
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { encryptVault } from "../src/lib/crypto.js";

const LOGIN_URL_RE = /\/(login|signin|sign-in|passport|account\/register)\b/i;

async function main() {
  const [emailArg, regionArg = "US"] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();
  const region = regionArg.toUpperCase();
  if (!email || (region !== "US" && region !== "UK")) {
    console.error("Usage: npm run bot:login -- <bot-email> [US|UK]");
    process.exit(1);
  }

  const bot = await prisma.botIdentity.findUnique({ where: { email } });
  if (!bot) {
    console.error(`No bot ${email}. Add it in backoffice → Bots first.`);
    process.exit(1);
  }

  const loginUrl =
    region === "UK" ? env.SHOP_VERIFY_LOGIN_URL_UK : env.SHOP_VERIFY_LOGIN_URL_US;

  const browser = await chromium.launch({ headless: false });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

    console.log(`\nSign in to TikTok Seller Center as ${email} in the opened browser.`);
    console.log("Finish any captcha / verification code yourself.");
    await rl.question("When you see the Seller Center home page, press Enter here… ");

    if (LOGIN_URL_RE.test(page.url())) {
      const answer = await rl.question(
        `Browser is still on a sign-in page (${page.url()}). Save anyway? [y/N] `,
      );
      if (answer.trim().toLowerCase() !== "y") {
        console.log("Not saved.");
        return;
      }
    }

    const storageState = await context.storageState();
    await prisma.botIdentity.update({
      where: { id: bot.id },
      data: {
        sessionVaultCiphertext: encryptVault(JSON.stringify(storageState)),
        sessionCapturedAt: new Date(),
      },
    });
    console.log(`Saved session for ${email}. It can now be assigned to shops.`);
  } finally {
    rl.close();
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
