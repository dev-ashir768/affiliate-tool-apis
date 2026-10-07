/**
 * PM2 ecosystem — affiliate-tool-apis
 *
 * Deploy (on the server, inside this repo):
 *   bash deploy.sh
 *
 * First time only, after the first deploy:
 *   pm2 save && pm2 startup
 *
 * Secrets (DATABASE_URL, JWT keys, SESSION_VAULT_KEY, IMAP_PASS, Stripe, ...)
 * stay in .env on the server — never in this file, it is committed.
 * Values below override .env (dotenv does not overwrite existing env vars).
 */

/** Non-secret settings shared by the API and the worker. */
const shared = {
  NODE_ENV: "production",

  // Bot shop verify: real browser, real invites, no dry-run.
  SHOP_VERIFY_MODE: "playwright",
  PLAYWRIGHT_SHOP_VERIFY_DRY_RUN: "false",
  SHOP_VERIFY_TARGET: "live",

  // Bot inbox: every bot email is an alias of this mailbox (password in .env).
  BOT_INBOX_PROVIDER: "imap",
  IMAP_HOST: "imap.hostinger.com",
  IMAP_PORT: "993",
  IMAP_TLS: "true",
  IMAP_USER: "bots@dealhoper.com",

  // Self-serve bots: each shop gets bot-<random>@ this domain (catch-all → IMAP_USER).
  BOT_EMAIL_DOMAIN: "dealhoper.com",
};

module.exports = {
  apps: [
    {
      name: "influxa-api",
      cwd: __dirname,
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        ...shared,
        PORT: 4000,
      },
      max_memory_restart: "512M",
      kill_timeout: 35000,
      time: true,
      error_file: "logs/api-error.log",
      out_file: "logs/api-out.log",
      merge_logs: true,
    },
    {
      name: "influxa-worker",
      cwd: __dirname,
      script: "dist/worker.js",
      instances: 1,
      exec_mode: "fork",
      env: shared,
      // Headless Chromium for shop verify needs more headroom than the API.
      max_memory_restart: "1G",
      kill_timeout: 35000,
      time: true,
      error_file: "logs/worker-error.log",
      out_file: "logs/worker-out.log",
      merge_logs: true,
    },
  ],
};
