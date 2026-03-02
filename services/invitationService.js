"use strict";

/**
 * Invitation Service
 *
 * Orchestrates invitation creation and acceptance. Creates property or
 * account invitations with token hashing, expiry, and full acceptance
 * flow (user creation, account linking, subscription, contact).
 *
 * Exports: createPropertyInvitation, createAccountInvitation, acceptInvitation, acceptInvitationForLoggedInUser
 */

const db = require("../db");
const crypto = require("crypto");
const { generateInvitationToken } = require("../helpers/invitationTokens");
const Invitation = require("../models/invitation");
const Account = require("../models/account");
const Contact = require("../models/contact");
const Property = require("../models/property");
const User = require("../models/user");
const bcrypt = require("bcrypt");
const { BadRequestError, ForbiddenError } = require("../expressError");
const { BCRYPT_WORK_FACTOR } = require("../config");
const Subscription = require("../models/subscription");
const SubscriptionProduct = require("../models/subscriptionProduct");
const { onUserCreated } = require("./resourceAutoSend");
const Notification = require("../models/notification");

const VALID_ACCOUNT_ROLES = new Set(["owner", "admin", "member", "view_only"]);

/** Map invitation intendedRole to account_role. Property invitations use editor/viewer; account uses owner/admin/member/view_only. */
function mapToAccountRole(intendedRole, invitationType) {
  const r = (intendedRole || "").toLowerCase();
  if (VALID_ACCOUNT_ROLES.has(r)) return r;
  if (invitationType === "property") {
    if (r === "viewer") return "view_only";
    return "member";
  }
  return "member";
}

async function createPropertyInvitation({ inviterUserId, inviteeEmail, accountId, propertyId, intendedRole }) {
  const emailLower = (inviteeEmail || "").trim().toLowerCase();
  if (!emailLower) throw new BadRequestError("inviteeEmail is required");

  // Prevent duplicate: user already in property team
  const existingMember = await db.query(
    `SELECT 1 FROM property_users pu
     JOIN users u ON u.id = pu.user_id
     WHERE pu.property_id = $1 AND LOWER(TRIM(u.email)) = $2`,
    [propertyId, emailLower]
  );
  if (existingMember.rows.length > 0) {
    throw new BadRequestError("This person is already on the property team.");
  }

  // Prevent duplicate: pending invitation already exists for this email
  const pendingInv = await db.query(
    `SELECT 1 FROM invitations
     WHERE property_id = $1 AND status = 'pending' AND LOWER(TRIM(invitee_email)) = $2`,
    [propertyId, emailLower]
  );
  if (pendingInv.rows.length > 0) {
    throw new BadRequestError("An invitation has already been sent to this email address.");
  }

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48);

  const invitation = await Invitation.create({
    type: 'property',
    inviterUserId,
    inviteeEmail,
    accountId,
    propertyId,
    intendedRole: intendedRole || 'editor',
    tokenHash,
    expiresAt,
  });

  // If invitee is an existing user, create in-app notification for bell icon
  const existingUser = await db.query(
    `SELECT id FROM users WHERE email = $1 AND is_active = true`,
    [inviteeEmail]
  );
  if (existingUser.rows.length > 0) {
    const inviteeUserId = existingUser.rows[0].id;
    try {
      await Notification.create({
        userId: inviteeUserId,
        type: 'property_invitation',
        title: "You've been invited to join a property",
        invitationId: invitation.id,
      });
    } catch (notifErr) {
      console.error("[invitationService] Failed to create notification for invitee:", notifErr.message);
    }
  }

  return { invitation, token };
}

async function createAccountInvitation({ inviterUserId, inviteeEmail, accountId, intendedRole }) {
  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48);

  const invitation = await Invitation.create({
    type: 'account',
    inviterUserId,
    inviteeEmail,
    accountId,
    propertyId: null,
    intendedRole: intendedRole || 'member',
    tokenHash,
    expiresAt,
  });

  return { invitation, token };
}

