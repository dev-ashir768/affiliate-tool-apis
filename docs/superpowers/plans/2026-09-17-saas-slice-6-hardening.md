# SaaS Slice 6 — Hardening

**Goal:** Forgot/reset password, richer finance metrics, light audit log, Playwright shop verify (dry-run + optional browser).

## Scope

1. **Password reset** — `PasswordResetToken`, `POST /auth/forgot-password`, `POST /auth/reset-password`; portal wire + `/reset-password` page. Dev: log reset link (no SMTP required).
2. **Finance** — extend billing overview (free vs paid, ARPU, status breakdown with counts already; add revenue by plan).
3. **Audit (light)** — `AuditLog` writes for staff create/patch + password reset; `GET /platform/audit` SUPERADMIN.
4. **Playwright verify** — replace 501 scaffold with dry-run activation (default) + optional real Chromium when `PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=false` and playwright installed.

Nav admin still deferred.
