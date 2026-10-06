import "dotenv/config";

// Never run tests against the app database from .env — they create and delete
// users/orgs. Point TEST_DATABASE_URL / TEST_REDIS_URL at disposable instances.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://user:pass@localhost:5432/affiliate_tool_test";
process.env.REDIS_URL =
  process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";
// Tests sign/verify with HS256 (JWT_ACCESS_SECRET).
delete process.env.JWT_PRIVATE_KEY;
delete process.env.JWT_PUBLIC_KEY;
// Ensure JWT/vault secrets meet env schema min length for tests
if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32) {
  process.env.JWT_ACCESS_SECRET = "test-access-secret-32-chars-minimum!!";
}
if (!process.env.SESSION_VAULT_KEY || process.env.SESSION_VAULT_KEY.length < 32) {
  process.env.SESSION_VAULT_KEY = "12345678901234567890123456789012";
}
if (!process.env.PORTAL_BFF_SECRET || process.env.PORTAL_BFF_SECRET.length < 16) {
  process.env.PORTAL_BFF_SECRET = "test-portal-bff-secret";
}
process.env.NODE_ENV = "test";