async function acceptInvitation({ rawToken, password, name, invitation: preFetchedInvitation, userId: preFetchedUserId }) {
  let invitation;
  let user;
  if (preFetchedInvitation && preFetchedUserId) {
    invitation = preFetchedInvitation;
    const existingUser = await db.query(
      `SELECT id, email, name, role, is_active FROM users WHERE id = $1`,
      [preFetchedUserId]
    );
    if (existingUser.rows.length === 0) throw new BadRequestError("User not found");
    user = existingUser.rows[0];
  } else {
    invitation = await Invitation.validateToken(rawToken);
  }

  await db.query("BEGIN");
  try {
    if (!user) {
      const existingUser = await db.query(
        `SELECT id, email, name, role, is_active FROM users WHERE email = $1`,
        [invitation.inviteeEmail]
      );

      if (existingUser.rows.length > 0) {
        user = existingUser.rows[0];
        if (!user.is_active && password) {
          const hashedPassword = await bcrypt.hash(password, BCRYPT_WORK_FACTOR);
          await db.query(
            `UPDATE users SET password_hash = $1, is_active = true WHERE id = $2`,
            [hashedPassword, user.id]
          );
        }

        const hasAccount = await User.userHasAccount(user.id);
        if (!hasAccount) {
          const userName = name || user.name || invitation.inviteeEmail;
          const newAccount = await Account.linkNewUserToAccount({ name: userName, userId: user.id });

          try {
            const productName = (user.role === 'agent') ? 'professional' : 'basic';
            const product = await SubscriptionProduct.getByName(productName)
              || await SubscriptionProduct.getByName("basic");
            if (product) {
              const today = new Date();
              const endDate = new Date(today);
              endDate.setMonth(endDate.getMonth() + 1);
              await Subscription.create({
                accountId: newAccount.id,
                subscriptionProductId: product.id,
                status: "active",
                currentPeriodStart: today.toISOString(),
                currentPeriodEnd: endDate.toISOString(),
              });
            }
          } catch (subErr) {
            console.error("Warning: failed to auto-create subscription for existing user account", newAccount.id, subErr.message);
          }

          const existingContact = await Contact.getByEmailAndAccount(
            invitation.inviteeEmail,
            newAccount.id
          );
          if (!existingContact) {
            const contact = await Contact.create({
              name: userName,
              email: invitation.inviteeEmail,
            });
            await Contact.addToAccount({ contactId: contact.id, accountId: newAccount.id });
            await User.update({ id: user.id, contact: contact.id });
          }
        }
      } else {
        if (!password || !name) {
        throw new BadRequestError("Name and password are required for new users");
      }
      const newUser = await User.register({
        name,
        email: invitation.inviteeEmail,
        password,
        role: 'homeowner',
        is_active: true,
      });
      user = newUser;
      const newAccount = await Account.linkNewUserToAccount({ name, userId: user.id });

      try {
        const productName = (user.role === 'agent') ? 'professional' : 'basic';
        const product = await SubscriptionProduct.getByName(productName)
          || await SubscriptionProduct.getByName("basic");
        if (product) {
          const today = new Date();
          const endDate = new Date(today);
          endDate.setMonth(endDate.getMonth() + 1);
          await Subscription.create({
            accountId: newAccount.id,
            subscriptionProductId: product.id,
            status: "active",
            currentPeriodStart: today.toISOString(),
            currentPeriodEnd: endDate.toISOString(),
          });
        }
      } catch (subErr) {
        console.error("Warning: failed to auto-create subscription for invited user account", newAccount.id, subErr.message);
      }

        const contact = await Contact.create({
          name,
          email: invitation.inviteeEmail,
        });
        await Contact.addToAccount({ contactId: contact.id, accountId: newAccount.id });
        await User.update({ id: user.id, contact: contact.id });

        try {
          await onUserCreated({ userId: user.id, role: user.role || "homeowner" });
        } catch (autoErr) {
          console.error("[resourceAutoSend] acceptInvitation new user:", autoErr.message);
        }
      }
    }

    const accepted = await Invitation.accept(invitation.id, user.id);

    if (accepted.type === 'property' && accepted.propertyId) {
      await Property.addUserToProperty({
        property_id: accepted.propertyId,
        user_id: user.id,
        role: accepted.intendedRole || 'editor',
      });
    }

    if (accepted.accountId) {
      const isLinked = await Account.isUserLinkedToAccount(user.id, accepted.accountId);
      if (!isLinked) {
        const accountRole = mapToAccountRole(accepted.intendedRole, accepted.type);
        await Account.addUserToAccount({
          userId: user.id,
          accountId: accepted.accountId,
          role: accountRole,
        });
      }

      const existingContact = await Contact.getByEmailAndAccount(
        invitation.inviteeEmail,
        accepted.accountId
      );
      if (!existingContact) {
        const inviterContact = await Contact.create({
          name: user.name || invitation.inviteeEmail,
          email: invitation.inviteeEmail,
        });
        await Contact.addToAccount({ contactId: inviterContact.id, accountId: accepted.accountId });
      }
    }

    await db.query("COMMIT");
    return { user, invitation: accepted };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

/** Accept invitation for logged-in user (no token). Used when invitee is already in the platform. */
async function acceptInvitationForLoggedInUser(invitationId, userId, userEmail) {
  const invitation = await Invitation.get(invitationId);
  if (invitation.status !== 'pending') {
    throw new BadRequestError("Invitation is no longer pending");
  }
  if (new Date(invitation.expiresAt) <= new Date()) {
    throw new BadRequestError("Invitation has expired");
  }
  if (invitation.inviteeEmail.toLowerCase() !== (userEmail || '').toLowerCase()) {
    throw new ForbiddenError("This invitation was sent to a different email address");
  }
  return acceptInvitation({ invitation, userId });
}

module.exports = {
  createPropertyInvitation,
  createAccountInvitation,
  acceptInvitation,
  acceptInvitationForLoggedInUser,
};
