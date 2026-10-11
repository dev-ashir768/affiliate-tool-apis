import { redis } from "../../lib/redis.js";
import { decryptVault, encryptVault } from "../../lib/crypto.js";

const KEY_PREFIX = "mfa-setup:";

async function requireRedis(): Promise<void> {
  if (redis.status === "ready") return;

  if (
    redis.status === "wait" ||
    redis.status === "end" ||
    redis.status === "close"
  ) {
    try {
      await Promise.race([
        redis.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Redis connect timeout")), 2000),
        ),
      ]);
    } catch {
      throw new Error("Redis unavailable");
    }
  }

  if (
    redis.status === "connecting" ||
    redis.status === "connect" ||
    redis.status === "reconnecting"
  ) {
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Redis ready timeout")),
          2000,
        );
        const onReady = () => {
          clearTimeout(timer);
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          clearTimeout(timer);
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          redis.off("ready", onReady);
          redis.off("error", onError);
        };
        redis.once("ready", onReady);
        redis.once("error", onError);
      });
    } catch {
      throw new Error("Redis unavailable");
    }
  }

  if (redis.status !== "ready") {
    throw new Error("Redis unavailable");
  }
}

export async function setPendingTotpSecret(
  userId: string,
  secret: string,
  ttlSec: number,
): Promise<void> {
  await requireRedis();
  await redis.set(`${KEY_PREFIX}${userId}`, encryptVault(secret), "EX", ttlSec);
}

export async function getPendingTotpSecret(
  userId: string,
): Promise<string | null> {
  await requireRedis();
  const value = await redis.get(`${KEY_PREFIX}${userId}`);
  if (!value) return null;
  try {
    return decryptVault(value);
  } catch {
    return null;
  }
}

export async function deletePendingTotpSecret(userId: string): Promise<void> {
  await requireRedis();
  await redis.del(`${KEY_PREFIX}${userId}`);
}
