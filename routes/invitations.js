"use strict";

const express = require("express");
const { ensureLoggedIn, ensurePropertyOwner } = require("../middleware/auth");
const { BadRequestError, ForbiddenError } = require("../expressError");
const Invitation = require("../models/invitation");
const { createPropertyInvitation, createAccountInvitation, acceptInvitation } = require("../services/invitationService");
const { canInviteViewer, canAddTeamMember } = require("../services/tierService");

const router = express.Router();

/** POST / - Create account or property invitation. Body: type, inviteeEmail, accountId, propertyId?, intendedRole. */
router.post("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const { type, inviteeEmail, accountId, propertyId, intendedRole } = req.body;
    if (!inviteeEmail || !accountId) {
      throw new BadRequestError("inviteeEmail and accountId are required");
    }

    const inviterUserId = res.locals.user.id;

    if (intendedRole === 'viewer' && propertyId) {
      const viewerCheck = await canInviteViewer(accountId, propertyId);
      if (!viewerCheck.allowed) {
        throw new ForbiddenError(`Viewer limit reached (${viewerCheck.current}/${viewerCheck.max}). Upgrade your plan.`);
      }
    }

    if (propertyId) {
      const teamCheck = await canAddTeamMember(accountId, propertyId);
      if (!teamCheck.allowed) {
        throw new ForbiddenError(`Team member limit reached (${teamCheck.current}/${teamCheck.max}). Upgrade your plan.`);
      }
    }

    let result;
    if (type === 'account') {
      result = await createAccountInvitation({ inviterUserId, inviteeEmail, accountId, intendedRole });
    } else {
      if (!propertyId) throw new BadRequestError("propertyId is required for property invitations");
      result = await createPropertyInvitation({ inviterUserId, inviteeEmail, accountId, propertyId, intendedRole });
    }

    return res.status(201).json({ invitation: result.invitation, token: result.token });
  } catch (err) {
    return next(err);
  }
});

/** POST /:id/accept - Accept invitation. Body: token, password, name. */
router.post("/:id/accept", async function (req, res, next) {
  try {
    const { token, password, name } = req.body;
    if (!token) throw new BadRequestError("Invitation token is required");
    const result = await acceptInvitation({ rawToken: token, password, name });
    return res.json({ success: true, message: "Invitation accepted", userId: result.user.id });
  } catch (err) {
    return next(err);
  }
});

/** POST /:id/decline - Decline invitation. */
router.post("/:id/decline", ensureLoggedIn, async function (req, res, next) {
  try {
    const result = await Invitation.decline(req.params.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

/** POST /:id/revoke - Revoke pending invitation. */
router.post("/:id/revoke", ensureLoggedIn, async function (req, res, next) {
  try {
    const result = await Invitation.revoke(req.params.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

/** GET /sent - List invitations sent by current user. */
router.get("/sent", ensureLoggedIn, async function (req, res, next) {
  try {
    const invitations = await Invitation.getSentByUser(res.locals.user.id);
    return res.json({ invitations });
  } catch (err) {
    return next(err);
  }
});

/** GET /property/:propertyId - List invitations for property. Query: status. */
router.get("/property/:propertyId", ensureLoggedIn, async function (req, res, next) {
  try {
    const { status } = req.query;
    const invitations = await Invitation.getByProperty(req.params.propertyId, { status });
    return res.json({ invitations });
  } catch (err) {
    return next(err);
  }
});

/** GET /account/:accountId - List invitations for account. Query: status. */
router.get("/account/:accountId", ensureLoggedIn, async function (req, res, next) {
  try {
    const { status } = req.query;
    const invitations = await Invitation.getByAccount(req.params.accountId, { status });
    return res.json({ invitations });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
