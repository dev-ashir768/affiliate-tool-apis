process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/affiliate_tool_test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-32-chars-minimum!!";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-32-chars-minimum!";
process.env.SESSION_VAULT_KEY ??= "12345678901234567890123456789012";
process.env.NODE_ENV = "test";
