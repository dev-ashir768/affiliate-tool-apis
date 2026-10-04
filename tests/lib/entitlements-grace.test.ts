import { describe, it, expect } from "vitest";
import { subscriptionGrantsAccess } from "../../src/lib/entitlements.js";

describe("subscriptionGrantsAccess", () => {
  it("grants ACTIVE / TRIALING", () => {
    expect(
      subscriptionGrantsAccess({
        status: "ACTIVE",
        currentPeriodEnd: null,
      }),
    ).toBe(true);
    expect(
      subscriptionGrantsAccess({
        status: "TRIALING",
        currentPeriodEnd: new Date(Date.now() + 86400_000),
      }),
    ).toBe(true);
  });

  it("time-boxes PAST_DUE with grace after period end", () => {
    const withinGrace = new Date(Date.now() - 1 * 86400_000);
    expect(
      subscriptionGrantsAccess({
        status: "PAST_DUE",
        currentPeriodEnd: withinGrace,
      }),
    ).toBe(true);

    const beyondGrace = new Date(Date.now() - 10 * 86400_000);
    expect(
      subscriptionGrantsAccess({
        status: "PAST_DUE",
        currentPeriodEnd: beyondGrace,
      }),
    ).toBe(false);
  });

  it("denies PAST_DUE without period end", () => {
    expect(
      subscriptionGrantsAccess({
        status: "PAST_DUE",
        currentPeriodEnd: null,
      }),
    ).toBe(false);
  });
});
