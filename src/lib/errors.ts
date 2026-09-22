export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "PLAN_LIMIT"
  | "PAYMENT_REQUIRED"
  | "SHOP_NOT_READY"
  | "CONFLICT"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "FAILED_PRECONDITION"
  | "BAD_GATEWAY"
  | "INTERNAL"
  | "NOT_IMPLEMENTED";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}
