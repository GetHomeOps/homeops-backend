# Backend: Maintenance Record Status Field

## Summary

Add a `record_status` column to the `property_maintenance` table. Minimal backend changes—just add the column and pass it through on create/update/read. The frontend handles all status logic.

## Schema Change

**Table:** `property_maintenance`
**New column:** `record_status`
**Type:** `VARCHAR(50)` or `TEXT` (nullable)
**Allowed values:** `draft` | `user_completed` | `contractor_pending`

## API Contract

- **Create/Update:** Accept `record_status` as a top-level field in the payload. Store it in the new column.
- **Read:** Return `record_status` at the top level in API responses.

No normalization or migration of existing data required. Default `null` for new/old records—the frontend treats `null` as `draft`.
