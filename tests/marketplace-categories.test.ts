import { describe, expect, it } from "vitest";
import { formatMarketplaceCategories } from "../src/modules/discovery/marketplace-categories.js";

describe("formatMarketplaceCategories", () => {
  it("maps known TikTok marketplace ids to names", () => {
    expect(
      formatMarketplaceCategories(["604453", "602118", "600001"]),
    ).toEqual(["Furniture", "Pet Supplies", "Home Supplies"]);
  });

  it("passes through unknown ids unchanged", () => {
    expect(formatMarketplaceCategories(["999999", "604453"])).toEqual([
      "999999",
      "Furniture",
    ]);
  });

  it("returns empty for empty input", () => {
    expect(formatMarketplaceCategories([])).toEqual([]);
  });
});
