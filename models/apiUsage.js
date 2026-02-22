"use strict";

/**
 * ApiUsage Model
 *
 * Tracks AI/API usage per user in the `user_api_usage` table. Calculates
 * cost from token counts (GPT pricing) and enforces monthly spend caps.
 *
 * Key operations:
 * - record: Log an API call with tokens and cost
 * - getMonthlySpend: Total spend for current month
 * - checkBudget: Verify user is within monthly cap
 * - getHistory: Recent usage records
 */

const db = require("../db");

/** gpt-4o-mini pricing (per token) */
const MODEL_PRICING = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  "gpt-4o":      { input: 2.50 / 1_000_000, output: 10.0 / 1_000_000 },
};

const DEFAULT_MONTHLY_CAP = 5.00; // $5/month

class ApiUsage {
  /**
   * Calculate cost from token counts and model name.
   * @returns {number} cost in dollars
   */
  static calculateCost(model, promptTokens, completionTokens) {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING["gpt-4o-mini"];
    return (promptTokens * pricing.input) + (completionTokens * pricing.output);
  }

  /**
   * Get the user's total spend for the current calendar month.
   * @param {number} userId
   * @returns {Promise<number>} total cost this month in dollars
   */
  static async getMonthlySpend(userId) {
    const result = await db.query(
      `SELECT COALESCE(SUM(total_cost), 0)::numeric AS total
       FROM user_api_usage
       WHERE user_id = $1
         AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
      [userId],
    );
    return parseFloat(result.rows[0].total);
  }

  /**
   * Check if the user can make another API call without exceeding the monthly cap.
   * @param {number} userId
   * @param {number} [cap] - override default cap
   * @returns {Promise<{allowed: boolean, spent: number, remaining: number, cap: number}>}
   */
  static async checkBudget(userId, cap = DEFAULT_MONTHLY_CAP) {
    const spent = await this.getMonthlySpend(userId);
    const remaining = Math.max(0, cap - spent);
    return { allowed: remaining > 0, spent, remaining, cap };
  }

  /**
   * Record an API call's usage and cost.
   * @returns {Promise<Object>} the inserted row
   */
  static async record({ userId, endpoint, model, promptTokens, completionTokens }) {
    const totalCost = this.calculateCost(model, promptTokens, completionTokens);
    const result = await db.query(
      `INSERT INTO user_api_usage (user_id, endpoint, model, prompt_tokens, completion_tokens, total_cost)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, endpoint, model, promptTokens, completionTokens, totalCost],
    );
    return result.rows[0];
  }

  /**
   * Get usage history for a user (most recent first, limited).
   */
  static async getHistory(userId, limit = 50) {
    const result = await db.query(
      `SELECT * FROM user_api_usage
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return result.rows;
  }
}

module.exports = ApiUsage;
