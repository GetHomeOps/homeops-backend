"use strict";

const express = require("express");
const router = express.Router();
const PropertyDocument = require("../models/propertyDocuments");
const { ensureLoggedIn, ensurePropertyAccess } = require("../middleware/auth");

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
    const document = await PropertyDocument.create({
      property_id,
      document_name,
      document_date,
      document_key,
      document_type,
      system_key,
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
