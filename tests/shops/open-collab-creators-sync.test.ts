import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    shop: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    creator: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    creatorList: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    creatorListMember: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../../src/modules/shops/tiktok-oauth.service.js", () => ({
  getShopOpenApiCredentials: vi.fn(),
}));

vi.mock("../../src/lib/tiktok-shop/client.js", () => ({
  searchOpenCollaborations: vi.fn(),
  getOpenCollabCreatorContentDetails: vi.fn(),
}));

import { prisma } from "../../src/lib/prisma.js";
import {
  getOpenCollabCreatorContentDetails,
  searchOpenCollaborations,
} from "../../src/lib/tiktok-shop/client.js";
import {
  getOpenCollabCreatorsSyncStatus,
  runOpenCollabCreatorsSync,
} from "../../src/modules/shops/open-collab-creators-sync.service.js";
import { getShopOpenApiCredentials } from "../../src/modules/shops/tiktok-oauth.service.js";

describe("open-collab creator sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.shop.findFirst).mockResolvedValue({
      id: "shop1",
      organizationId: "org1",
      oauthConnectedAt: new Date(),
      status: "ACTIVE",
      openCollabCreatorsSync: null,
    } as never);
    vi.mocked(getShopOpenApiCredentials).mockResolvedValue({
      appKey: "k",
      appSecret: "s",
      accessToken: "t",
      shopCipher: "c",
    });
    vi.mocked(searchOpenCollaborations).mockResolvedValue({
      items: [{ id: "oc1", productId: "p1" }],
      nextPageToken: null,
      totalCount: 1,
    });
    vi.mocked(getOpenCollabCreatorContentDetails).mockResolvedValue({
      creators: [
        {
          creator_open_id: "oid-1",
          creator_profile: {
            username: "alice",
            nickname: "Alice",
            follower_count: 10,
          },
        },
      ],
      nextPageToken: null,
      totalCount: 1,
    });
    vi.mocked(prisma.creator.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.creator.create).mockResolvedValue({
      id: "cr1",
      handle: "alice",
    } as never);
    vi.mocked(prisma.creatorList.findUnique).mockResolvedValue({
      id: "list1",
      name: "Shop collaborators",
    } as never);
    vi.mocked(prisma.creatorListMember.create).mockResolvedValue({} as never);
    vi.mocked(prisma.shop.update).mockResolvedValue({} as never);
  });

  it("creates an active creator and links it to Shop collaborators", async () => {
    const result = await runOpenCollabCreatorsSync({
      organizationId: "org1",
      shopId: "shop1",
    });

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      productsScanned: 1,
      creatorsUpserted: 1,
      creatorsLinkedToList: 1,
      failedProducts: 0,
    });
    expect(prisma.creator.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_platform_handle: {
          organizationId: "org1",
          platform: "TIKTOK",
          handle: "alice",
        },
      },
    });
    expect(prisma.creator.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org1",
        platform: "TIKTOK",
        handle: "alice",
        displayName: "Alice",
        creatorOpenId: "oid-1",
        followerCount: 10,
        avatarUrl: null,
        stage: "ACTIVE",
      },
    });
    expect(prisma.creatorListMember.create).toHaveBeenCalledWith({
      data: { listId: "list1", creatorId: "cr1" },
    });
  });

  it("updates only non-null synced fields on an existing creator", async () => {
    vi.mocked(getOpenCollabCreatorContentDetails).mockResolvedValue({
      creators: [{ creator_profile: { username: "alice" } }],
      nextPageToken: null,
      totalCount: 1,
    });
    vi.mocked(prisma.creator.findUnique).mockResolvedValue({
      id: "cr1",
      handle: "alice",
      stage: "CONTACTED",
      notes: "keep",
      contactEmail: "keep@example.com",
    } as never);
    vi.mocked(prisma.creator.update).mockResolvedValue({
      id: "cr1",
      handle: "alice",
    } as never);

    await runOpenCollabCreatorsSync({
      organizationId: "org1",
      shopId: "shop1",
    });

    expect(prisma.creator.update).toHaveBeenCalledWith({
      where: { id: "cr1" },
      data: {},
    });
  });

  it("marks the result partial when a product fails and continues", async () => {
    vi.mocked(searchOpenCollaborations).mockResolvedValue({
      items: [
        { id: "oc1", productId: "p1" },
        { id: "oc2", productId: "p2" },
      ],
      nextPageToken: null,
      totalCount: 2,
    });
    vi.mocked(getOpenCollabCreatorContentDetails)
      .mockRejectedValueOnce(new Error("upstream failed"))
      .mockResolvedValueOnce({
        creators: [],
        nextPageToken: null,
        totalCount: 0,
      });

    const result = await runOpenCollabCreatorsSync({
      organizationId: "org1",
      shopId: "shop1",
    });

    expect(result).toMatchObject({
      status: "PARTIAL",
      productsScanned: 2,
      failedProducts: 1,
    });
  });

  it("ignores duplicate list membership errors", async () => {
    vi.mocked(prisma.creatorListMember.create).mockRejectedValue({
      code: "P2002",
    });

    const result = await runOpenCollabCreatorsSync({
      organizationId: "org1",
      shopId: "shop1",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.creatorsLinkedToList).toBe(0);
  });

  it("rejects a shop that has not completed TikTok OAuth", async () => {
    vi.mocked(prisma.shop.findFirst).mockResolvedValue({
      id: "shop1",
      organizationId: "org1",
      oauthConnectedAt: null,
    } as never);

    await expect(
      runOpenCollabCreatorsSync({
        organizationId: "org1",
        shopId: "shop1",
      }),
    ).rejects.toMatchObject({
      code: "SHOP_NOT_READY",
      status: 400,
    });
  });

  it("reads a persisted status for an organization-owned shop", async () => {
    const status = {
      status: "QUEUED",
      jobId: "job1",
      productsScanned: 0,
      creatorsUpserted: 0,
      creatorsLinkedToList: 0,
      failedProducts: 0,
      updatedAt: "2026-11-10T00:00:00.000Z",
    };
    vi.mocked(prisma.shop.findFirst).mockResolvedValue({
      openCollabCreatorsSync: status,
    } as never);

    await expect(
      getOpenCollabCreatorsSyncStatus("org1", "shop1"),
    ).resolves.toEqual(status);
    expect(prisma.shop.findFirst).toHaveBeenCalledWith({
      where: { id: "shop1", organizationId: "org1" },
      select: { openCollabCreatorsSync: true },
    });
  });
});
