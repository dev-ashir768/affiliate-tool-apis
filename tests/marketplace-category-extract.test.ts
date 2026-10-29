import { describe, expect, it } from "vitest";
import { extractMarketplaceCategoryIds } from "../src/modules/discovery/creator-metrics.js";

describe("extractMarketplaceCategoryIds", () => {
  it("reads string category_ids", () => {
    expect(
      extractMarketplaceCategoryIds({
        category_ids: ["604453", "602118"],
      }),
    ).toEqual(["604453", "602118"]);
  });

  it("reads object-shaped category entries", () => {
    expect(
      extractMarketplaceCategoryIds({
        category_ids: [
          { id: "604453" },
          { parent_category_id: "600001" },
          { category_id: "601739" },
        ],
      }),
    ).toEqual(["604453", "600001", "601739"]);
  });

  it("dedupes and ignores blanks", () => {
    expect(
      extractMarketplaceCategoryIds({
        category_ids: ["604453", "604453", "", null, 601739],
      }),
    ).toEqual(["604453", "601739"]);
  });

  it("returns empty for missing or empty arrays", () => {
    expect(extractMarketplaceCategoryIds({})).toEqual([]);
    expect(extractMarketplaceCategoryIds({ category_ids: [] })).toEqual([]);
  });
});
