"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensureSuperAdmin, ensurePlatformAdmin, ensurePropertyAccess, ensureUserCanAccessAccountFromBody } = require("../middleware/auth");
const { BadRequestError, ForbiddenError } = require("../expressError");
const Property = require("../models/property");
const propertyNewSchema = require("../schemas/propertyNew.json");
const propertyUpdateSchema = require("../schemas/propertyUpdate.json");
const { generatePassportId } = require("../helpers/properties");
const { addPresignedUrlToItem, addPresignedUrlsToItems } = require("../helpers/presignedUrls");
const { canCreateProperty } = require("../services/tierService");
const { onPropertyCreated } = require("../services/resourceAutoSend");
const db = require("../db");

const router = new express.Router();

/** POST / - Create property, add creator as owner. Enforces tier limit. */
router.post("/", ensureLoggedIn, ensureUserCanAccessAccountFromBody(), async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, propertyNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const accountId = req.body.account_id;
    if (!accountId) throw new BadRequestError("account_id is required");

    const userRole = res.locals.user?.role;
    const creatorRole = userRole === "homeowner" ? "homeowner" : "agent";
    if (userRole !== 'super_admin' && userRole !== 'admin') {
      const tierCheck = await canCreateProperty(accountId);
      if (!tierCheck.allowed) {
        throw new ForbiddenError(`Property limit reached (${tierCheck.current}/${tierCheck.max}). Upgrade your plan.`);
      }
    }

    const passport_id = generatePassportId({ state: req.body.state, zip: req.body.zip });
    const property = await Property.create({ ...req.body, passport_id, account_id: accountId });

    const creatorId = res.locals.user?.id;
    if (creatorId) {
      await Property.addUserToProperty({
        property_id: property.id,
        user_id: creatorId,
        role: 'owner',
      });
    }

    let isFirstPropertyForUser = false;
    if (creatorId) {
      const countResult = await db.query(
        `SELECT COUNT(*)::int AS count FROM property_users WHERE user_id = $1`,
        [creatorId]
      );
      isFirstPropertyForUser = (countResult.rows[0]?.count ?? 0) === 1;
    }

    try {
      await onPropertyCreated({
        propertyId: property.id,
        accountId,
        createdByUserId: creatorId,
        creatorRole,
        isFirstPropertyForUser,
      });
    } catch (autoErr) {
      console.error("[resourceAutoSend] property created:", autoErr.message);
    }

    const propertyWithUrl = await addPresignedUrlToItem(property, "main_photo", "main_photo_url");
    if (creatorId && res.locals.user?.name) {
      propertyWithUrl.owner_user_name = res.locals.user.name;
    }
    return res.status(201).json({ property: propertyWithUrl });
  } catch (err) {
    return next(err);
  }
});

/** GET / - List all properties. Platform admin only. */
router.get("/", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const properties = await Property.getAll();
    const propertiesWithUrls = await addPresignedUrlsToItems(properties, "main_photo", "main_photo_url");
    return res.json({ properties: propertiesWithUrls });
  } catch (err) {
    return next(err);
  }
});

/** GET /user/:userId - List properties for user. User or admin only. */
router.get("/user/:userId", ensureLoggedIn, ensurePropertyAccess({ scope: "user", param: "userId" }), async function (req, res, next) {
  try {
    const properties = await Property.getPropertiesByUserId(req.params.userId);
    const propertiesWithUrls = await addPresignedUrlsToItems(properties, "main_photo", "main_photo_url");
    return res.json({ properties: propertiesWithUrls });
  } catch (err) {
    return next(err);
  }
});

/** GET /team/:uid - Get property team members. Requires property access. */
router.get("/team/:uid", ensureLoggedIn, ensurePropertyAccess(), async function (req, res, next) {
  try {
    const uid = req.params.uid;
    if (uid == null || uid === "null" || uid === "undefined" || String(uid).trim() === "") {
      throw new BadRequestError("Valid property uid required");
    }
    const property = await Property.get(uid);
    const property_users = await Property.getPropertyTeam(property.id);
    const property_users_with_urls = await addPresignedUrlsToItems(property_users, "image", "image_url");
    return res.json({ property_users: property_users_with_urls });
  } catch (err) {
    return next(err);
  }
});

/** GET /agent/account/:accountId - Get agents for account. */
router.get("/agent/account/:accountId", ensureLoggedIn, async function (req, res, next) {
  try {
    const users = await Property.getAgentByAccountId(req.params.accountId);
    return res.json({ users });
  } catch (err) {
    return next(err);
  }
});

/** GET /:uid - Get single property by uid. Requires property access. */
router.get("/:uid", ensureLoggedIn, ensurePropertyAccess(), async function (req, res, next) {
  try {
    const property = await Property.get(req.params.uid);
    const propertyWithUrl = await addPresignedUrlToItem(property, "main_photo", "main_photo_url");
    return res.json({ property: propertyWithUrl });
  } catch (err) {
    return next(err);
  }
});

/** POST /:propertyId/users - Add users to property. Body: array of { id, role }. */
router.post("/:propertyId/users", ensureLoggedIn, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const propertyId = req.params.propertyId;
    const users = Array.isArray(req.body) ? req.body : (req.body.users || []);
    if (!Array.isArray(users)) throw new BadRequestError("Provide users array with id and role");
    const property_users = [];
    for (const { id, role } of users) {
      if (id == null) throw new BadRequestError("Each user must have id and role");
      const row = await Property.addUserToProperty({
        property_id: propertyId,
        user_id: id,
        role: role || "editor",
      });
      property_users.push(row);
    }
    return res.status(201).json({ property: { added: property_users.length, property_users } });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:propertyId - Update property. */
router.patch("/:propertyId", ensureLoggedIn, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const property = await Property.updateProperty(req.params.propertyId, req.body);
    const propertyWithUrl = await addPresignedUrlToItem(property, "main_photo", "main_photo_url");
    return res.json({ property: propertyWithUrl });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:propertyId/team - Sync property team. Body: array of { id, role }. */
router.patch("/:propertyId/team", ensureLoggedIn, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const property_users = await Property.updatePropertyUsers(req.params.propertyId, req.body);
    return res.status(201).json({ property_users });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
