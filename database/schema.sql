CREATE TABLE IF NOT EXISTS super_admins (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_salt VARCHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_super_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS students (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  serial_number VARCHAR(32) NULL,
  registration_number VARCHAR(64) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  class_name VARCHAR(80) NOT NULL,
  section VARCHAR(16) NULL,
  guardian_name VARCHAR(160) NULL,
  distance_km DECIMAL(8,2) NULL,
  tag_no VARCHAR(32) NULL,
  area VARCHAR(180) NOT NULL,
  address VARCHAR(255) NULL,
  on_hold TINYINT(1) NOT NULL DEFAULT 0,
  branch ENUM('JPC', 'JPIC') NULL,
  phone VARCHAR(32) NOT NULL,
  secondary_phone VARCHAR(32) NULL,
  -- The fee sheet's E-Mail Address. Not unique: siblings share a parent's.
  email VARCHAR(190) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_students_registration_number (registration_number),
  KEY idx_students_name (full_name),
  UNIQUE KEY uq_students_tag_no (tag_no),
  KEY idx_students_phone (phone),
  KEY idx_students_secondary_phone (secondary_phone),
  KEY idx_students_on_hold (on_hold)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drivers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  license_number VARCHAR(80) NULL,
  status ENUM('On duty', 'Available', 'Off duty', 'At school') NOT NULL DEFAULT 'Available',
  docs_status ENUM('Verified', 'ExpiringSoon', 'Pending', 'Expired') NOT NULL DEFAULT 'Pending',
  route VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_drivers_phone (phone),
  KEY idx_drivers_name (full_name),
  KEY idx_drivers_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_code VARCHAR(32) NOT NULL,
  registration_number VARCHAR(64) NOT NULL,
  route VARCHAR(120) NULL,
  status ENUM('On route', 'At school', 'Offline') NOT NULL DEFAULT 'Offline',
  speed_kmh DECIMAL(8,2) NOT NULL DEFAULT 0,
  map_x DECIMAL(5,2) NOT NULL DEFAULT 50,
  map_y DECIMAL(5,2) NOT NULL DEFAULT 50,
  vehicle_type ENUM('Bus', 'Van', 'Mini Bus') NOT NULL DEFAULT 'Bus',
  fuel_type ENUM('Diesel', 'Petrol', 'CNG', 'Electric') NOT NULL DEFAULT 'Diesel',
  seating_capacity SMALLINT UNSIGNED NULL,
  chassis_number VARCHAR(64) NULL,
  insurance_expiry DATE NULL,
  fitness_expiry DATE NULL,
  puc_expiry DATE NULL,
  permit_expiry DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicles_code (vehicle_code),
  UNIQUE KEY uq_vehicles_registration_number (registration_number),
  UNIQUE KEY uq_vehicles_chassis_number (chassis_number),
  KEY idx_vehicles_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS routes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  route_code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  vehicle_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_routes_code (route_code),
  KEY idx_routes_name (name),
  KEY idx_routes_vehicle (vehicle_id),
  CONSTRAINT fk_routes_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The distance bands a route is priced in. The route stays one row and one bus
-- run; a slab has no identity of its own and takes its code, name and vehicle
-- from route_id. A student is assigned to the route AND to one slab, and the
-- slab sets the fee. See migrations/20260819_route_slabs.sql.
CREATE TABLE IF NOT EXISTS route_fee_slabs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  route_id INT UNSIGNED NOT NULL,
  min_km DECIMAL(8,2) NOT NULL,
  max_km DECIMAL(8,2) NOT NULL,
  fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_route_fee_slabs_route_min (route_id, min_km),
  KEY idx_route_fee_slabs_lookup (route_id, max_km),
  CONSTRAINT fk_route_fee_slabs_route FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE CASCADE,
  CONSTRAINT chk_route_fee_slabs_range CHECK (max_km >= min_km),
  CONSTRAINT chk_route_fee_slabs_fee CHECK (fee >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_vehicle_assignments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  driver_id INT UNSIGNED NOT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  route VARCHAR(120) NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TIMESTAMP NULL,
  active_driver_id INT UNSIGNED GENERATED ALWAYS AS (IF(unassigned_at IS NULL, driver_id, NULL)) STORED,
  active_vehicle_id INT UNSIGNED GENERATED ALWAYS AS (IF(unassigned_at IS NULL, vehicle_id, NULL)) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_driver_vehicle_active_driver (active_driver_id),
  UNIQUE KEY uq_driver_vehicle_active_vehicle (active_vehicle_id),
  KEY idx_driver_vehicle_active_vehicle (vehicle_id, unassigned_at),
  KEY idx_driver_vehicle_active_driver (driver_id, unassigned_at),
  CONSTRAINT fk_driver_vehicle_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_driver_vehicle_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_vehicle_assignments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id INT UNSIGNED NOT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  pickup_order INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TIMESTAMP NULL,
  active_student_id INT UNSIGNED GENERATED ALWAYS AS (IF(unassigned_at IS NULL, student_id, NULL)) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_vehicle_active_student (active_student_id),
  KEY idx_student_vehicle_active_vehicle (vehicle_id, unassigned_at),
  KEY idx_student_vehicle_active_student (student_id, unassigned_at),
  CONSTRAINT fk_student_vehicle_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_student_vehicle_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_route_assignments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id INT UNSIGNED NOT NULL,
  route_id INT UNSIGNED NOT NULL,
  -- Which distance slab of route_id the student is billed on. NULL means the
  -- route has no slabs and routes.fee applies.
  slab_id INT UNSIGNED NULL,
  pickup_order INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TIMESTAMP NULL,
  active_student_id INT UNSIGNED GENERATED ALWAYS AS (IF(unassigned_at IS NULL, student_id, NULL)) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_route_active_student (active_student_id),
  KEY idx_student_route_active_route (route_id, unassigned_at),
  KEY idx_student_route_active_student (student_id, unassigned_at),
  KEY idx_student_route_slab (slab_id),
  CONSTRAINT fk_student_route_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_student_route_route FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_student_route_slab FOREIGN KEY (slab_id) REFERENCES route_fee_slabs (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fee_dues (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id INT UNSIGNED NOT NULL,
  route_id INT UNSIGNED NULL,
  month VARCHAR(7) NOT NULL,
  -- When the due is payable; generated_at is when it was raised.
  due_date DATE NULL,
  base_amount DECIMAL(10,2) NOT NULL,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  fine DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  balance DECIMAL(10,2) NOT NULL,
  status ENUM('Pending', 'Partial', 'Paid', 'Overdue', 'Waived') NOT NULL DEFAULT 'Pending',
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fee_dues_student_month (student_id, month),
  KEY idx_fee_dues_month_status (month, status),
  KEY idx_fee_dues_route (route_id),
  CONSTRAINT fk_fee_dues_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT,
  CONSTRAINT fk_fee_dues_route FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt_id VARCHAR(32) NOT NULL,
  student_id INT UNSIGNED NULL,
  due_id INT UNSIGNED NULL,
  student_name VARCHAR(160) NOT NULL,
  plan VARCHAR(80) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  paid_on DATE NOT NULL,
  -- Clock time, kept out of paid_on so existing date-range reports keep
  -- behaving. CHAR(8) rather than TIME: Prisma maps TIME to DateTime and hands
  -- back 1970-01-01T15:26:00Z, inviting a timezone bug on every read.
  paid_time CHAR(8) NULL,
  method VARCHAR(40) NOT NULL,
  -- The fee gateway's own receipt, stored as given. UNIQUE so re-importing a
  -- sheet updates rather than duplicating; many NULLs are allowed.
  reference_number VARCHAR(64) NULL,
  status ENUM('Paid', 'Collected', 'Pending', 'Overdue') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_receipt_id (receipt_id),
  UNIQUE KEY uq_payments_reference_number (reference_number),
  KEY idx_payments_student (student_id),
  KEY idx_payments_due (due_id),
  KEY idx_payments_paid_on (paid_on),
  KEY idx_payments_status (status),
  CONSTRAINT fk_payments_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_due FOREIGN KEY (due_id) REFERENCES fee_dues (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS transport_logs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id INT UNSIGNED NOT NULL,
  driver_id INT UNSIGNED NULL,
  action ENUM('Pickup', 'Drop') NOT NULL,
  recorded_at DATETIME NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  accuracy DECIMAL(8, 2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transport_logs_student_date (student_id, recorded_at),
  KEY idx_transport_logs_driver_date (driver_id, recorded_at),
  KEY idx_transport_logs_action (action),
  CONSTRAINT fk_transport_logs_student
    FOREIGN KEY (student_id) REFERENCES students(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_transport_logs_driver
    FOREIGN KEY (driver_id) REFERENCES drivers(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_positions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_no   VARCHAR(32)     NOT NULL,
  vehicle_id   INT UNSIGNED    NULL,
  latitude     DECIMAL(10, 7)  NOT NULL,
  longitude    DECIMAL(10, 7)  NOT NULL,
  speed        DECIMAL(6, 2)   NOT NULL DEFAULT 0,
  ignition     TINYINT(1)      NOT NULL DEFAULT 0,
  direction    SMALLINT UNSIGNED NULL,
  status       VARCHAR(32)     NULL,
  odometer     DECIMAL(12, 4)  NULL,
  gps_duration BIGINT UNSIGNED NULL,
  imei         VARCHAR(32)     NULL,
  -- The provider's own clock, in UTC. fetched_at is ours.
  reported_at  DATETIME(3)     NOT NULL,
  fetched_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_positions_no_time (vehicle_no, reported_at),
  KEY idx_vehicle_positions_no_time (vehicle_no, reported_at),
  KEY idx_vehicle_positions_vehicle (vehicle_id),
  KEY idx_vehicle_positions_reported (reported_at),
  CONSTRAINT fk_vehicle_positions_vehicle
    FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
