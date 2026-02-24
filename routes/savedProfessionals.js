"use strict";

const express = require("express");
const { ensureLoggedIn } = require("../middleware/auth");
const SavedProfessional = require("../models/savedProfessional");
const { addPresignedUrlsToItems } = require("../helpers/presignedUrls");

const router = express.Router();

/** GET / - List current user's saved professionals. */
router.get("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user.id;
    const professionals = await SavedProfessional.getByUserId(userId);
    const enriched = await addPresignedUrlsToItems(professionals, "profile_photo", "profile_photo_url");
    return res.json({ professionals: enriched });
  } catch (err) {
    return next(err);
  }
});

/** POST /:professionalId - Save a professional. */
router.post("/:professionalId", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user.id;
    const professionalId = req.params.professionalId;
    await SavedProfessional.save(userId, professionalId);
    return res.status(201).json({ saved: { professionalId } });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:professionalId - Unsave a professional. */
router.delete("/:professionalId", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user.id;
    const professionalId = req.params.professionalId;
    await SavedProfessional.unsave(userId, professionalId);
    return res.json({ unsaved: { professionalId } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
