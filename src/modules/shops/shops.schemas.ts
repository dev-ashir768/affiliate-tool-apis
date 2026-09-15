import { z } from "zod";

export const connectShopSchema = z.object({
  region: z.enum(["US", "UK"]),
});
