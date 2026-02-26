-- Fix property_users: set role to 'owner' for the first team member when a property has no owner.
-- Run: psql $DATABASE_URL -f migrations/011_fix_property_owner_role.sql
-- This corrects properties where the creator was incorrectly saved as 'editor' instead of 'owner'.

WITH properties_without_owner AS (
  SELECT property_id
  FROM property_users
  GROUP BY property_id
  HAVING NOT EXISTS (
    SELECT 1 FROM property_users pu2
    WHERE pu2.property_id = property_users.property_id AND pu2.role = 'owner'
  )
),
first_member_per_property AS (
  SELECT DISTINCT ON (property_id) property_id, user_id
  FROM property_users
  WHERE property_id IN (SELECT property_id FROM properties_without_owner)
  ORDER BY property_id, created_at
)
UPDATE property_users pu
SET role = 'owner', updated_at = NOW()
FROM first_member_per_property f
WHERE pu.property_id = f.property_id AND pu.user_id = f.user_id;
