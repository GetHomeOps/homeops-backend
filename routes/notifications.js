"use strict";

const express = require("express");
const { ensureLoggedIn } = require("../middleware/auth");
const Notification = require("../models/notification");

const router = express.Router();

/** GET / - List notifications for current user */
router.get("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user.id;
    const { limit } = req.query;
    const notifications = await Notification.listForUser(userId, {
      limit: limit ? parseInt(limit, 10) : 20,
    });
    const unreadCount = await Notification.countUnread(userId);
    return res.json({ notifications, unreadCount });
  } catch (err) {
    return next(err);
  }
});

/** POST /:id/read - Mark notification as read */
router.post("/:id/read", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user.id;
    await Notification.markRead(req.params.id, userId);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/** POST /read-all - Mark all as read */
router.post("/read-all", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user.id;
    await Notification.markAllRead(userId);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
