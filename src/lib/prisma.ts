import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// Re-export enums used across modules so TS picks up post-generate client updates.
export type { Prisma, SampleRequestStatus } from "@prisma/client";

/** Delegates for models the IDE may omit when PrismaClient types are stale. */
export const sampleRequests = prisma.sampleRequest;
export const discoveryCrawlCells = prisma.discoveryCrawlCell;
