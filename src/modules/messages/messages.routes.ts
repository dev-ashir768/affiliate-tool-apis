import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePaidAccess } from "../../middleware/require-paid-access.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { rateLimit, rateLimitKey } from "../../middleware/rate-limit.js";
import {
  createConversationSchema,
  markReadSchema,
  sendImMessageSchema,
} from "./messages.schemas.js";
import {
  getNewestUnread,
  listConversationMessages,
  markConversationsRead,
  openConversationWithCreator,
  sendConversationMessage,
  syncAndListConversations,
} from "./messages.service.js";

export const messagesRoutes = Router();

messagesRoutes.use(authenticate, requireOrg, requirePaidAccess);

messagesRoutes.use(authenticate, requireOrg);

messagesRoutes.get("/conversations", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    const shopId = String(req.query.shopId ?? "");
    if (!shopId) {
      throw new AppError("VALIDATION_ERROR", "shopId is required", 400);
    }
    const pageSize = req.query.pageSize
      ? Number(req.query.pageSize)
      : undefined;
    const pageToken = req.query.pageToken
      ? String(req.query.pageToken)
      : null;
    const sync = req.query.sync !== "false";
    res.json(
      await syncAndListConversations(req.auth.orgId, {
        shopId,
        pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
        pageToken,
        sync,
      }),
    );
  } catch (err) {
    next(err);
  }
});

messagesRoutes.get("/unread", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    const shopId = String(req.query.shopId ?? "");
    if (!shopId) {
      throw new AppError("VALIDATION_ERROR", "shopId is required", 400);
    }
    res.json(await getNewestUnread(req.auth.orgId, shopId));
  } catch (err) {
    next(err);
  }
});

messagesRoutes.post(
  "/conversations",
  requireRole("OWNER", "ADMIN"),
  rateLimit({
    key: rateLimitKey("messages-open"),
    windowSec: 60,
    limit: 30,
  }),
  validateBody(createConversationSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.status(201).json(
        await openConversationWithCreator(
          req.auth.orgId,
          req.auth.sub,
          req.body,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

messagesRoutes.get(
  "/conversations/:id/messages",
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      const pageSize = req.query.pageSize
        ? Number(req.query.pageSize)
        : undefined;
      const pageToken = req.query.pageToken
        ? String(req.query.pageToken)
        : null;
      const sync = req.query.sync !== "false";
      res.json(
        await listConversationMessages(
          req.auth.orgId,
          String(req.params.id),
          {
            pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
            pageToken,
            sync,
          },
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

messagesRoutes.post(
  "/conversations/:id/messages",
  requireRole("OWNER", "ADMIN"),
  rateLimit({
    key: rateLimitKey("messages-send"),
    windowSec: 60,
    limit: 60,
  }),
  validateBody(sendImMessageSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.status(201).json(
        await sendConversationMessage(
          req.auth.orgId,
          req.auth.sub,
          String(req.params.id),
          req.body.text,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

messagesRoutes.post(
  "/mark-read",
  requireRole("OWNER", "ADMIN"),
  validateBody(markReadSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.json(await markConversationsRead(req.auth.orgId, req.body));
    } catch (err) {
      next(err);
    }
  },
);
