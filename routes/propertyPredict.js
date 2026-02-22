"use strict";

const express = require("express");
const { ensureLoggedIn } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const OpenAI = require("openai");
const AccountUsageEvent = require("../models/accountUsageEvent");
const { logAiUsage } = require("../services/usageService");
const db = require("../db");

const router = new express.Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AI_MODEL = "gpt-4o-mini";
const DEFAULT_MONTHLY_CAP = 5.00;

const IDENTITY_FIELDS_SCHEMA = `{
  "propertyType": "<string e.g. Single Family, Townhouse, Condo, Multi-Family>",
  "subType": "<string e.g. Residential>",
  "roofType": "<string e.g. Composition, Tile, Metal>",
  "yearBuilt": <integer or null>,
  "effectiveYearBuilt": <integer or null>,
  "effectiveYearBuiltSource": "<string e.g. Public Records>",
  "sqFtTotal": <number or null>,
  "sqFtFinished": <number or null>,
  "sqFtUnfinished": <number or null>,
  "garageSqFt": <number or null>,
  "totalDwellingSqFt": <number or null>,
  "lotSize": "<string e.g. .200 ac / 8,700 sf>",
  "bedCount": <integer or null>,
  "bathCount": <integer or null>,
  "fullBaths": <integer or null>,
  "threeQuarterBaths": <integer or null>,
  "halfBaths": <integer or null>,
  "numberOfShowers": <integer or null>,
  "numberOfBathtubs": <integer or null>,
  "fireplaces": <integer or null>,
  "fireplaceTypes": "<string or empty>",
  "basement": "<string e.g. Daylight, Fully Finished, None>",
  "parkingType": "<string e.g. Attached Garage, Driveway Parking>",
  "totalCoveredParking": <integer or null>,
  "totalUncoveredParking": <integer or null>,
  "schoolDistrict": "<string>",
  "elementarySchool": "<string>",
  "juniorHighSchool": "<string>",
  "seniorHighSchool": "<string>",
  "confidence": "<low|medium|high>",
  "reasoning": "<brief one-sentence explanation>"
}`;

async function getUserAccountId(userId) {
  const result = await db.query(
    `SELECT account_id FROM account_users WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.account_id || null;
}

/** POST /property-details - Predict property fields from partial data. Body: property info. Enforces monthly AI budget. */
router.post("/property-details", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new BadRequestError("Authentication required");

    const accountId = await getUserAccountId(userId);
    if (!accountId) throw new BadRequestError("No account found for user");

    const propertyInfo = req.body;
    if (!propertyInfo || Object.keys(propertyInfo).length === 0) {
      throw new BadRequestError("Property information is required");
    }

    const spent = await AccountUsageEvent.getMonthlySpend(accountId);
    const remaining = Math.max(0, DEFAULT_MONTHLY_CAP - spent);
    if (remaining <= 0) {
      return res.status(429).json({
        error: {
          message: `Monthly AI budget exhausted. You have spent $${spent.toFixed(2)} of your $${DEFAULT_MONTHLY_CAP.toFixed(2)} limit. Resets on the 1st of next month.`,
          status: 429,
          code: "BUDGET_EXCEEDED",
          spent,
          cap: DEFAULT_MONTHLY_CAP,
        },
      });
    }

    const prompt = `You are a real-estate property data analyst with access to US public records. Given the following property information, predict as many property details as you can. Use the address, city, state, zip, county, property type, and any other provided data to infer realistic values. For fields you cannot reasonably predict, use null for numbers and empty string for text.

Property data provided:
${JSON.stringify(propertyInfo, null, 2)}

Respond ONLY with a valid JSON object in this exact shape (no markdown, no explanation):
${IDENTITY_FIELDS_SCHEMA}`;

    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 800,
    });

    const usage = completion.usage || {};
    await logAiUsage({
      accountId,
      userId,
      model: `openai/${AI_MODEL}`,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      endpoint: "predict/property-details",
    });

    const raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      throw new BadRequestError("No prediction returned from AI");
    }

    let prediction;
    try {
      prediction = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        prediction = JSON.parse(jsonMatch[0]);
      } else {
        throw new BadRequestError("AI returned invalid format");
      }
    }

    const updatedSpent = await AccountUsageEvent.getMonthlySpend(accountId);
    const updatedRemaining = Math.max(0, DEFAULT_MONTHLY_CAP - updatedSpent);

    return res.json({
      prediction,
      usage: {
        spent: updatedSpent,
        remaining: updatedRemaining,
        cap: DEFAULT_MONTHLY_CAP,
      },
    });
  } catch (err) {
    if (err instanceof BadRequestError) return next(err);
    if (err.status === 429) return next(err);
    console.error("OpenAI prediction error:", err);
    return next(new BadRequestError("Failed to generate prediction. Please try again."));
  }
});

/** GET /usage - Current account's AI usage and remaining budget. */
router.get("/usage", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new BadRequestError("Authentication required");

    const accountId = await getUserAccountId(userId);
    if (!accountId) throw new BadRequestError("No account found for user");

    const spent = await AccountUsageEvent.getMonthlySpend(accountId);
    const remaining = Math.max(0, DEFAULT_MONTHLY_CAP - spent);

    return res.json({
      usage: { allowed: remaining > 0, spent, remaining, cap: DEFAULT_MONTHLY_CAP },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
