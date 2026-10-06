import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";
import { captureError } from "../lib/observability.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      captureError(err, { method: req.method, path: req.path, code: err.code });
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: err.flatten(),
      },
    });
    return;
  }
  logger.error("unhandled request error", {
    method: req.method,
    path: req.path,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  captureError(err, { method: req.method, path: req.path });
  res.status(500).json({
    error: { code: "INTERNAL", message: "Internal server error" },
  });
};
