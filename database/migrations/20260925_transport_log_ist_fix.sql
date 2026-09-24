-- Repairs pickup/drop times stored 5:30 hours ahead.
--
-- The driver app sent recorded_at as the phone's local IST time with no
-- offset ("2026-09-25T08:00:00.000"). The backend runs in UTC, read that as
-- 08:00 UTC, and stored a pickup made at 08:00 IST (02:30 UTC) as 08:00 UTC.
-- DriverPortalService.createTransportLog now stamps the server's clock instead.
--
-- Only rows carrying the bug are touched: those whose recorded_at sits about
-- 330 minutes after created_at. created_at is written by MySQL itself at insert
-- time, and a log is created the moment the driver taps, so a correct row has
-- the two within seconds of each other. A correct row never matches, and
-- running this twice changes nothing the second time (the gap is then ~0).
--
-- This relies on MySQL's time_zone being UTC, as it is in the VPS container.
-- If it were IST, correct rows would sit 330 minutes BEFORE created_at and
-- buggy rows at ~0, so nothing would match and this would be a no-op.
--
-- Preview first:
--   SELECT id, student_id, action, created_at, recorded_at,
--          recorded_at - INTERVAL 330 MINUTE AS fixed_recorded_at
--   FROM transport_logs
--   WHERE TIMESTAMPDIFF(MINUTE, created_at, recorded_at) BETWEEN 320 AND 340;

UPDATE transport_logs
SET recorded_at = recorded_at - INTERVAL 330 MINUTE
WHERE TIMESTAMPDIFF(MINUTE, created_at, recorded_at) BETWEEN 320 AND 340;
