-- Stored GPS positions, polled from the provider on a fixed cadence.
--
-- The provider allows one call per minute, which previously tied every client
-- read to that budget. A single poller writing here decouples the two: any
-- number of dashboards and phones can read as often as they like, and only the
-- poller ever talks to the provider.
--
-- vehicle_no is the provider's registration number, normalised (no punctuation,
-- uppercase) because that is what lookups compare against -- the provider
-- reports RJ45CE4015 where the office may have typed "RJ 45 CE 4015".
--
-- vehicle_id is nullable on purpose: the provider can report a vehicle this
-- school has no record of, and dropping that position would hide a real bus.
-- ON DELETE SET NULL so removing a vehicle keeps its position history.
--
-- The unique key on (vehicle_no, reported_at) is what keeps this table small.
-- A parked bus returns the same provider timestamp on every poll, so inserts
-- are idempotent and only genuinely new positions are stored.

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
