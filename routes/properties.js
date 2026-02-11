"use strict";

/* Routes for properties */

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensureSuperAdmin, ensurePropertyAccess } = require("../middleware/auth");
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
 * Authorization required: logged in
 */
router.post("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, propertyNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }
    const passport_id = generatePassportId({ state: req.body.state, zip: req.body.zip });
    const property = await Property.create({ ...req.body, passport_id });

    // Add the creator to the property team so they have access (required for addUsersToProperty and other follow-up calls)
    const creatorId = res.locals.user?.id;
    if (creatorId) {
      const role = res.locals.user?.role === "homeowner" ? "homeowner" : "agent";
      await Property.addUserToProperty({
        property_id: property.id,
        user_id: creatorId,
        role,
      });
    }

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
router.get("/", ensureSuperAdmin, async function (req, res, next) {
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
 * Returns list of properties where the user is a team member (property_users).
 * MUST be defined before /:uid so /user/123 is not matched as uid="user".
 *
 * Authorization required: super_admin OR requesting own userId (ensurePropertyAccess user scope)
 */
router.get("/user/:userId", ensureLoggedIn, ensurePropertyAccess({ scope: "user", param: "userId" }), async function (req, res, next) {
  try {
    const properties = await Property.getPropertiesByUserId(req.params.userId);
    const propertiesWithUrls = await addPresignedUrlsToItems(properties, "main_photo", "main_photo_url");
    return res.json({ properties: propertiesWithUrls });
  } catch (err) {
    return next(err);
  }
});

/* GET /team/:uid => { property_users }
 * uid = property_uid (ULID) from frontend.
 * MUST be defined before /:uid so /team/... is not matched as uid="team".
 *
 * Authorization required: super_admin OR member of property team
 */
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

/* GET /agent/db/:databaseId => { users: [user, ...] }
 *
 * Authorization required: logged in
 */
router.get("/agent/db/:databaseId", ensureLoggedIn, async function (req, res, next) {
  try {
    const users = await Property.getAgentByDbId(req.params.databaseId);
    return res.json({ users });
  } catch (err) {
    return next(err);
  }
});

/* GET /[uid] => { property }
 *
 * Returns a property by property uid.
 *
 * Authorization required: logged in, and either super_admin or a member of the property's team
 */
router.get("/:uid", ensureLoggedIn, ensurePropertyAccess(), async function (req, res, next) {
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
 *
 * Authorization required: super_admin OR member of property team
 */
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

/* PATCH /:propertyId => { property }
 *
 * Authorization required: super_admin OR member of property team
 */
router.patch("/:propertyId", ensureLoggedIn, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const property = await Property.updateProperty(req.params.propertyId, req.body);
    const propertyWithUrl = await addPresignedUrlToItem(property, "main_photo", "main_photo_url");
    return res.json({ property: propertyWithUrl });
  } catch (err) {
    return next(err);
  }
});

/* PATCH /:propertyId/team => { property_users }
 *
 * Authorization required: super_admin OR member of property team
 */
router.patch("/:propertyId/team", ensureLoggedIn, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const property_users = await Property.updatePropertyUsers(req.params.propertyId, req.body);
    return res.status(201).json({ property_users });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;