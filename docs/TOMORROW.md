# Tomorrow / deferred work

Date noted: 2026-09-18  
Do these next session — not blocking current backoffice creators module.

## Tomorrow (recommended order)

1. **Live Seller Center URLs** — set `SHOP_VERIFY_LIVE_URL_US/UK` + real accept selectors; smoke one US/UK verify with `SHOP_VERIFY_TARGET=live`
2. **IMAP bot inbox** — configure real IMAP, test invite email gate before live verify
3. **Creator discovery** — crawl index or partner API design (no fake TikTok APIs); feed into merchant CRM + backoffice
4. **Attribution** — orders/commission sync replacing Products/Orders placeholders
5. **Analytics funnel** — invite → accept → order GMV
6. **Sentry package** — `npm i @sentry/node` in prod + wire request handler if needed
7. **CI secrets** — optional vitest job with staging `DATABASE_URL`

## Done today (context)

- SaaS ops + shop verify fixture/live flags + inbox adapter
- Merchant Creators / Campaigns / Outreach
- Backoffice Creators (staff add into any org) — this branch
- Operator runbook + GitHub typecheck CI
