import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";

vi.mock("../../src/modules/shops/open-collab-creators-sync.service.js", () => ({
  runOpenCollabCreatorsSync: vi.fn(),
  persistSyncStatus: vi.fn(),
}));

import {
  persistSyncStatus,
  runOpenCollabCreatorsSync,
} from "../../src/modules/shops/open-collab-creators-sync.service.js";
import {
  processShopOpenCollabCreators,
  type ShopOpenCollabCreatorsJobData,
} from "../../src/workers/shop-open-collab-creators.processor.js";

describe("open-collab creator sync worker", () => {
  it("persists FAILED and rethrows when the sync fails", async () => {
    const error = new Error("TikTok token revoked");
    vi.mocked(runOpenCollabCreatorsSync).mockRejectedValue(error);
    const data: ShopOpenCollabCreatorsJobData = {
      organizationId: "org1",
      shopId: "shop1",
      triggeredBy: "user1",
      requestedAt: "2026-11-10T00:00:00.000Z",
    };

    await expect(
      processShopOpenCollabCreators({
        id: "shop-open-collab-creators:shop1",
        data,
      } as Job<ShopOpenCollabCreatorsJobData>),
    ).rejects.toBe(error);

    expect(persistSyncStatus).toHaveBeenCalledWith(
      "org1",
      "shop1",
      expect.objectContaining({
        status: "FAILED",
        jobId: "shop-open-collab-creators:shop1",
        productsScanned: 0,
        creatorsUpserted: 0,
        creatorsLinkedToList: 0,
        failedProducts: 0,
        lastError: "TikTok token revoked",
      }),
    );
  });
});
