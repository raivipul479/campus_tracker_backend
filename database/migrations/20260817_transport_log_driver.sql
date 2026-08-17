-- Records which driver logged each pickup/drop.
--
-- Without this there is no way to report driver attendance: the log knows the
-- student but not who scanned them. The driver is already known at the moment
-- DriverPortalService.createTransportLog runs, it simply was not stored.
--
-- Nullable, because rows written before this migration have no driver to
-- attribute and guessing one from the student's current route would be wrong —
-- vehicle and driver assignments change over time, so today's driver is not
-- necessarily the one who drove on the day in question. Those rows are counted
-- as "unattributed" in the report rather than misattributed.
--
-- ON DELETE SET NULL so removing a driver keeps the transport history intact.

ALTER TABLE transport_logs
  ADD COLUMN driver_id INT UNSIGNED NULL AFTER student_id,
  ADD KEY idx_transport_logs_driver_date (driver_id, recorded_at),
  ADD CONSTRAINT fk_transport_logs_driver
    FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE SET NULL;
