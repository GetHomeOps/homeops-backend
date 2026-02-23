"use strict";

const express = require("express");
const { ensureLoggedIn, ensurePlatformAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Professional = require("../models/professional");
const { addPresignedUrlToItem, addPresignedUrlsToItems } = require("../helpers/presignedUrls");

const router = express.Router();

async function enrichProfessional(pro) {
  let enriched = await addPresignedUrlToItem(pro, "profile_photo", "profile_photo_url");

  const photos = await Professional.getPhotos(pro.id);
  enriched.photos = await addPresignedUrlsToItems(photos, "photo_key", "photo_url");

  return enriched;
}

/** GET / - List professionals with optional filters. */
router.get("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const filters = {};
    if (req.query.category_id) filters.category_id = req.query.category_id;
    if (req.query.city) filters.city = req.query.city;
    if (req.query.state) filters.state = req.query.state;
    if (req.query.budget_level) filters.budget_level = req.query.budget_level;
    if (req.query.min_rating) filters.min_rating = Number(req.query.min_rating);
    if (req.query.language) filters.language = req.query.language;
    if (req.query.is_verified === "true") filters.is_verified = true;

    const professionals = await Professional.getAll(filters);
    const enriched = await addPresignedUrlsToItems(professionals, "profile_photo", "profile_photo_url");
    return res.json({ professionals: enriched });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id - Get single professional with photos. */
router.get("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const pro = await Professional.get(req.params.id);
    const enriched = await enrichProfessional(pro);
    return res.json({ professional: enriched });
  } catch (err) {
    return next(err);
  }
});

/** POST / - Create professional. Admin only. */
router.post("/", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { first_name, last_name } = req.body;
    if (!first_name?.trim() || !last_name?.trim()) {
      throw new BadRequestError("first_name and last_name are required");
    }

    const pro = await Professional.create(req.body);
    const enriched = await enrichProfessional(pro);
    return res.status(201).json({ professional: enriched });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id - Update professional. Admin only. */
router.patch("/:id", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const pro = await Professional.update(req.params.id, req.body);
    const enriched = await enrichProfessional(pro);
    return res.json({ professional: enriched });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id - Remove professional. Admin only. */
router.delete("/:id", ensurePlatformAdmin, async function (req, res, next) {
  try {
    await Professional.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

/** POST /:id/photos - Add project photo. Admin only. */
router.post("/:id/photos", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { photo_key, caption, sort_order } = req.body;
    if (!photo_key) throw new BadRequestError("photo_key is required");

    const photo = await Professional.addPhoto(req.params.id, photo_key, caption, sort_order);
    const enriched = await addPresignedUrlToItem(photo, "photo_key", "photo_url");
    return res.status(201).json({ photo: enriched });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id/photos/:photoId - Remove project photo. Admin only. */
router.delete("/:id/photos/:photoId", ensurePlatformAdmin, async function (req, res, next) {
  try {
    await Professional.removePhoto(req.params.photoId);
    return res.json({ deleted: req.params.photoId });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
