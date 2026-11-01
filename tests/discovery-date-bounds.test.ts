import { describe, expect, it } from "vitest";
import { updatedAtBounds } from "../src/modules/discovery/discovery-date-bounds.js";

describe("updatedAtBounds", () => {
  it("returns empty object when both missing", () => {
    expect(updatedAtBounds()).toEqual({});
    expect(updatedAtBounds(undefined, undefined)).toEqual({});
    expect(updatedAtBounds("", "")).toEqual({});
  });

  it("maps from to gte start of UTC day", () => {
    const { gte, lt } = updatedAtBounds("2026-11-01");
    expect(lt).toBeUndefined();
    expect(gte?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("maps to to lt start of next UTC day (inclusive)", () => {
    const { gte, lt } = updatedAtBounds(undefined, "2026-11-01");
    expect(gte).toBeUndefined();
    expect(lt?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("supports both ends for a single day", () => {
    const { gte, lt } = updatedAtBounds("2026-11-15", "2026-11-15");
    expect(gte?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(lt?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("supports a multi-day window", () => {
    const { gte, lt } = updatedAtBounds("2026-11-01", "2026-11-30");
    expect(gte?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(lt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});
