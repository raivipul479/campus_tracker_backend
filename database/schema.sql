CREATE TABLE IF NOT EXISTS students (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  serial_number VARCHAR(32) NULL,
  registration_number VARCHAR(64) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  class_name VARCHAR(80) NOT NULL,
  distance_km DECIMAL(8,2) NULL,
  tag_no VARCHAR(32) NULL,
  area VARCHAR(180) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  secondary_phone VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_students_registration_number (registration_number),
  KEY idx_students_name (full_name),
  KEY idx_students_tag_no (tag_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drivers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  license_number VARCHAR(80) NULL,
  status ENUM('On duty', 'Available', 'Off duty', 'At school') NOT NULL DEFAULT 'Available',
  docs_status ENUM('Verified', '1 expiring', '2 pending', 'Pending', 'Expired') NOT NULL DEFAULT 'Pending',
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicles_code (vehicle_code),
  UNIQUE KEY uq_vehicles_registration_number (registration_number),
  KEY idx_vehicles_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_vehicle_assignments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  driver_id INT UNSIGNED NOT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  route VARCHAR(120) NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_driver_vehicle_active_vehicle (vehicle_id, unassigned_at),
  KEY idx_driver_vehicle_active_driver (driver_id, unassigned_at),
  CONSTRAINT fk_driver_vehicle_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE,
  CONSTRAINT fk_driver_vehicle_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_vehicle_assignments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id INT UNSIGNED NOT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  pickup_order INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_student_vehicle_active_vehicle (vehicle_id, unassigned_at),
  KEY idx_student_vehicle_active_student (student_id, unassigned_at),
  CONSTRAINT fk_student_vehicle_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
  CONSTRAINT fk_student_vehicle_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
