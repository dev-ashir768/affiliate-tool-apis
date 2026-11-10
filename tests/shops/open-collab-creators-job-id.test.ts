import { describe, expect, it } from "vitest";

import { openCollabCreatorsSyncJobId } from "../../src/modules/shops/open-collab-creators-sync.service.js";

describe("openCollabCreatorsSyncJobId", () => {
  it("uses a BullMQ-safe deterministic id per shop", () => {
    const jobId = openCollabCreatorsSyncJobId("shop1");
    expect(jobId).toBe("shop-open-collab-creators-shop1");
    expect(jobId).not.toContain(":");
  });
});
