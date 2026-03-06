"use strict";

const express = require("express");
const { ensureLoggedIn, ensurePlatformAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const ProfessionalCategory = require("../models/professionalCategory");
const { ensureProfessionalCategories } = require("../services/professionalCategorySeedService");
const { addPresignedUrlToItem, addPresignedUrlsToItems } = require("../helpers/presignedUrls");

const router = express.Router();

/** GET / - List all categories (flat). */
router.get("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const categories = await ProfessionalCategory.getAll();
    const enriched = await addPresignedUrlsToItems(categories, "image_key", "image_url");
    return res.json({ categories: enriched });
  } catch (err) {
    return next(err);
  }
});

/** GET /hierarchy - Get categories as parent->children tree. */
router.get("/hierarchy", ensureLoggedIn, async function (req, res, next) {
  try {
    const hierarchy = await ProfessionalCategory.getHierarchy();
    const enriched = await Promise.all(
      hierarchy.map(async (parent) => {
        const enrichedParent = await addPresignedUrlToItem(parent, "image_key", "image_url");
        const enrichedChildren = await addPresignedUrlsToItems(parent.children || [], "image_key", "image_url");
        return { ...enrichedParent, children: enrichedChildren };
      }),
    );
    return res.json({ hierarchy: enriched });
  } catch (err) {
    return next(err);
  }
});

/** POST /seed - Seed categories from JSON file. Admin only. Skips if categories already exist. */
router.post("/seed", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { created, skipped, existingCount } = await ensureProfessionalCategories();
    if (skipped) {
      return res.json({ message: "Categories already seeded", count: existingCount ?? 0 });
    }
    if (created > 0) {
      return res.status(201).json({ message: "Categories seeded successfully", count: created });
    }
    return res.json({ message: "No categories to seed (seed file empty or missing)" });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id - Get single category. */
router.get("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const category = await ProfessionalCategory.get(req.params.id);
    const enriched = await addPresignedUrlToItem(category, "image_key", "image_url");
    return res.json({ category: enriched });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id/children - Get subcategories of a parent. */
router.get("/:id/children", ensureLoggedIn, async function (req, res, next) {
  try {
    const children = await ProfessionalCategory.getChildren(req.params.id);
    const enriched = await addPresignedUrlsToItems(children, "image_key", "image_url");
    return res.json({ categories: enriched });
  } catch (err) {
    return next(err);
  }
});

/** POST / - Create category. Admin only. */
router.post("/", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { name, description, type, parent_id, icon, image_key, sort_order } = req.body;
    if (!name || !name.trim()) throw new BadRequestError("Name is required");
    if (!["parent", "child"].includes(type)) throw new BadRequestError("Type must be 'parent' or 'child'");
    if (type === "child" && !parent_id) throw new BadRequestError("parent_id is required for child categories");

    const category = await ProfessionalCategory.create({
      name: name.trim(), description, type, parent_id, icon, image_key, sort_order,
    });
    const enriched = await addPresignedUrlToItem(category, "image_key", "image_url");
    return res.status(201).json({ category: enriched });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id - Update category. Admin only. */
router.patch("/:id", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const category = await ProfessionalCategory.update(req.params.id, req.body);
    const enriched = await addPresignedUrlToItem(category, "image_key", "image_url");
    return res.json({ category: enriched });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id - Remove category. Admin only. */
router.delete("/:id", ensurePlatformAdmin, async function (req, res, next) {
  try {
    await ProfessionalCategory.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
