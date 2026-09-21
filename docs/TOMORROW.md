# Ops checklist

Updated: 2026-09-21

## Needs real credentials (product works without them)

1. **Live Seller Center** — `SHOP_VERIFY_LIVE_URL_US/UK` + `SHOP_VERIFY_TARGET=live` + `SHOP_VERIFY_MODE=playwright`
2. **IMAP bot inbox** — `IMAP_*` + `BOT_INBOX_PROVIDER=imap`
3. **Sentry** — set `SENTRY_DSN` (optional `@sentry/node`)
4. **Stripe** — real `STRIPE_*` + price IDs for checkout
5. **SMTP / Resend** — set `EMAIL_PROVIDER=smtp|resend` for real outreach mail

## Next product slices

1. Partner TikTok commerce sync → `ShopOrder`
2. Automated discovery crawl → `CreatorDiscoveryProfile`
3. Products catalog API (route reserved; no mock data)
4. Outreach multi-touch sequences

## Postman

Import `postman/Tiksly-Affiliate-Tool.postman_collection.json` + `postman/Tiksly.environment.json`.
