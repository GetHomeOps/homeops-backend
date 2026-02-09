"use strict";

/* Routes for properties */

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureDatabaseUser } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Property = require("../models/property");
const propertyNewSchema = require("../schemas/propertyNew.json");
const propertyUpdateSchema = require("../schemas/propertyUpdate.json");
const { generatePassportId } = require("../helpers/properties");
const { addPresignedUrlToItem, addPresignedUrlsToItems } = require("../helpers/presignedUrls");
const router = new express.Router();

/* POST / => { property }
*
* Creates a new property.
*
* Authorization required: SuperAdmin
**/
router.post("/", async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, propertyNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }
    const passport_id = generatePassportId({ state: req.body.state, zip: req.body.zip });
    const property = await Property.create({ ...req.body, passport_id });
    const propertyWithUrl = await addPresignedUrlToItem(property, "main_photo", "main_photo_url");

    return res.status(201).json({ property: propertyWithUrl });
  } catch (err) {
    return next(err);
  }
});



/* GET / => { properties: [property, ...] }
*
* Returns list of all properties.
*
* Authorization required: SuperAdmin
**/
router.get("/", async function (req, res, next) {
  try {
    const properties = await Property.getAll();
    const propertiesWithUrls = await addPresignedUrlsToItems(properties, "main_photo", "main_photo_url");
    return res.json({ properties: propertiesWithUrls });
  } catch (err) {
    return next(err);
  }
});

/* GET /user/:userId => { properties: [property, ...] }
*
* Returns list of all properties for a user.
* MUST be defined before /:uid so /user/123 is not matched as uid="user".
*
* Authorization required: SuperAdmin
**/
router.get("/user/:userId", async function (req, res, next) {
  try {
    const properties = await Property.getPropertiesByUserId(req.params.userId);
    const propertiesWithUrls = await addPresignedUrlsToItems(properties, "main_photo", "main_photo_url");
    return res.json({ properties: propertiesWithUrls });
  } catch (err) {
    return next(err);
  }
});

/* GET /[uid] => { property }
*
* Returns a property by property uid.
*
* Authorization required: SuperAdmin
**/
router.get("/:uid", async function (req, res, next) {
  try {
    const property = await Property.get(req.params.uid);
    const propertyWithUrl = await addPresignedUrlToItem(property, "main_photo", "main_photo_url");
    return res.json({ property: propertyWithUrl });
  } catch (err) {
    return next(err);
  }
});

/* POST /:propertyId/users => { property: { added, property_users } }
 * Body: { users: [{ id, role }, ...] } or array of users (when frontend sends users directly).
 * Adds each user to the property sequentially.
 */
router.post("/:propertyId/users", async function (req, res, next) {
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
        role: role || "agent",
      });
      property_users.push(row);
    }
    const payload = { added: property_users.length, property_users };
    return res.status(201).json({ property: payload });
  } catch (err) {
    return next(err);
  }
});

/* GET /agent/db/:databaseId => {users: [user, ...]} */
router.get("/agent/db/:databaseId", async function (req, res, next) {
  console.log("req:", req);
  try {
    const users = await Property.getAgentByDbId(req.body.databaseId);
    return res.json({ users });
  } catch (err) {
    return next(err);
  }
});

/* GET /:propertyId/team => { property_users }
 * propertyId = property_uid (ULID) from frontend.
 */
router.get("/team/:uid", async function (req, res, next) {
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

/* PATCH /:propertyId => { property } */
router.patch("/:propertyId", async function (req, res, next) {
  try {
    const property = await Property.updateProperty(req.params.propertyId, req.body);
    const propertyWithUrl = await addPresignedUrlToItem(property, "main_photo", "main_photo_url");
    return res.json({ property: propertyWithUrl });
  } catch (err) {
    return next(err);
  }
});

/* PATCH /:propertyId/users => { property: { property_users } } */
router.patch("/:propertyId/team", async function (req, res, next) {
  try {
    const property_users = await Property.updatePropertyUsers(req.params.propertyId, req.body);
    return res.status(201).json({ property_users });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;