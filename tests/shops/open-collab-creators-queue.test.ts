import { beforeEach, describe, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock("../../src/lib/queue.js", () => ({
  SHOP_OPEN_COLLAB_CREATORS_QUEUE: "shop-open-collab-creators",
  getShopOpenCollabCreatorsQueue: () => queue,
  shopOpenCollabCreatorsQueue: {
    add: queue.add,
    close: vi.fn(),
  },
}));

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    shop: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../src/lib/tiktok-shop/client.js", () => ({
  searchOpenCollaborations: vi.fn(),
  getOpenCollabCreatorContentDetails: vi.fn(),
}));

vi.mock("../../src/modules/shops/tiktok-oauth.service.js", () => ({
  getShopOpenApiCredentials: vi.fn(),
}));

import { prisma } from "../../src/lib/prisma.js";
import { enqueueOpenCollabCreatorsSync } from "../../src/modules/shops/open-collab-creators-sync.service.js";

describe("open-collab creator sync queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.shop.findFirst).mockResolvedValue({
      id: "shop1",
      organizationId: "org1",
      oauthConnectedAt: new Date(),
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.shop.update).mockResolvedValue({} as never);
    queue.add.mockResolvedValue({
      id: "shop-open-collab-creators-shop1",
    });
  });

  it("reuses an active job for the shop", async () => {
    queue.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("active"),
    });

    await expect(
      enqueueOpenCollabCreatorsSync("org1", "shop1", "user1"),
    ).resolves.toEqual({
      jobId: "shop-open-collab-creators-shop1",
      status: "RUNNING",
      shopId: "shop1",
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("removes a terminal job before enqueueing with the deterministic id", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    queue.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("failed"),
      remove,
    });

    const result = await enqueueOpenCollabCreatorsSync(
      "org1",
      "shop1",
      "user1",
    );

    expect(remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith(
      "sync",
      expect.objectContaining({
        organizationId: "org1",
        shopId: "shop1",
        triggeredBy: "user1",
      }),
      {
        jobId: "shop-open-collab-creators-shop1",
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
      },
    );
    expect(prisma.shop.update).toHaveBeenCalledWith({
      where: { id: "shop1", organizationId: "org1" },
      data: {
        openCollabCreatorsSync: expect.objectContaining({
          status: "QUEUED",
          jobId: "shop-open-collab-creators-shop1",
        }),
      },
    });
    expect(result).toEqual({
      jobId: "shop-open-collab-creators-shop1",
      status: "QUEUED",
      shopId: "shop1",
    });
  });
});
