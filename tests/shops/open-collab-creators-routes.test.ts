import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "../../src/middleware/error-handler.js";

const mockAuth = vi.hoisted(() => ({
  current: {
    sub: "user-1",
    orgId: "org-1",
    orgRole: "OWNER" as "OWNER" | "ADMIN" | "MEMBER",
    platformRole: null,
    hasProductAccess: true,
  },
}));

const syncMocks = vi.hoisted(() => ({
  enqueueOpenCollabCreatorsSync: vi.fn(),
  getOpenCollabCreatorsSyncStatus: vi.fn(),
}));

vi.mock("../../src/middleware/authenticate.js", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.auth = mockAuth.current;
    next();
  },
}));

vi.mock("../../src/middleware/require-org.js", () => ({
  requireOrg: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../../src/middleware/require-paid-access.js", () => ({
  requirePaidAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../../src/modules/shops/open-collab-creators-sync.service.js", () => ({
  enqueueOpenCollabCreatorsSync: syncMocks.enqueueOpenCollabCreatorsSync,
  getOpenCollabCreatorsSyncStatus: syncMocks.getOpenCollabCreatorsSyncStatus,
}));

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    shop: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../src/lib/crypto.js", () => ({
  encryptVault: vi.fn((v: string) => `enc:${v}`),
  decryptVault: vi.fn((v: string) => v),
}));

vi.mock("../../src/lib/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../../src/lib/tiktok-shop/oauth.js", () => ({
  verifyOAuthState: vi.fn(),
  exchangeAuthCode: vi.fn(),
  fetchAuthorizedShops: vi.fn(),
  oauthAppConfigured: vi.fn(() => true),
  buildAuthorizeUrl: vi.fn(),
  refreshAccessToken: vi.fn(),
  signOAuthState: vi.fn(),
}));

import { shopsRoutes } from "../../src/modules/shops/shops.routes.js";
import { completeTikTokShopOAuth } from "../../src/modules/shops/tiktok-oauth.service.js";
import { prisma } from "../../src/lib/prisma.js";
import { logger } from "../../src/lib/logger.js";
import {
  exchangeAuthCode,
  fetchAuthorizedShops,
  verifyOAuthState,
} from "../../src/lib/tiktok-shop/oauth.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/shops", shopsRoutes);
  app.use(errorHandler);
  return app;
}

describe("open-collab creators sync HTTP routes + OAuth auto-enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.current = {
      sub: "user-1",
      orgId: "org-1",
      orgRole: "OWNER",
      platformRole: null,
      hasProductAccess: true,
    };
  });

  it("POST /:shopId/sync-open-collab-creators returns 202 and enqueues for OWNER/ADMIN", async () => {
    syncMocks.enqueueOpenCollabCreatorsSync.mockResolvedValue({
      jobId: "shop-open-collab-creators-shop-1",
      status: "QUEUED",
      shopId: "shop-1",
    });

    const res = await request(buildApp()).post(
      "/api/v1/shops/shop-1/sync-open-collab-creators",
    );

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      jobId: "shop-open-collab-creators-shop-1",
      status: "QUEUED",
      shopId: "shop-1",
    });
    expect(syncMocks.enqueueOpenCollabCreatorsSync).toHaveBeenCalledWith(
      "org-1",
      "shop-1",
      "user-1",
    );
  });

  it("POST /:shopId/sync-open-collab-creators rejects MEMBER role with 403", async () => {
    mockAuth.current.orgRole = "MEMBER";

    const res = await request(buildApp()).post(
      "/api/v1/shops/shop-1/sync-open-collab-creators",
    );

    expect(res.status).toBe(403);
    expect(syncMocks.enqueueOpenCollabCreatorsSync).not.toHaveBeenCalled();
  });

  it("GET /:shopId/sync-open-collab-creators/status returns { status } including null", async () => {
    syncMocks.getOpenCollabCreatorsSyncStatus.mockResolvedValueOnce(null);

    const app = buildApp();
    const emptyRes = await request(app).get(
      "/api/v1/shops/shop-1/sync-open-collab-creators/status",
    );
    expect(emptyRes.status).toBe(200);
    expect(emptyRes.body).toEqual({ status: null });

    const summary = {
      status: "SUCCEEDED" as const,
      jobId: "shop-open-collab-creators-shop-1",
      productsScanned: 3,
      creatorsUpserted: 12,
      creatorsLinkedToList: 12,
      failedProducts: 0,
      updatedAt: "2026-11-10T00:00:00.000Z",
    };
    syncMocks.getOpenCollabCreatorsSyncStatus.mockResolvedValueOnce(summary);

    const statusRes = await request(app).get(
      "/api/v1/shops/shop-1/sync-open-collab-creators/status",
    );
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual({ status: summary });
  });

  it("completeTikTokShopOAuth best-effort enqueues sync and does not fail on enqueue error", async () => {
    vi.mocked(verifyOAuthState).mockReturnValue({
      orgId: "org-1",
      shopId: "shop-1",
      userId: "user-1",
      exp: Date.now() + 60_000,
    });
    vi.mocked(prisma.shop.findFirst).mockResolvedValue({
      id: "shop-1",
      organizationId: "org-1",
      region: "US",
      displayName: "Demo Shop",
    } as never);
    vi.mocked(exchangeAuthCode).mockResolvedValue({
      accessToken: "acc",
      refreshToken: "ref",
      accessTokenExpireIn: 3600,
      refreshTokenExpireIn: 7200,
      openId: "open-1",
      sellerName: "Seller",
      userType: 0,
      grantedScopes: ["seller.affiliate_collaboration.read"],
    });
    vi.mocked(fetchAuthorizedShops).mockResolvedValue([
      { id: "ext-1", cipher: "cipher-1", name: "US Shop", region: "US" },
    ]);
    const now = new Date("2026-11-10T00:00:00.000Z");
    vi.mocked(prisma.shop.update).mockResolvedValue({
      id: "shop-1",
      organizationId: "org-1",
      region: "US",
      botIdentityId: null,
      botIdentity: null,
      status: "ACTIVE",
      statusReason: "tiktok_oauth",
      displayName: "US Shop",
      externalShopId: "ext-1",
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
      oauthConnectedAt: now,
      tiktokGrantedScopes: ["seller.affiliate_collaboration.read"],
      tiktokAccessExpiresAt: now,
    } as never);

    syncMocks.enqueueOpenCollabCreatorsSync.mockRejectedValueOnce(
      new Error("redis connection down"),
    );

    const result = await completeTikTokShopOAuth({
      code: "code-1",
      state: "state-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(result.id).toBe("shop-1");
    expect(result.oauthConnected).toBe(true);
    expect(syncMocks.enqueueOpenCollabCreatorsSync).toHaveBeenCalledWith(
      "org-1",
      "shop-1",
      "user-1",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "open-collab creators sync enqueue after oauth failed",
      {
        shopId: "shop-1",
        err: "redis connection down",
      },
    );
  });
});
