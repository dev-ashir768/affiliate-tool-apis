function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Non-numeric strings (and NaN/Infinity) map to null, never NaN. */
function toFiniteCount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapOpenCollabCreator(raw: Record<string, unknown>): {
  handle: string;
  displayName: string | null;
  creatorOpenId: string | null;
  followerCount: number | null;
  avatarUrl: string | null;
} | null {
  const profile = asRecord(raw.creator_profile) ?? raw;
  const usernameRaw =
    profile.username ?? profile.user_name ?? raw.username ?? raw.user_name;
  if (usernameRaw == null || String(usernameRaw).trim() === "") return null;
  const handle = String(usernameRaw).replace(/^@/, "").trim();
  if (!handle) return null;

  const nickname = profile.nickname ?? profile.nick_name ?? null;
  const openId =
    raw.creator_open_id ??
    profile.creator_open_id ??
    raw.creator_user_open_id ??
    null;
  const followers = profile.follower_count ?? profile.fans_cnt ?? null;
  const avatar = asRecord(profile.avatar);
  const avatarUrl =
    (avatar?.url != null ? String(avatar.url) : null) ??
    (profile.image_url != null ? String(profile.image_url) : null);

  return {
    handle,
    displayName: nickname != null ? String(nickname) : null,
    creatorOpenId: openId != null ? String(openId) : null,
    followerCount: toFiniteCount(followers),
    avatarUrl,
  };
}
