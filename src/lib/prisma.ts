import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

export type { Prisma };

/** Mirrors Prisma `SampleRequestStatus` — local so IDE stale clients don't break imports. */
export type SampleRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "FULFILLING"
  | "FULFILLED"
  | "FAILED"
  | "CANCELED";

/**
 * Delegates for newer models — IDE PrismaClient typings can lag behind
 * `prisma generate`. Runtime client always has these after generate.
 */
const client = prisma as any;

export const sampleRequests = client.sampleRequest;
export const discoveryCrawlCells = client.discoveryCrawlCell;
export const discoveryCrawlTerms = client.discoveryCrawlTerm;
