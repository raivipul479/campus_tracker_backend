-- Renames the student branch values to the names the school actually uses.
--
-- JPC and JPIC were placeholders; the fee portals, and now the admin form and
-- the parent app, all speak of JPS and JPIS. Keeping two vocabularies for one
-- thing is how a parent ends up sent to the wrong school's payment page.
--
--   JPIC -> JPIS   (the International school; both carry the I)
--   JPC  -> JPS
--
-- Done in three steps because MySQL rejects an ENUM change that would strand
-- existing rows: widen to hold both vocabularies, move the data, then narrow.
-- Safe to re-run -- after the first pass the old values no longer exist, the
-- UPDATEs match nothing, and the final MODIFY is what the column already is.

ALTER TABLE students
  MODIFY COLUMN branch ENUM('JPC', 'JPIC', 'JPIS', 'JPS') NULL;

UPDATE students SET branch = 'JPIS' WHERE branch = 'JPIC';
UPDATE students SET branch = 'JPS'  WHERE branch = 'JPC';

ALTER TABLE students
  MODIFY COLUMN branch ENUM('JPIS', 'JPS') NULL;

SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students'
       AND COLUMN_NAME = 'branch'
       AND COLUMN_TYPE = "enum('JPIS','JPS')") AS column_want_1,
  (SELECT COUNT(*) FROM students WHERE branch = 'JPIS') AS students_jpis,
  (SELECT COUNT(*) FROM students WHERE branch = 'JPS')  AS students_jps,
  (SELECT COUNT(*) FROM students WHERE branch IS NULL)  AS students_unset;
