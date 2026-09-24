/**
 * Local mirrors of newer Prisma enums.
 * IDE / language-service `@prisma/client` typings can lag behind `prisma generate`;
 * importing these instead avoids false "no exported member" errors.
 */

export type SampleRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "FULFILLING"
  | "FULFILLED"
  | "FAILED"
  | "CANCELED";

export type BillingLifecycleType =
  | "REGISTERED"
  | "SUBSCRIBED"
  | "RENEWED"
  | "UPGRADED"
  | "DOWNGRADED"
  | "CANCELED";
