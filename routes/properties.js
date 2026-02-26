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
const InspectionAnalysisJob = require("../models/inspectionAnalysisJob");
const InspectionAnalysisResult = require("../models/inspectionAnalysisResult");
const { enqueue } = require("../services/inspectionAnalysisQueue");
const Contact = require("../models/contact");
const SavedProfessional = require("../models/savedProfessional");
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

/** Resolve property_uid to numeric id. */
async function resolvePropertyIdForInspection(req, res, next) {
  try {
    const raw = req.params.propertyId;
    if (!raw) return next();
    if (/^\d+$/.test(String(raw))) {
      req.params.propertyId = parseInt(raw, 10);
      return next();
    }
    if (/^[0-9A-Z]{26}$/i.test(raw)) {
      const propRes = await db.query(
        `SELECT id FROM properties WHERE property_uid = $1`,
        [raw]
      );
      if (propRes.rows.length === 0) throw new ForbiddenError("Property not found.");
      req.params.propertyId = propRes.rows[0].id;
      return next();
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/** POST /:propertyId/inspection-report/analyze - Start inspection report analysis. Body: { s3Key, fileName?, mimeType? }. */
router.post(
  "/:propertyId/inspection-report/analyze",
  ensureLoggedIn,
  resolvePropertyIdForInspection,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const propertyId = req.params.propertyId;
      const userId = res.locals.user.id;
      const { s3Key, fileName, mimeType } = req.body || {};

      if (!s3Key || typeof s3Key !== "string") {
        throw new BadRequestError("s3Key is required");
      }
      const trimmedKey = s3Key.trim();
      if (!trimmedKey.startsWith("documents/") || trimmedKey.includes("..")) {
        throw new BadRequestError("Invalid s3Key");
      }

      const job = await InspectionAnalysisJob.create({
        property_id: propertyId,
        user_id: userId,
        s3_key: trimmedKey,
        file_name: fileName || null,
        mime_type: mimeType || null,
      });

      enqueue(job.id);

      return res.status(202).json({ jobId: job.id });
    } catch (err) {
      return next(err);
    }
  }
);

/** GET /:propertyId/inspection-analysis - Get latest inspection analysis result for property. */
router.get(
  "/:propertyId/inspection-analysis",
  ensureLoggedIn,
  resolvePropertyIdForInspection,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const propertyId = req.params.propertyId;
      const result = await InspectionAnalysisResult.getByPropertyId(propertyId);
      if (!result) {
        return res.json({ analysis: null });
      }
      return res.json({
        analysis: {
          conditionRating: result.condition_rating,
          conditionConfidence: result.condition_confidence,
          conditionRationale: result.condition_rationale,
          systemsDetected: result.systems_detected,
          needsAttention: result.needs_attention,
          suggestedSystemsToAdd: result.suggested_systems_to_add,
          maintenanceSuggestions: result.maintenance_suggestions,
          summary: result.summary,
          citations: result.citations,
          createdAt: result.created_at,
        },
      });
    } catch (err) {
      return next(err);
    }
  }
);

/** GET /:propertyId/contractors - Unified contractors (contacts + saved professionals) for scheduling. Query: query (optional search). */
router.get(
  "/:propertyId/contractors",
  ensureLoggedIn,
  resolvePropertyIdForInspection,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const propertyId = req.params.propertyId;
      const query = (req.query.query || "").trim().toLowerCase();
      const userId = res.locals.user.id;

      const propRes = await db.query(
        `SELECT account_id FROM properties WHERE id = $1`,
        [propertyId]
      );
      if (propRes.rows.length === 0) {
        throw new ForbiddenError("Property not found.");
      }
      const accountId = propRes.rows[0].account_id;

      const [contacts, savedProfessionals] = await Promise.all([
        Contact.getByAccountId(accountId),
        SavedProfessional.getByUserId(userId),
      ]);

      const contactItems = (contacts || []).map((c) => ({
        id: `contact-${c.id}`,
        sourceId: c.id,
        name: c.name || "Contact",
        source: "contact",
        phone: c.phone,
        email: c.email,
      }));

      const proDisplayName = (p) =>
        p.company_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Professional";

      const professionalItems = (savedProfessionals || []).map((p) => ({
        id: `pro-${p.id}`,
        sourceId: p.id,
        name: proDisplayName(p),
        source: "professional",
        phone: p.phone,
        email: p.email,
        categoryName: p.category_name,
      }));

      let combined = [...contactItems, ...professionalItems];

      if (query) {
        combined = combined.filter(
          (item) =>
            item.name?.toLowerCase().includes(query) ||
            item.phone?.includes(query) ||
            item.email?.toLowerCase().includes(query) ||
            item.categoryName?.toLowerCase().includes(query)
        );
      }

      return res.json({ contractors: combined });
    } catch (err) {
      return next(err);
    }
  }
);

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
