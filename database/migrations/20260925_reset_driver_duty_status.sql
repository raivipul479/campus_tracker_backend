-- Resets drivers.status left at 'On duty' by bus assignment.
--
-- AssignmentModel.assignDriver used to set status = 'On duty' whenever a driver
-- was given a bus (and unassigning set 'Available'), so every driver who had
-- ever been assigned read as on duty. Status is now driven only by the driver
-- app's check-in / check-out (driver_duty_logs), and assignment leaves it alone.
--
-- Keeps 'On duty' only for drivers whose latest duty log is a check-in made
-- today (UTC date, as the rest of the duty code uses); everyone else currently
-- 'On duty' becomes 'Off duty'. Safe to re-run.
--
-- Preview first:
--   SELECT id, full_name, status FROM drivers WHERE status = 'On duty';

UPDATE drivers d
SET d.status = 'Off duty'
WHERE d.status = 'On duty'
  AND NOT EXISTS (
    SELECT 1
    FROM driver_duty_logs l
    WHERE l.driver_id = d.id
      AND l.action = 'CheckIn'
      AND l.recorded_at >= UTC_DATE()
      AND NOT EXISTS (
        SELECT 1
        FROM driver_duty_logs later
        WHERE later.driver_id = l.driver_id
          AND (later.recorded_at > l.recorded_at
               OR (later.recorded_at = l.recorded_at AND later.id > l.id))
      )
  );
