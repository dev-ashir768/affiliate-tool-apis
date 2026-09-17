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

export const createProxySchema = z.object({
  label: z.string().trim().min(1).max(120),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  protocol: z.enum(["HTTP", "HTTPS", "SOCKS5"]).default("HTTP"),
  username: z.string().trim().max(120).optional().nullable(),
  password: z.string().max(256).optional().nullable(),
  region: z.string().trim().max(32).optional().nullable(),
  status: z.enum(["AVAILABLE", "IN_USE", "DISABLED", "BANNED"]).optional(),
});

export const patchProxySchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    host: z.string().trim().min(1).max(255).optional(),
    port: z.coerce.number().int().min(1).max(65535).optional(),
    protocol: z.enum(["HTTP", "HTTPS", "SOCKS5"]).optional(),
    username: z.string().trim().max(120).optional().nullable(),
    password: z.string().max(256).optional().nullable(),
    region: z.string().trim().max(32).optional().nullable(),
    status: z.enum(["AVAILABLE", "IN_USE", "DISABLED", "BANNED"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });
