# Postman

## Import

1. `Tiksly-Affiliate-Tool.postman_collection.json` — full API surface (66 requests)
2. `Tiksly.environment.json` — local env (`baseUrl=http://localhost:4000`)

## Flow

1. **Auth → Register** or **Login** (tokens auto-save to collection vars)
2. Merchant folders: Orgs, Billing, Shops, Creators CRM, Outreach, Discovery, Orders & Analytics, Navigation
3. Platform folders need a staff token (seed `PLATFORM_SUPERADMIN_EMAIL` / password, then Login with that email)

## Regenerate

```bash
node scripts/gen-postman.cjs
```
