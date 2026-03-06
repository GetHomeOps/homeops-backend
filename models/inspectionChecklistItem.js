"use strict";

const db = require("../db");
const { BadRequestError, NotFoundError } = require("../expressError");

class InspectionChecklistItem {

  /**
   * Auto-generate checklist items from an inspection analysis result.
   * Merges needs_attention and maintenance_suggestions into individual trackable rows.
   */
  static async generateFromAnalysis(analysisResult) {
    const { id: analysisResultId, property_id } = analysisResult;
    if (!analysisResultId || !property_id) {
      throw new BadRequestError("analysisResultId and property_id are required");
    }

    const needsAttention = analysisResult.needs_attention || [];
    const maintenanceSuggestions = analysisResult.maintenance_suggestions || [];

    const rows = [];

    for (let i = 0; i < needsAttention.length; i++) {
      const n = needsAttention[i];
      rows.push({
        analysis_result_id: analysisResultId,
        property_id,
        system_key: (n.systemType || "general").toLowerCase(),
        source: "needs_attention",
        source_index: i,
        title: n.title || n.suggestedAction || "Inspection finding",
        description: n.suggestedAction || null,
        severity: n.severity || "medium",
        priority: n.priority || "medium",
        suggested_when: null,
        evidence: n.evidence || null,
      });
    }

    for (let i = 0; i < maintenanceSuggestions.length; i++) {
      const m = maintenanceSuggestions[i];
      rows.push({
        analysis_result_id: analysisResultId,
        property_id,
        system_key: (m.systemType || "general").toLowerCase(),
        source: "maintenance_suggestion",
        source_index: i,
        title: m.task || "Maintenance task",
        description: m.rationale || null,
        severity: null,
        priority: m.priority || "medium",
        suggested_when: m.suggestedWhen || null,
        evidence: null,
      });
    }

    if (rows.length === 0) return [];

    const values = [];
    const placeholders = [];
    let paramIdx = 1;

    for (const row of rows) {
      placeholders.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
      );
      values.push(
        row.analysis_result_id, row.property_id, row.system_key,
        row.source, row.source_index, row.title,
        row.description, row.severity, row.priority,
        row.suggested_when, row.evidence
      );
    }

    const result = await db.query(
      `INSERT INTO inspection_checklist_items
         (analysis_result_id, property_id, system_key, source, source_index,
          title, description, severity, priority, suggested_when, evidence)
       VALUES ${placeholders.join(", ")}
       RETURNING *`,
      values
    );
    return result.rows;
  }

  /** Get all checklist items for a property, optionally filtered. */
  static async getByPropertyId(propertyId, { systemKey, status } = {}) {
    const conditions = ["property_id = $1"];
    const params = [propertyId];
    let idx = 2;

    if (systemKey) {
      conditions.push(`system_key = $${idx++}`);
      params.push(systemKey);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }

    const result = await db.query(
      `SELECT * FROM inspection_checklist_items
       WHERE ${conditions.join(" AND ")}
       ORDER BY
         CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at ASC`,
      params
    );
    return result.rows;
  }

  /** Get progress stats for a property. */
  static async getProgress(propertyId) {
    const result = await db.query(
      `SELECT
         system_key,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
         COUNT(*) FILTER (WHERE status = 'deferred')::int AS deferred,
         COUNT(*) FILTER (WHERE status = 'not_applicable')::int AS not_applicable
       FROM inspection_checklist_items
       WHERE property_id = $1
       GROUP BY system_key
       ORDER BY system_key`,
      [propertyId]
    );

    const bySystem = {};
    let total = 0;
    let completed = 0;
    let pending = 0;

    for (const row of result.rows) {
      bySystem[row.system_key] = {
        total: row.total,
        completed: row.completed,
        pending: row.pending,
        in_progress: row.in_progress,
        deferred: row.deferred,
        not_applicable: row.not_applicable,
      };
      total += row.total;
      completed += row.completed;
      pending += row.pending;
    }

    return { total, completed, pending, bySystem };
  }

  /** Get a single item by ID. */
  static async get(id) {
    const result = await db.query(
      `SELECT * FROM inspection_checklist_items WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError(`Checklist item ${id} not found`);
    }
    return result.rows[0];
  }

  /** Update status, notes, or linked_maintenance_id. */
  static async update(id, data) {
    const allowedFields = ["status", "notes", "linked_maintenance_id", "completed_at", "completed_by"];
    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${idx++}`);
        params.push(data[field]);
      }
    }

    if (setClauses.length === 0) {
      throw new BadRequestError("No valid fields to update");
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    const result = await db.query(
      `UPDATE inspection_checklist_items
       SET ${setClauses.join(", ")}
       WHERE id = $${idx}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      throw new NotFoundError(`Checklist item ${id} not found`);
    }
    return result.rows[0];
  }

  /**
   * Mark an item as completed, optionally linking to a maintenance record.
   */
  static async complete(id, { userId, maintenanceId = null, notes = null } = {}) {
    const updateData = {
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: userId || null,
    };
    if (maintenanceId !== null) updateData.linked_maintenance_id = maintenanceId;
    if (notes !== null) updateData.notes = notes;
    return this.update(id, updateData);
  }
}

module.exports = InspectionChecklistItem;
