-- SUPERSEDED by 20260819_route_slabs.sql. Kept because it was applied to live
-- databases and the later migrations assume it ran; do not delete.
--
-- First attempt at distance pricing: slabs as a side-table keyed on
-- students.distance_km, with the fee derived from the student's distance rather
-- than chosen when they were assigned.

CREATE TABLE route_fee_slabs (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  route_id   INT UNSIGNED  NOT NULL,
  min_km     DECIMAL(8,2)  NOT NULL,
  max_km     DECIMAL(8,2)  NOT NULL,
  fee        DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_route_fee_slabs_route_min (route_id, min_km),
  KEY idx_route_fee_slabs_lookup (route_id, max_km),
  CONSTRAINT fk_route_fee_slabs_route
    FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE CASCADE,
  CONSTRAINT chk_route_fee_slabs_range CHECK (max_km >= min_km),
  CONSTRAINT chk_route_fee_slabs_fee CHECK (fee >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
