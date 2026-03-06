"use strict";

/**
 * Contractor Report Routes (PUBLIC — no JWT required)
 *
 * These endpoints are accessed by contractors via a token link sent by email.
 * Authentication is done via the token itself (hashed, with expiry).
 *
 * GET  /contractor-report/:token  — Load report form data for the contractor
 * POST /contractor-report/:token  — Submit the completed report
 */

const express = require("express");
const ContractorReportToken = require("../models/contractorReportToken");
const MaintenanceRecord = require("../models/maintenanceRecord");
const { BadRequestError } = require("../expressError");

const router = express.Router();

const SYSTEM_LABELS = {
  roof: "Roof", gutters: "Gutters", foundation: "Foundation",
  exterior: "Exterior", windows: "Windows", heating: "Heating",
  ac: "Air Conditioning", waterHeating: "Water Heating",
  electrical: "Electrical", plumbing: "Plumbing",
  safety: "Safety", inspections: "Inspections",
};

/** GET /:token — Load the maintenance record data for the contractor to fill out */
router.get("/:token", async function (req, res, next) {
  try {
    const tokenData = await ContractorReportToken.validateToken(req.params.token);

    const data = tokenData.recordData || {};
    res.json({
      tokenId: tokenData.id,
      maintenanceRecordId: tokenData.maintenanceRecordId,
      contractorName: tokenData.contractorName,
      contractorEmail: tokenData.contractorEmail,
      propertyAddress: [tokenData.propertyAddress, tokenData.propertyCity, tokenData.propertyState].filter(Boolean).join(", "),
      propertyName: tokenData.propertyName,
      systemKey: tokenData.systemKey,
      systemName: SYSTEM_LABELS[tokenData.systemKey] || tokenData.systemKey,
      existingData: {
        description: data.description || "",
        workOrderNumber: data.workOrderNumber || "",
        priority: data.priority || "Medium",
        cost: data.cost || "",
        materialsUsed: data.materialsUsed || "",
        notes: data.notes || "",
        contractor: data.contractor || tokenData.contractorName || "",
        contractorEmail: data.contractorEmail || tokenData.contractorEmail || "",
        contractorPhone: data.contractorPhone || "",
      },
      status: tokenData.recordStatus || "Pending Contractor",
      completedAt: tokenData.completedAt,
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /:token — Contractor submits their completed report */
router.post("/:token", async function (req, res, next) {
  try {
    const tokenData = await ContractorReportToken.validateToken(req.params.token);

    const {
      description, workOrderNumber, cost, materialsUsed,
      notes, status, completedAt, nextServiceDate,
    } = req.body;

    if (!description || !description.trim()) {
      throw new BadRequestError("Work description is required");
    }

    const existingRecord = await MaintenanceRecord.getByRecordId(tokenData.maintenanceRecordId);
    const existingData = existingRecord.data || {};

    const updatedData = {
      ...existingData,
      description: description?.trim() || existingData.description,
      workOrderNumber: workOrderNumber ?? existingData.workOrderNumber,
      cost: cost ?? existingData.cost,
      materialsUsed: materialsUsed ?? existingData.materialsUsed,
      notes: notes ?? existingData.notes,
      contractorSubmittedAt: new Date().toISOString(),
    };

    const updatedRecord = await MaintenanceRecord.update(tokenData.maintenanceRecordId, {
      property_id: existingRecord.property_id,
      system_key: existingRecord.system_key,
      completed_at: completedAt || existingRecord.completed_at || new Date().toISOString(),
      next_service_date: nextServiceDate || existingRecord.next_service_date,
      data: updatedData,
      status: status || "Completed",
      record_status: "contractor_completed",
    });

    await ContractorReportToken.markCompleted(tokenData.id);

    res.json({
      success: true,
      message: "Report submitted successfully. The homeowner will be notified.",
      record: {
        id: updatedRecord.id,
        status: updatedRecord.status,
        record_status: updatedRecord.record_status,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
