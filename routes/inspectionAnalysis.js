"use strict";

const express = require("express");
const db = require("../db");
const { ensureLoggedIn } = require("../middleware/auth");
const { BadRequestError, ForbiddenError } = require("../expressError");
const InspectionAnalysisJob = require("../models/inspectionAnalysisJob");
const InspectionAnalysisResult = require("../models/inspectionAnalysisResult");

const router = express.Router();

/** GET /jobs/:jobId - Get job status and result. */
router.get(
  "/jobs/:jobId",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const jobId = parseInt(req.params.jobId, 10);
      if (isNaN(jobId)) {
        throw new BadRequestError("Invalid job ID");
      }

      const job = await InspectionAnalysisJob.get(jobId);

      const userId = res.locals.user.id;
      if (res.locals.user.role !== "super_admin" && res.locals.user.role !== "admin") {
        const accessCheck = await db.query(
          `SELECT 1 FROM property_users WHERE property_id = $1 AND user_id = $2`,
          [job.property_id, userId]
        );
        if (accessCheck.rows.length === 0) {
          throw new ForbiddenError("You do not have access to this property.");
        }
      }

      const response = {
        status: job.status,
        progress: job.progress,
        errorMessage: job.error_message,
      };

      if (job.status === "completed") {
        const result = await InspectionAnalysisResult.getByJobId(jobId);
        if (result) {
          response.result = {
            conditionRating: result.condition_rating,
            conditionConfidence: result.condition_confidence,
            conditionRationale: result.condition_rationale,
            systemsDetected: result.systems_detected,
            needsAttention: result.needs_attention,
            suggestedSystemsToAdd: result.suggested_systems_to_add,
            maintenanceSuggestions: result.maintenance_suggestions,
            summary: result.summary,
            citations: result.citations,
            createdAt: result.created_at,
          };
        }
      }

      return res.json(response);
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
