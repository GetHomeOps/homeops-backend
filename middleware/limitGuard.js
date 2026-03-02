"use strict";

/**
 * Limit Guard Middleware
 *
 * requireWithinLimit('properties') - blocks if account at property limit
 * requireWithinLimit('contacts') - blocks if account at contact limit
 * Requires accountId in req.body or res.locals.accountId.
 */

const { ForbiddenError } = require("../expressError");
const { canCreateProperty, canAddContact, checkAiTokenQuota } = require("../services/tierService");

function requireWithinLimit(limitType) {
  return async function (req, res, next) {
    try {
      const accountId = req.body?.account_id ?? res.locals?.accountId ?? req.params?.accountId;
      const userId = res.locals?.user?.id;
      if (!accountId && userId && limitType === "ai_tokens") {
        const check = await checkAiTokenQuota(userId);
        if (!check.allowed) {
          throw new ForbiddenError(
            `AI token quota exceeded (${check.used}/${check.quota} this month). Upgrade your plan for more.`
          );
        }
        return next();
      }
      if (!accountId) return next();

      if (limitType === "properties") {
        const check = await canCreateProperty(accountId);
        if (!check.allowed) {
          throw new ForbiddenError(`Property limit reached (${check.current}/${check.max}). Upgrade your plan.`);
        }
      } else if (limitType === "contacts") {
        const check = await canAddContact(accountId);
        if (!check.allowed) {
          throw new ForbiddenError(`Contact limit reached (${check.current}/${check.max}). Upgrade your plan.`);
        }
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireWithinLimit };
