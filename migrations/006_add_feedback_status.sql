-- Extend support_tickets to support feedback and expanded support statuses.
-- Run: psql -d your_database -f migrations/006_add_feedback_status.sql
--
-- Support: new, working_on_it, waiting_on_user, resolved, closed
-- Feedback: new, under_review, planned, implemented, rejected

-- Drop existing check constraint and add expanded one
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_status_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN (
    'new', 'working_on_it', 'solved',
    'waiting_on_user', 'resolved', 'closed',
    'under_review', 'planned', 'implemented', 'rejected'
  ));
