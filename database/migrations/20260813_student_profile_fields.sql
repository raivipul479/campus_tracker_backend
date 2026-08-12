-- Adds section, guardian (father's/mother's) name, and full postal address to
-- the students table.
--
-- All three are nullable, so this is safe to run against a populated table and
-- the existing API stays backwards-compatible.
--
-- Notes on the two address-shaped columns:
--   `area`    stays as-is: the short locality already required by the app
--             (NOT NULL, used in list filters and search).
--   `address` is the new full postal address. It is deliberately a separate
--             column rather than a widened `area`, so nothing that already
--             reads `area` changes meaning.
--
-- `section` is separate from `class_name` rather than parsed out of it. Legacy
-- rows may still carry a combined value ("V D") in class_name; new writes put
-- the class in class_name and the section here.

ALTER TABLE students
  ADD COLUMN section VARCHAR(16) NULL AFTER class_name,
  ADD COLUMN guardian_name VARCHAR(160) NULL AFTER section,
  ADD COLUMN address VARCHAR(255) NULL AFTER area;
