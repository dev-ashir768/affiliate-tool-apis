### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `vitest.config.ts`
- Create: `src/app.ts`
- Create: `src/server.ts`
- Create: `src/config/env.ts`
- Create: `src/lib/errors.ts`
- Create: `src/lib/logger.ts`
- Create: `src/middleware/error-handler.ts`
- Create: `tests/health.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `createApp()` â†’ Express; `GET /health` â†’ `{ ok: true }`; `env` object from Zod

- [ ] **Step 1: Write failing health test**

```ts
// tests/health.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns ok", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Init package and install deps**

```bash
cd affiliate-tool-apis
npm init -y
npm install express cors cookie-parser helmet zod dotenv
npm install -D typescript tsx vitest @types/node @types/express @types/cors @types/cookie-parser @types/supertest supertest
```

Set `"type": "module"` in `package.json` and scripts:

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "worker": "tsx watch src/worker.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Add tsconfig + vitest config**

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Implement env, errors, logger, error handler, app, server**

```ts
// src/config/env.ts
import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  SESSION_VAULT_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().default(604800),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SHOP_VERIFY_MODE: z.enum(["stub", "playwright"]).default("stub"),
  INVITE_TTL_SEC: z.coerce.number().default(604800),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
```

For tests, load a `.env.test` or set defaults in vitest setup later. For Task 1 health test only, make `createApp` not require full env parse yet â€” use a lazy/safe parse:

```ts
// src/config/env.ts (Task 1 interim: soft defaults for missing secrets in test)
// Prefer: vitest setupFiles sets process.env before import.
```

Create `tests/setup.ts`:

```ts
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/affiliate_tool_test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-32-chars-minimum!!";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-32-chars-minimum!";
process.env.SESSION_VAULT_KEY ??= "12345678901234567890123456789012";
process.env.NODE_ENV = "test";
```

Wire in `vitest.config.ts`: `setupFiles: ["tests/setup.ts"]`.

```ts
// src/lib/errors.ts
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "PLAN_LIMIT"
  | "SHOP_NOT_READY"
  | "CONFLICT"
  | "NOT_FOUND"
  | "INTERNAL"
  | "NOT_IMPLEMENTED";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}
```

```ts
// src/lib/logger.ts
export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: "info", msg, ...meta })),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: "error", msg, ...meta })),
};
```

```ts
// src/middleware/error-handler.ts
import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: err.flatten(),
      },
    });
    return;
  }
  console.error(err);
  res.status(500).json({
    error: { code: "INTERNAL", message: "Internal server error" },
  });
};
```

```ts
// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  // JSON parser for non-webhook routes (billing webhook raw body added in Task 8)
  app.use(express.json());
  app.use(errorHandler);
  return app;
}
```

```ts
// src/server.ts
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const app = createApp();
app.listen(env.PORT, () => logger.info("api listening", { port: env.PORT }));
```

```env
# .env.example
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/affiliate_tool
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=change-me-access-secret-min-32-chars
JWT_REFRESH_SECRET=change-me-refresh-secret-min-32-chars
SESSION_VAULT_KEY=0123456789abcdef0123456789abcdef
ACCESS_TOKEN_TTL_SEC=900
REFRESH_TOKEN_TTL_SEC=604800
CORS_ORIGINS=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
SHOP_VERIFY_MODE=stub
INVITE_TTL_SEC=604800
```

- [ ] **Step 5: Run health test**

```bash
npm test
```

Expected: PASS `GET /health returns ok`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example src tests
git commit -m "chore: scaffold Express TypeScript API with health check"
```

---


