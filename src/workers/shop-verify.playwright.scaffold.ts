import { AppError } from "../lib/errors.js";
import type { ShopVerifyJobData } from "./shop-verify.processor.js";

/** Scaffold only — real Playwright inbox/accept/login comes later. */
export async function runPlaywrightVerify(_data: ShopVerifyJobData): Promise<void> {
  throw new AppError(
    "NOT_IMPLEMENTED",
    "Playwright shop verify is scaffolded but not implemented",
    501
  );
}
