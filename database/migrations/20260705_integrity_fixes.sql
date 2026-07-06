-- Run once against existing databases before deploying the matching application build.
-- Resolve duplicate active rows, keeping the most recently assigned row active.
UPDATE driver_vehicle_assignments a
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY assigned_at DESC, id DESC) AS row_num
  FROM driver_vehicle_assignments WHERE unassigned_at IS NULL
) ranked ON ranked.id = a.id
SET a.unassigned_at = CURRENT_TIMESTAMP
WHERE ranked.row_num > 1;

UPDATE driver_vehicle_assignments a
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY assigned_at DESC, id DESC) AS row_num
  FROM driver_vehicle_assignments WHERE unassigned_at IS NULL
) ranked ON ranked.id = a.id
SET a.unassigned_at = CURRENT_TIMESTAMP
WHERE ranked.row_num > 1;

UPDATE student_vehicle_assignments a
JOIN student_route_assignments r ON r.student_id = a.student_id AND r.unassigned_at IS NULL
SET a.unassigned_at = CURRENT_TIMESTAMP
WHERE a.unassigned_at IS NULL;

UPDATE student_vehicle_assignments a
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY assigned_at DESC, id DESC) AS row_num
  FROM student_vehicle_assignments WHERE unassigned_at IS NULL
) ranked ON ranked.id = a.id
SET a.unassigned_at = CURRENT_TIMESTAMP
WHERE ranked.row_num > 1;

UPDATE student_route_assignments a
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY assigned_at DESC, id DESC) AS row_num
  FROM student_route_assignments WHERE unassigned_at IS NULL
) ranked ON ranked.id = a.id
SET a.unassigned_at = CURRENT_TIMESTAMP
WHERE ranked.row_num > 1;

ALTER TABLE drivers
  MODIFY docs_status ENUM('Verified', '1 expiring', '2 pending', 'ExpiringSoon', 'Pending', 'Expired') NOT NULL DEFAULT 'Pending';
UPDATE drivers SET docs_status = 'ExpiringSoon' WHERE docs_status = '1 expiring';
UPDATE drivers SET docs_status = 'Pending' WHERE docs_status = '2 pending';
ALTER TABLE drivers
  MODIFY docs_status ENUM('Verified', 'ExpiringSoon', 'Pending', 'Expired') NOT NULL DEFAULT 'Pending';

-- Canonicalize existing contact numbers. The deployment default for local
-- 10-digit numbers is India (+91), matching write-time validation.
UPDATE drivers
SET phone = CONCAT('+',
  CASE
    WHEN CHAR_LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 10
      THEN CONCAT('91', REGEXP_REPLACE(phone, '[^0-9]', ''))
    WHEN REGEXP_REPLACE(phone, '[^0-9]', '') LIKE '00%'
      THEN SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', ''), 3)
    ELSE REGEXP_REPLACE(phone, '[^0-9]', '')
  END
);

UPDATE students
SET phone = CONCAT('+',
  CASE
    WHEN CHAR_LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) = 10
      THEN CONCAT('91', REGEXP_REPLACE(phone, '[^0-9]', ''))
    WHEN REGEXP_REPLACE(phone, '[^0-9]', '') LIKE '00%'
      THEN SUBSTRING(REGEXP_REPLACE(phone, '[^0-9]', ''), 3)
    ELSE REGEXP_REPLACE(phone, '[^0-9]', '')
  END
);

UPDATE students
SET secondary_phone = CONCAT('+',
  CASE
    WHEN CHAR_LENGTH(REGEXP_REPLACE(secondary_phone, '[^0-9]', '')) = 10
      THEN CONCAT('91', REGEXP_REPLACE(secondary_phone, '[^0-9]', ''))
    WHEN REGEXP_REPLACE(secondary_phone, '[^0-9]', '') LIKE '00%'
      THEN SUBSTRING(REGEXP_REPLACE(secondary_phone, '[^0-9]', ''), 3)
    ELSE REGEXP_REPLACE(secondary_phone, '[^0-9]', '')
  END
)
WHERE secondary_phone IS NOT NULL;

ALTER TABLE driver_vehicle_assignments
  DROP FOREIGN KEY fk_driver_vehicle_driver,
  DROP FOREIGN KEY fk_driver_vehicle_vehicle;
ALTER TABLE driver_vehicle_assignments
  ADD COLUMN active_driver_id INT UNSIGNED GENERATED ALWAYS AS (IF(unassigned_at IS NULL, driver_id, NULL)) STORED,
  ADD COLUMN active_vehicle_id INT UNSIGNED GENERATED ALWAYS AS (IF(unassigned_at IS NULL, vehicle_id, NULL)) STORED,
  ADD UNIQUE KEY uq_driver_vehicle_active_driver (active_driver_id),
  ADD UNIQUE KEY uq_driver_vehicle_active_vehicle (active_vehicle_id);
ALTER TABLE driver_vehicle_assignments
  ADD CONSTRAINT fk_driver_vehicle_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT fk_driver_vehicle_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE student_vehicle_assignments
  DROP FOREIGN KEY fk_student_vehicle_student,
  DROP FOREIGN KEY fk_student_vehicle_vehicle;
ALTER TABLE student_vehicle_assignments
  ADD COLUMN active_student_id INT UNSIGNED GENERATED ALWAYS AS (IF(unassigned_at IS NULL, student_id, NULL)) STORED,
  ADD UNIQUE KEY uq_student_vehicle_active_student (active_student_id);
ALTER TABLE student_vehicle_assignments
  ADD CONSTRAINT fk_student_vehicle_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT fk_student_vehicle_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE student_route_assignments
  DROP FOREIGN KEY fk_student_route_student,
  DROP FOREIGN KEY fk_student_route_route;
ALTER TABLE student_route_assignments
  ADD COLUMN active_student_id INT UNSIGNED GENERATED ALWAYS AS (IF(unassigned_at IS NULL, student_id, NULL)) STORED,
  ADD UNIQUE KEY uq_student_route_active_student (active_student_id);
ALTER TABLE student_route_assignments
  ADD CONSTRAINT fk_student_route_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT fk_student_route_route FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE fee_dues
  DROP FOREIGN KEY fk_fee_dues_student;
ALTER TABLE fee_dues
  DROP INDEX idx_fee_dues_month,
  DROP INDEX idx_fee_dues_status,
  ADD KEY idx_fee_dues_month_status (month, status);
ALTER TABLE fee_dues
  ADD CONSTRAINT fk_fee_dues_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT;

ALTER TABLE transport_logs
  DROP FOREIGN KEY fk_transport_logs_student;
ALTER TABLE transport_logs
  ADD CONSTRAINT fk_transport_logs_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT;

-- A duplicated RFID value cannot safely be assigned to an arbitrary student.
-- Clear every ambiguous duplicate so it can be re-enrolled against the owner.
UPDATE students s
JOIN (
  SELECT tag_no FROM students
  WHERE tag_no IS NOT NULL
  GROUP BY tag_no HAVING COUNT(*) > 1
) duplicated ON duplicated.tag_no = s.tag_no
SET s.tag_no = NULL;

ALTER TABLE students
  DROP INDEX idx_students_tag_no,
  ADD UNIQUE KEY uq_students_tag_no (tag_no),
  ADD KEY idx_students_phone (phone),
  ADD KEY idx_students_secondary_phone (secondary_phone);
