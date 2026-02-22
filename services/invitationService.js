"use strict";

/**
 * Invitation Service
 *
 * Orchestrates invitation creation and acceptance. Creates property or
 * account invitations with token hashing, expiry, and full acceptance
 * flow (user creation, account linking, subscription, contact).
 *
 * Exports: createPropertyInvitation, createAccountInvitation, acceptInvitation
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
const { BadRequestError } = require("../expressError");
const { BCRYPT_WORK_FACTOR } = require("../config");
const Subscription = require("../models/subscription");
const SubscriptionProduct = require("../models/subscriptionProduct");

async function createPropertyInvitation({ inviterUserId, inviteeEmail, accountId, propertyId, intendedRole }) {
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

async function acceptInvitation({ rawToken, password, name }) {
  const invitation = await Invitation.validateToken(rawToken);

  await db.query("BEGIN");
  try {
    let user;
    const existingUser = await db.query(
      `SELECT id, email, is_active FROM users WHERE email = $1`,
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
        await Account.addUserToAccount({
          userId: user.id,
          accountId: accepted.accountId,
          role: accepted.intendedRole || 'member',
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

module.exports = {
  createPropertyInvitation,
  createAccountInvitation,
  acceptInvitation,
};
