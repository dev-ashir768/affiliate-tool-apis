import { describe, expect, it } from "vitest";
import {
  discoverySearchSchema,
  isYyyyMmDdCalendarDate,
} from "../src/modules/discovery/discovery.schemas.js";

describe("discovery date query validation", () => {
  it.each([
    "2026-13-01",
    "2026-00-01",
    "2026-02-29",
    "2026-04-31",
  ])("rejects invalid calendar date %s", (value) => {
    expect(isYyyyMmDdCalendarDate(value)).toBe(false);
    expect(
      discoverySearchSchema.safeParse({ updatedFrom: value }).success,
    ).toBe(false);
    expect(
      discoverySearchSchema.safeParse({ updatedTo: value }).success,
    ).toBe(false);
  });

  it.each(["2026-01-01", "2024-02-29", "9999-12-31"])(
    "accepts valid calendar date %s",
    (value) => {
      expect(isYyyyMmDdCalendarDate(value)).toBe(true);
      expect(
        discoverySearchSchema.safeParse({
          updatedFrom: value,
          updatedTo: value,
        }).success,
      ).toBe(true);
    },
  );
});
