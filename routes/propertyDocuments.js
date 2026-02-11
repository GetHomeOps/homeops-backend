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

/* POST /propertyDocuments => { document }
 *
 * Creates a new property document.
 * Body: { property_id, document_name, document_date, document_key, document_type, system_key }
 * document_key: S3 object key from POST /documents/upload response.
 * super_admin: full access. Others: must be on homeops team (property_users) for the property.
 */
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

/* GET /propertyDocuments/property/:propertyId => { documents: [...] }
 *
 * Returns all property documents for a property.
 * Must be defined before /:id so /property/123 is not matched as id="property".
 * super_admin: full access. Others: must be on homeops team for the property.
 */
router.get("/property/:propertyId", ensureLoggedIn, ensurePropertyAccess({ param: "propertyId" }), async (req, res, next) => {
  try {
    const documents = await PropertyDocument.getByPropertyId(req.params.propertyId);
    return res.json({ documents });
  } catch (err) {
    return next(err);
  }
});

/* GET /propertyDocuments/:id => { document }
 *
 * Returns a single property document by id.
 * super_admin: full access. Others: must be on homeops team for the document's property.
 */
router.get("/:id", ensureLoggedIn, loadPropertyIdFromDocument, ensurePropertyAccess({ param: "propertyId" }), async (req, res, next) => {
  try {
    const document = await PropertyDocument.get(req.params.id);
    return res.json({ document });
  } catch (err) {
    return next(err);
  }
});

/* DELETE /propertyDocuments/:id => { deleted: id }
 *
 * Deletes a property document.
 * super_admin: full access. Others: must be on homeops team for the document's property.
 */
router.delete("/:id", ensureLoggedIn, loadPropertyIdFromDocument, ensurePropertyAccess({ param: "propertyId" }), async (req, res, next) => {
  try {
    const result = await PropertyDocument.remove(req.params.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
