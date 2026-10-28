import { describe, expect, it } from "vitest";
import { attachSavedToCrm } from "../src/modules/discovery/discovery.service.js";

describe("attachSavedToCrm", () => {
  it("flags profiles whose handle is in the CRM set", () => {
    const rows = [
      { handle: "alpha", id: "1" },
      { handle: "beta", id: "2" },
    ];
    const out = attachSavedToCrm(rows, new Set(["alpha"]));
    expect(out[0].savedToCrm).toBe(true);
    expect(out[1].savedToCrm).toBe(false);
  });

  it("treats empty CRM set as all unsaved", () => {
    const out = attachSavedToCrm([{ handle: "x", id: "1" }], new Set());
    expect(out[0].savedToCrm).toBe(false);
  });
});
