"use strict";

const express = require("express");
const router = express.Router();
const PropertyDocument = require("../models/propertyDocuments");

/* POST /propertyDocuments => { document }
 *
 * Creates a new property document.
 * Body: { property_id, document_name, document_date, document_key, document_type, system_key }
 * document_key: S3 object key from POST /documents/upload response.
 */
router.post("/", async (req, res, next) => {
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
 */
router.get("/property/:propertyId", async (req, res, next) => {
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
 */
router.get("/:id", async (req, res, next) => {
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
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const result = await PropertyDocument.remove(req.params.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
