-- Brings a campus_tracker database up to the current schema.
--
-- Every step is guarded, so this is safe to run on a database that is fully up
-- to date, partly migrated, or missing everything. Nothing is dropped and no
-- data is rewritten, with one exception: the route "band" columns were a
-- reverted experiment, and are removed if a database still carries them.

SET @db := DATABASE();

-- ---------------------------------------------------------------- vehicles
SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND COLUMN_NAME='vehicle_type')=0,
  "ALTER TABLE vehicles ADD COLUMN vehicle_type ENUM('Bus','Van','Mini Bus') NOT NULL DEFAULT 'Bus' AFTER map_y", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND COLUMN_NAME='fuel_type')=0,
  "ALTER TABLE vehicles ADD COLUMN fuel_type ENUM('Diesel','Petrol','CNG','Electric') NOT NULL DEFAULT 'Diesel' AFTER vehicle_type", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND COLUMN_NAME='seating_capacity')=0,
  'ALTER TABLE vehicles ADD COLUMN seating_capacity SMALLINT UNSIGNED NULL AFTER fuel_type', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND COLUMN_NAME='chassis_number')=0,
  'ALTER TABLE vehicles ADD COLUMN chassis_number VARCHAR(64) NULL AFTER seating_capacity', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND COLUMN_NAME='insurance_expiry')=0,
  'ALTER TABLE vehicles ADD COLUMN insurance_expiry DATE NULL AFTER chassis_number', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND COLUMN_NAME='fitness_expiry')=0,
  'ALTER TABLE vehicles ADD COLUMN fitness_expiry DATE NULL AFTER insurance_expiry', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND COLUMN_NAME='puc_expiry')=0,
  'ALTER TABLE vehicles ADD COLUMN puc_expiry DATE NULL AFTER fitness_expiry', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND COLUMN_NAME='permit_expiry')=0,
  'ALTER TABLE vehicles ADD COLUMN permit_expiry DATE NULL AFTER puc_expiry', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles')=1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND INDEX_NAME='uq_vehicles_chassis_number')=0,
  'ALTER TABLE vehicles ADD UNIQUE KEY uq_vehicles_chassis_number (chassis_number)', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------- students
SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students' AND COLUMN_NAME='section')=0,
  'ALTER TABLE students ADD COLUMN section VARCHAR(16) NULL AFTER class_name', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students' AND COLUMN_NAME='guardian_name')=0,
  'ALTER TABLE students ADD COLUMN guardian_name VARCHAR(160) NULL AFTER section', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students' AND COLUMN_NAME='address')=0,
  'ALTER TABLE students ADD COLUMN address VARCHAR(255) NULL AFTER area', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students' AND COLUMN_NAME='on_hold')=0,
  'ALTER TABLE students ADD COLUMN on_hold TINYINT(1) NOT NULL DEFAULT 0 AFTER address', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students' AND COLUMN_NAME='branch')=0,
  "ALTER TABLE students ADD COLUMN branch ENUM('JPC','JPIC') NULL AFTER on_hold", 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students')=1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students' AND INDEX_NAME='idx_students_on_hold')=0,
  'ALTER TABLE students ADD INDEX idx_students_on_hold (on_hold)', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students' AND COLUMN_NAME='email')=0,
  'ALTER TABLE students ADD COLUMN email VARCHAR(190) NULL AFTER secondary_phone', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------- fee_dues
SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='fee_dues')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='fee_dues' AND COLUMN_NAME='due_date')=0,
  'ALTER TABLE fee_dues ADD COLUMN due_date DATE NULL AFTER month', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------- payments
SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payments')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payments' AND COLUMN_NAME='paid_time')=0,
  'ALTER TABLE payments ADD COLUMN paid_time CHAR(8) NULL AFTER paid_on', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payments')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payments' AND COLUMN_NAME='reference_number')=0,
  'ALTER TABLE payments ADD COLUMN reference_number VARCHAR(64) NULL AFTER method', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payments')=1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payments' AND INDEX_NAME='uq_payments_reference_number')=0,
  'ALTER TABLE payments ADD UNIQUE KEY uq_payments_reference_number (reference_number)', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------- transport_logs
SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transport_logs')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transport_logs' AND COLUMN_NAME='driver_id')=0,
  'ALTER TABLE transport_logs ADD COLUMN driver_id INT UNSIGNED NULL AFTER student_id', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transport_logs')=1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transport_logs' AND INDEX_NAME='idx_transport_logs_driver_date')=0,
  'ALTER TABLE transport_logs ADD KEY idx_transport_logs_driver_date (driver_id, recorded_at)', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transport_logs')=1 AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transport_logs' AND CONSTRAINT_NAME='fk_transport_logs_driver' AND CONSTRAINT_TYPE='FOREIGN KEY')=0,
  'ALTER TABLE transport_logs ADD CONSTRAINT fk_transport_logs_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE SET NULL', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ------------------------------------------------ push notification tables
CREATE TABLE IF NOT EXISTS device_tokens (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone      VARCHAR(32)  NOT NULL,
  role       ENUM('parent','driver') NOT NULL DEFAULT 'parent',
  token      VARCHAR(512) NOT NULL,
  platform   VARCHAR(20)  NOT NULL DEFAULT 'android',
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_tokens_token (token),
  KEY idx_device_tokens_phone (phone)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone      VARCHAR(32)  NOT NULL,
  student_id INT UNSIGNED NULL,
  type       ENUM('Pickup','Drop','FeeReminder') NOT NULL,
  title      VARCHAR(160) NOT NULL,
  body       VARCHAR(500) NOT NULL,
  read_at    DATETIME(3)  NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_phone_date (phone, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ---------------------------------------------------- route distance slabs
-- The route "band" columns were a reverted experiment. Undo them if this
-- database still carries them, moving any student sitting on a band route back
-- to its parent first so no assignment is orphaned.
SET @has_band := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='routes' AND COLUMN_NAME='parent_route_id');

SET @sql := IF(@has_band=1,
  'UPDATE student_route_assignments a JOIN routes r ON r.id = a.route_id SET a.route_id = r.parent_route_id WHERE r.parent_route_id IS NOT NULL', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@has_band=1 AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='routes' AND CONSTRAINT_NAME='fk_routes_parent')=1,
  'ALTER TABLE routes DROP FOREIGN KEY fk_routes_parent', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@has_band=1,
  'ALTER TABLE routes DROP COLUMN parent_route_id, DROP COLUMN min_km, DROP COLUMN max_km', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Only when routes exists to reference.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='routes')=1,
  'CREATE TABLE IF NOT EXISTS route_fee_slabs ( id INT UNSIGNED NOT NULL AUTO_INCREMENT, route_id INT UNSIGNED NOT NULL, min_km DECIMAL(8,2) NOT NULL, max_km DECIMAL(8,2) NOT NULL, fee DECIMAL(10,2) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_route_fee_slabs_route_min (route_id, min_km), KEY idx_route_fee_slabs_lookup (route_id, max_km), CONSTRAINT fk_route_fee_slabs_route FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE CASCADE, CONSTRAINT chk_route_fee_slabs_range CHECK (max_km >= min_km), CONSTRAINT chk_route_fee_slabs_fee CHECK (fee >= 0) ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='student_route_assignments')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='student_route_assignments' AND COLUMN_NAME='slab_id')=0,
  'ALTER TABLE student_route_assignments ADD COLUMN slab_id INT UNSIGNED NULL AFTER route_id', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='student_route_assignments')=1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='student_route_assignments' AND INDEX_NAME='idx_student_route_slab')=0,
  'ALTER TABLE student_route_assignments ADD KEY idx_student_route_slab (slab_id)', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='student_route_assignments')=1 AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='student_route_assignments' AND CONSTRAINT_NAME='fk_student_route_slab' AND CONSTRAINT_TYPE='FOREIGN KEY')=0,
  'ALTER TABLE student_route_assignments ADD CONSTRAINT fk_student_route_slab FOREIGN KEY (slab_id) REFERENCES route_fee_slabs (id) ON DELETE RESTRICT', 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ------------------------------------------------------------------ report
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='vehicles' AND COLUMN_NAME IN ('vehicle_type','fuel_type','seating_capacity','chassis_number','insurance_expiry','fitness_expiry','puc_expiry','permit_expiry')) AS vehicles_want_8,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='students' AND COLUMN_NAME IN ('section','guardian_name','address','on_hold','branch','email')) AS students_want_6,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='fee_dues' AND COLUMN_NAME='due_date') AS dues_want_1,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='payments' AND COLUMN_NAME IN ('paid_time','reference_number')) AS payments_want_2,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='transport_logs' AND COLUMN_NAME='driver_id') AS tlog_want_1,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME IN ('device_tokens','notifications','route_fee_slabs')) AS tables_want_3,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='student_route_assignments' AND COLUMN_NAME='slab_id') AS slab_want_1,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='routes' AND COLUMN_NAME='parent_route_id') AS bands_want_0;
