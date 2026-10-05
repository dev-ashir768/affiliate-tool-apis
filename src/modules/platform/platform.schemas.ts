import { z } from "zod";

export const createStaffSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(["SUPERADMIN", "FINANCE", "OPS"]),
  password: z.string().min(8).max(128),
});

export const patchStaffSchema = z
  .object({
    role: z.enum(["SUPERADMIN", "FINANCE", "OPS"]).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: "At least one of role or status is required",
  });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  organizationId: z.string().optional(),
  subscriptionStatus: z.string().optional(),
  planCode: z.string().optional(),
  billingTier: z.enum(["free", "paid", "access"]).optional(),
});

export const grantAccessSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
  currentPeriodEnd: z.string().datetime(),
  note: z.string().trim().max(500).optional(),
});

export const revokeAccessSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const createPlatformCreatorSchema = z.object({
  organizationId: z.string().min(1),
  handle: z.string().trim().min(1).max(100),
  displayName: z.string().trim().max(200).optional().nullable(),
  contactEmail: z
    .string()
    .trim()
    .email()
    .optional()
    .nullable()
    .or(z.literal("")),
  region: z.enum(["US", "UK"]).optional().nullable(),
  followerCount: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  stage: z
    .enum(["LEAD", "CONTACTED", "INVITED", "ACTIVE", "REJECTED"])
    .optional(),
});

export const patchPlatformCreatorSchema = z
  .object({
    handle: z.string().trim().min(1).max(100).optional(),
    displayName: z.string().trim().max(200).optional().nullable(),
    contactEmail: z
      .string()
      .trim()
      .email()
      .optional()
      .nullable()
      .or(z.literal("")),
    region: z.enum(["US", "UK"]).optional().nullable(),
    followerCount: z.number().int().nonnegative().optional().nullable(),
    notes: z.string().trim().max(5000).optional().nullable(),
    stage: z
      .enum(["LEAD", "CONTACTED", "INVITED", "ACTIVE", "REJECTED"])
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });
