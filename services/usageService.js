"use strict";

/**
 * Usage Service
 *
 * Logs usage events for billing and metering. Supports AI tokens (OpenAI),
 * storage (S3 uploads), and email (SES). Writes to account_usage_events.
 *
 * Exports: logAiUsage, logStorageUsage, logEmailUsage, COST_RATES
 */

const AccountUsageEvent = require("../models/accountUsageEvent");

const COST_RATES = {
  'openai/gpt-4o': { prompt: 0.0025 / 1000, completion: 0.01 / 1000 },
  'openai/gpt-4o-mini': { prompt: 0.00015 / 1000, completion: 0.0006 / 1000 },
  's3/upload': 0.000023,
  'ses/email': 0.0001,
};

async function logAiUsage({ accountId, userId, model, promptTokens, completionTokens, endpoint }) {
  const rates = COST_RATES[model] || COST_RATES['openai/gpt-4o-mini'];
  const totalTokens = promptTokens + completionTokens;
  const unitCost = (rates.prompt * promptTokens + rates.completion * completionTokens) / totalTokens || 0;

  return AccountUsageEvent.log({
    accountId,
    userId,
    category: 'ai_tokens',
    resource: model || 'openai/gpt-4o-mini',
    quantity: totalTokens,
    unit: 'tokens',
    unitCost,
    metadata: { endpoint, promptTokens, completionTokens },
  });
}

async function logStorageUsage({ accountId, userId, fileSizeBytes, fileKey }) {
  return AccountUsageEvent.log({
    accountId,
    userId,
    category: 'storage',
    resource: 's3/upload',
    quantity: fileSizeBytes,
    unit: 'bytes',
    unitCost: COST_RATES['s3/upload'] / (1024 * 1024),
    metadata: { fileKey },
  });
}

async function logEmailUsage({ accountId, userId, emailType }) {
  return AccountUsageEvent.log({
    accountId,
    userId,
    category: 'email',
    resource: 'ses/email',
    quantity: 1,
    unit: 'count',
    unitCost: COST_RATES['ses/email'],
    metadata: { emailType },
  });
}

module.exports = { logAiUsage, logStorageUsage, logEmailUsage, COST_RATES };
