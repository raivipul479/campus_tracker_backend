-- Driver duty check-in / check-out.
--
-- Until now the mobile app kept check-in and check-out on the phone only, so
-- the admin dashboard never saw them: driver attendance counted pickups and
-- drops alone, and drivers.status only changed when an admin edited it by hand.
--
-- One row per check-in or check-out, with the GPS fix the driver was at. The
-- driver's current state is the latest row, and DriverDutyService keeps
-- drivers.status in step with it (CheckIn -> 'On duty', CheckOut -> 'Off duty').
--
-- recorded_at is the server's clock, not the phone's, so attendance cannot be
-- shifted by a wrong device time.
--
-- ON DELETE CASCADE: a duty row means nothing without its driver. In practice a
-- driver who has worked has vehicle-assignment history and cannot be
-- hard-deleted anyway.

CREATE TABLE IF NOT EXISTS driver_duty_logs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  driver_id INT UNSIGNED NOT NULL,
  action ENUM('CheckIn', 'CheckOut') NOT NULL,
  recorded_at DATETIME NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  accuracy DECIMAL(8, 2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_driver_duty_logs_driver_date (driver_id, recorded_at),
  KEY idx_driver_duty_logs_date (recorded_at),
  CONSTRAINT fk_driver_duty_logs_driver
    FOREIGN KEY (driver_id) REFERENCES drivers (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
