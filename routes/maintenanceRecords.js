"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensurePropertyAccess } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const MaintenanceRecord = require("../models/maintenanceRecord");
const ContractorReportToken = require("../models/contractorReportToken");
const { triggerReanalysisOnMaintenance } = require("../services/ai/propertyReanalysisService");
const InspectionChecklistItem = require("../models/inspectionChecklistItem");
const { generateInvitationToken } = require("../helpers/invitationTokens");
const { sendContractorReportEmail } = require("../services/emailService");
const { APP_BASE_URL } = require("../config");
const db = require("../db");
const maintenanceRecordNewSchema = require("../schemas/maintenanceRecordNew.json");
const maintenanceRecordsBatchSchema = require("../schemas/maintenanceRecordsBatch.json");
const maintenanceRecordUpdateSchema = require("../schemas/maintenanceRecord.json");
const router = express.Router();

/** Set req.params.propertyId from maintenance record id so ensurePropertyAccess can run. */
async function loadPropertyIdFromRecord(req, res, next) {
  try {
    const record = await MaintenanceRecord.getByRecordId(req.params.recordId);
    req.params.propertyId = record.property_id;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** POST /:PropertyId - Create multiple maintenance records (batch). Body: { maintenanceRecords: [...] }. */
router.post("/:PropertyId", ensureLoggedIn, ensurePropertyAccess({ param: "PropertyId" }), async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, maintenanceRecordsBatchSchema);
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }
    const { maintenanceRecords } = req.body;
    const created = await MaintenanceRecord.createMany(maintenanceRecords);
    // Trigger AI reanalysis per property (async, non-blocking)
    const byProperty = new Map();
    for (const r of created) {
      if (!byProperty.has(r.property_id)) byProperty.set(r.property_id, []);
      byProperty.get(r.property_id).push(r);
    }
    for (const [propId, records] of byProperty) {
      for (const rec of records) {
        triggerReanalysisOnMaintenance(propId, rec).catch((err) =>
          console.error("[propertyReanalysis] Maintenance trigger failed:", err.message)
        );
      }
    }
    return res.status(201).json({ maintenanceRecords: created });
  } catch (err) {
    return next(err);
  }
});

/** POST /record/:PropertyId - Create single maintenance record. */
router.post("/record/:PropertyId", ensureLoggedIn, ensurePropertyAccess({ param: "PropertyId" }), async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, maintenanceRecordNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }
    const propertyId = req.params.PropertyId;
    const maintenanceRecord = await MaintenanceRecord.create({
      ...req.body,
      property_id: propertyId,
    });

    const checklistItemId = req.body.checklist_item_id || (req.body.data && req.body.data.checklist_item_id);
    if (checklistItemId && maintenanceRecord.status === "Completed") {
      InspectionChecklistItem.complete(checklistItemId, {
        userId: res.locals.user?.id,
        maintenanceId: maintenanceRecord.id,
      }).catch((err) => console.error("[inspectionChecklist] Auto-complete failed:", err.message));
    } else if (checklistItemId) {
      InspectionChecklistItem.update(checklistItemId, {
        status: "in_progress",
        linked_maintenance_id: maintenanceRecord.id,
      }).catch((err) => console.error("[inspectionChecklist] Auto-link failed:", err.message));
    }

    triggerReanalysisOnMaintenance(propertyId, maintenanceRecord).catch((err) =>
      console.error("[propertyReanalysis] Maintenance trigger failed:", err.message)
    );
    return res.status(201).json({ maintenanceRecord });
  } catch (err) {
    return next(err);
  }
});

