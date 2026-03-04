"use strict";

const express = require("express");
const router = express.Router();
const PropertyDocument = require("../models/propertyDocuments");
const { ensureLoggedIn, ensurePropertyAccess } = require("../middleware/auth");
const { ForbiddenError } = require("../expressError");
const documentRagService = require("../services/documentRagService");
const { triggerReanalysisOnDocument } = require("../services/ai/propertyReanalysisService");
const { canUploadDocumentToSystem } = require("../services/tierService");
const db = require("../db");

/** Set req.params.propertyId from document id so ensurePropertyAccess can run. */
async function loadPropertyIdFromDocument(req, res, next) {
  try {
    const doc = await PropertyDocument.get(req.params.id);
    req.params.propertyId = doc.property_id;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** POST / - Create document record. Body: property_id, document_name, document_date, document_key, document_type, system_key. */
router.post("/", ensureLoggedIn, ensurePropertyAccess({ fromBody: "property_id", param: "propertyId" }), async (req, res, next) => {
  try {
    const { property_id, document_name, document_date, document_key, document_type, system_key } = req.body;

    const userRole = res.locals.user?.role;
    if (system_key && userRole !== "super_admin" && userRole !== "admin") {
      const accRes = await db.query(
        `SELECT account_id FROM properties WHERE id = $1`,
        [property_id]
      );
      const accountId = accRes.rows[0]?.account_id;
      if (accountId) {
        const tierCheck = await canUploadDocumentToSystem(accountId, property_id, system_key, userRole);
        if (!tierCheck.allowed) {
          throw new ForbiddenError(`Document limit reached for this system (${tierCheck.current}/${tierCheck.max}). Upgrade your plan.`);
        }
      }
    }

    const document = await PropertyDocument.create({
      property_id,
      document_name,
      document_date,
      document_key,
      document_type,
      system_key,
    });
    documentRagService.ingestDocument(property_id, document.id).catch((err) => {
      if (!err?.message?.includes("pgvector not available")) {
        console.error("[documentRag] Ingest on upload failed:", err.message);
      }
    });
    // Trigger AI reanalysis when new document is added (async, non-blocking)
    triggerReanalysisOnDocument(property_id, document.id).catch((err) => {
      console.error("[propertyReanalysis] Document trigger failed:", err.message);
    });
    return res.status(201).json({ document });
  } catch (err) {
    return next(err);
  }
});

/** GET /property/:propertyId - List documents for property. */
router.get("/property/:propertyId", ensureLoggedIn, ensurePropertyAccess({ param: "propertyId" }), async (req, res, next) => {
  try {
    const documents = await PropertyDocument.getByPropertyId(req.params.propertyId);
    return res.json({ documents });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id - Get single document. */
router.get("/:id", ensureLoggedIn, loadPropertyIdFromDocument, ensurePropertyAccess({ param: "propertyId" }), async (req, res, next) => {
  try {
    const document = await PropertyDocument.get(req.params.id);
    return res.json({ document });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id - Remove document record. */
router.delete("/:id", ensureLoggedIn, loadPropertyIdFromDocument, ensurePropertyAccess({ param: "propertyId" }), async (req, res, next) => {
  try {
    const result = await PropertyDocument.remove(req.params.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
