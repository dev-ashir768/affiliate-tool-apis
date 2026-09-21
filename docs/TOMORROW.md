# Deferred / next work

Updated: 2026-09-21

## Still needs credentials / ops (not code blockers)

1. **Live Seller Center URLs** — set `SHOP_VERIFY_LIVE_URL_US/UK` + accept selectors; smoke `SHOP_VERIFY_TARGET=live`
2. **IMAP bot inbox** — real IMAP_* + `BOT_INBOX_PROVIDER=imap`
3. **Sentry** — `npm i @sentry/node` in prod with `SENTRY_DSN`
4. **CI vitest** — optional job with staging `DATABASE_URL`

## Next product slices (after discovery/attribution land)

1. Partner TikTok/commerce sync into `ShopOrder` (replace manual ingest)
2. Automated discovery crawl (replace staff-built `CreatorDiscoveryProfile` index)
3. Products catalog sync (still placeholder page)
4. Outreach sequences / multi-touch automation

## Shipped 2026-09-21

- Creator discovery index + merchant `/discover` + save-to-CRM
- Backoffice `/backoffice/discovery`
- Orders + commissions attribution + `/orders`
- Analytics funnel overview + `/analytics`