/** GET /:PropertyId - List maintenance records for property. */
router.get("/:PropertyId", ensureLoggedIn, ensurePropertyAccess({ param: "PropertyId" }), async function (req, res, next) {
  try {
    const { PropertyId } = req.params;
    const maintenanceRecords = await MaintenanceRecord.getByPropertyId(PropertyId);
    return res.json({ maintenanceRecords });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:recordId - Update maintenance record. Body: property_id, system_key, completed_at, etc. */
router.patch("/:recordId", ensureLoggedIn, loadPropertyIdFromRecord, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const { recordId } = req.params;
    const validator = jsonschema.validate(req.body, maintenanceRecordUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }
    const maintenance = await MaintenanceRecord.update(recordId, req.body);

    const checklistItemId = req.body.checklist_item_id || (req.body.data && req.body.data.checklist_item_id);
    if (checklistItemId && maintenance.status === "Completed") {
      InspectionChecklistItem.complete(checklistItemId, {
        userId: res.locals.user?.id,
        maintenanceId: maintenance.id,
      }).catch((err) => console.error("[inspectionChecklist] Auto-complete failed:", err.message));
    }

    triggerReanalysisOnMaintenance(maintenance.property_id, maintenance).catch((err) =>
      console.error("[propertyReanalysis] Maintenance trigger failed:", err.message)
    );
    return res.json({ maintenance });
  } catch (err) {
    return next(err);
  }
});

/** POST /:recordId/send-to-contractor - Send maintenance report link to contractor via email. */
router.post("/:recordId/send-to-contractor", ensureLoggedIn, loadPropertyIdFromRecord, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const { recordId } = req.params;
    const record = await MaintenanceRecord.getByRecordId(recordId);
    const data = record.data || {};

    const contractorEmail = req.body.contractorEmail || data.contractorEmail;
    const contractorName = req.body.contractorName || data.contractor;

    if (!contractorEmail) {
      throw new BadRequestError("Contractor email is required to send the report link.");
    }

    // Revoke any existing pending tokens for this record
    const existingTokens = await ContractorReportToken.getByRecordId(recordId, { status: "pending" });
    for (const t of existingTokens) {
      await ContractorReportToken.revoke(t.id);
    }

    const { token, tokenHash } = generateInvitationToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const tokenRecord = await ContractorReportToken.create({
      maintenanceRecordId: record.id,
      propertyId: record.property_id,
      contractorEmail,
      contractorName,
      tokenHash,
      expiresAt,
      createdBy: res.locals.user?.id,
    });

    // Update record status to contractor_pending
    await MaintenanceRecord.update(recordId, {
      ...record,
      data: { ...data, requestStatus: "pending" },
      record_status: "contractor_pending",
    });

    // Build report URL and send email
    const baseUrl = (APP_BASE_URL || process.env.APP_WEB_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
    const reportUrl = `${baseUrl}/#/contractor-report?token=${encodeURIComponent(token)}`;

    // Fetch property and sender info for the email
    const propResult = await db.query(`SELECT address, city, state FROM properties WHERE id = $1`, [record.property_id]);
    const prop = propResult.rows[0];
    const propertyAddress = prop ? [prop.address, prop.city, prop.state].filter(Boolean).join(", ") : null;

    const senderResult = await db.query(`SELECT name FROM users WHERE id = $1`, [res.locals.user.id]);
    const senderName = senderResult.rows[0]?.name || null;

    const SYSTEM_LABELS = {
      roof: "Roof", gutters: "Gutters", foundation: "Foundation",
      exterior: "Exterior", windows: "Windows", heating: "Heating",
      ac: "Air Conditioning", waterHeating: "Water Heating",
      electrical: "Electrical", plumbing: "Plumbing",
      safety: "Safety", inspections: "Inspections",
    };

    try {
      await sendContractorReportEmail({
        to: contractorEmail,
        reportUrl,
        contractorName,
        propertyAddress,
        systemName: SYSTEM_LABELS[record.system_key] || record.system_key,
        senderName,
      });
    } catch (emailErr) {
      console.error("[maintenanceRecords] Failed to send contractor report email:", emailErr.message);
    }

    return res.json({
      success: true,
      message: "Report link sent to contractor.",
      tokenId: tokenRecord.id,
      expiresAt: tokenRecord.expiresAt,
    });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:recordId - Delete maintenance record. */
router.delete("/:recordId", ensureLoggedIn, loadPropertyIdFromRecord, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const { recordId } = req.params;
    await MaintenanceRecord.delete(recordId);
    return res.json({ deleted: recordId });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;