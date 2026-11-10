import { describe, expect, it } from "vitest";
import { mapOpenCollabCreator } from "../../src/modules/shops/open-collab-creator-map.js";

describe("mapOpenCollabCreator", () => {
  it("maps nested creator_profile fields", () => {
    const mapped = mapOpenCollabCreator({
      creator_open_id: "oid-1",
      creator_profile: {
        username: "@CoolCreator",
        nickname: "Cool",
        follower_count: 1234,
        avatar: { url: "https://cdn.example/a.jpg" },
      },
    });
    expect(mapped).toEqual({
      handle: "CoolCreator",
      displayName: "Cool",
      creatorOpenId: "oid-1",
      followerCount: 1234,
      avatarUrl: "https://cdn.example/a.jpg",
    });
  });

  it("returns null when username missing", () => {
    expect(
      mapOpenCollabCreator({
        creator_open_id: "oid-2",
        creator_profile: { nickname: "x" },
      }),
    ).toBeNull();
  });

  it("parses numeric string follower counts", () => {
    const mapped = mapOpenCollabCreator({
      creator_profile: { username: "alice", fans_cnt: "1200" },
    });
    expect(mapped?.followerCount).toBe(1200);
  });

  it("maps non-numeric follower counts to null instead of NaN", () => {
    const mapped = mapOpenCollabCreator({
      creator_profile: { username: "alice", follower_count: "not-a-number" },
    });
    expect(mapped).not.toBeNull();
    expect(mapped?.followerCount).toBeNull();
    expect(mapped?.followerCount).not.toBeNaN();
  });

  it("maps blank and non-finite follower counts to null", () => {
    expect(
      mapOpenCollabCreator({
        creator_profile: { username: "alice", follower_count: "   " },
      })?.followerCount,
    ).toBeNull();
    expect(
      mapOpenCollabCreator({
        creator_profile: { username: "alice", follower_count: NaN },
      })?.followerCount,
    ).toBeNull();
  });
});
