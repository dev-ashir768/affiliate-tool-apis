import { z } from "zod";

export const navAreaQuerySchema = z.object({
  area: z.enum(["dashboard", "backoffice"]),
});

export const createNavItemSchema = z.object({
  sectionId: z.string().min(1),
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, "key must be alphanumeric, _ or -"),
  label: z.string().trim().min(1).max(120),
  href: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^\//, "href must start with /"),
  icon: z.string().trim().min(1).max(64),
  sortOrder: z.coerce.number().int().min(0).default(0),
  badge: z.string().trim().max(32).optional().nullable(),
  enabled: z.boolean().optional(),
  allowedPlatformRoles: z
    .array(z.enum(["SUPERADMIN", "FINANCE", "OPS"]))
    .optional(),
  allowedOrgRoles: z.array(z.enum(["OWNER", "ADMIN", "MEMBER"])).optional(),
});

export const patchNavItemSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    href: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^\//, "href must start with /")
      .optional(),
    icon: z.string().trim().min(1).max(64).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    badge: z.string().trim().max(32).optional().nullable(),
    enabled: z.boolean().optional(),
    allowedPlatformRoles: z
      .array(z.enum(["SUPERADMIN", "FINANCE", "OPS"]))
      .optional(),
    allowedOrgRoles: z.array(z.enum(["OWNER", "ADMIN", "MEMBER"])).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });
