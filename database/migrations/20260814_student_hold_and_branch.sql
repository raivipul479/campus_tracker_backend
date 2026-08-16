-- Adds two student fields:
--
--   on_hold  When set, the student disappears from the driver's roster and the
--            driver can no longer log a pickup or drop for them. Admin and
--            parent views are deliberately unaffected — an admin has to be able
--            to see a held student in order to release the hold.
--
--   branch   JPC or JPIC. The parent app uses this to decide which of the two
--            payment buttons to show, so the values must stay in step with what
--            the mobile app switches on.
--
-- on_hold is NOT NULL with a default so existing rows become "not held", which
-- preserves current behaviour. branch is nullable because existing students
-- have no branch recorded yet.

ALTER TABLE students
  ADD COLUMN on_hold TINYINT(1) NOT NULL DEFAULT 0 AFTER address,
  ADD COLUMN branch ENUM('JPC', 'JPIC') NULL AFTER on_hold,
  ADD INDEX idx_students_on_hold (on_hold);
