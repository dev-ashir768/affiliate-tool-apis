# Ops checklist

Updated: 2026-09-22

## TikTok Discover sync (Option C) — wire status

**Code ready:** OpenAPI client + `/platform/discovery/tiktok/*` + worker queue `discovery-sync` + backoffice UI.

**Still need in `.env` (from Partner Center app TIKA TICK):**

1. `TIKTOK_SHOP_APP_SECRET` — App & Service → app credentials  
2. Enable scope **`seller.creator_marketplace.read`** on the app  
3. Seller OAuth authorize a US shop → `TIKTOK_SHOP_ACCESS_TOKEN` (+ refresh)  
4. `TIKTOK_SHOP_CIPHER` from Get Authorized Shops  
5. Restart API + `npm run worker`, then backoffice Discovery → **Queue sync**

Endpoint used: `POST /affiliate_seller/202508/marketplace_creators/search`

## Still needs credentials / ops

1. Live Seller Center verify URLs  
2. IMAP bot inbox  
3. Real Stripe / SMTP  
4. Sentry DSN  

## Postman

Import `postman/Tiksly-Affiliate-Tool.postman_collection.json` + `Tiksly.environment.json`.  
Regen: `node scripts/gen-postman.cjs`
