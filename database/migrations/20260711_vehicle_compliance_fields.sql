-- Adds vehicle type, fuel type, seating capacity, chassis number, and
-- compliance document expiry dates (insurance, fitness, PUC, permit) to the
-- vehicles table. Existing rows default to Bus / Diesel; the remaining new
-- columns are nullable so this is safe to run against populated tables.

ALTER TABLE vehicles
  ADD COLUMN vehicle_type ENUM('Bus', 'Van', 'Mini Bus') NOT NULL DEFAULT 'Bus' AFTER map_y,
  ADD COLUMN fuel_type ENUM('Diesel', 'Petrol', 'CNG', 'Electric') NOT NULL DEFAULT 'Diesel' AFTER vehicle_type,
  ADD COLUMN seating_capacity SMALLINT UNSIGNED NULL AFTER fuel_type,
  ADD COLUMN chassis_number VARCHAR(64) NULL AFTER seating_capacity,
  ADD COLUMN insurance_expiry DATE NULL AFTER chassis_number,
  ADD COLUMN fitness_expiry DATE NULL AFTER insurance_expiry,
  ADD COLUMN puc_expiry DATE NULL AFTER fitness_expiry,
  ADD COLUMN permit_expiry DATE NULL AFTER puc_expiry,
  ADD UNIQUE KEY uq_vehicles_chassis_number (chassis_number);
