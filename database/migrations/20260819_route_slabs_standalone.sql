-- Distance slabs, for databases that never ran the abandoned band migrations.
--
-- Same end state as 20260819_route_slabs.sql, without the revert steps. Use
-- this one when `routes` has no `parent_route_id` column; use the other when it
-- does, because that one drops the column and its foreign key first.
--
-- Check which applies:
--
--   SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_schema = DATABASE()
--      AND table_name = 'routes' AND column_name = 'parent_route_id';
--
--   0 -> run this file.  1 -> run 20260819_route_slabs.sql instead.
--
-- A route is one row and one bus run. Its slabs are the distance bands it is
-- priced in, and a student assignment records both: the route, where the bus,
-- driver, roster and attendance already hang, and the slab, which decides the
-- fee. A route with no slabs bills routes.fee, exactly as before.

CREATE TABLE route_fee_slabs (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  route_id   INT UNSIGNED  NOT NULL,
  min_km     DECIMAL(8,2)  NOT NULL,
  max_km     DECIMAL(8,2)  NOT NULL,
  fee        DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One slab per starting distance per route. Overlapping slabs would make the
  -- fee for a distance ambiguous; the service rejects those, and this stops the
  -- common case of a duplicated band at the database.
  UNIQUE KEY uq_route_fee_slabs_route_min (route_id, min_km),
  KEY idx_route_fee_slabs_lookup (route_id, max_km),
  CONSTRAINT fk_route_fee_slabs_route
    FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE CASCADE,
  CONSTRAINT chk_route_fee_slabs_range CHECK (max_km >= min_km),
  CONSTRAINT chk_route_fee_slabs_fee CHECK (fee >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nullable: a route need not be banded, and NULL means the student falls back
-- to routes.fee. ON DELETE RESTRICT so a slab students are billed on cannot be
-- deleted out from under them.
ALTER TABLE student_route_assignments
  ADD COLUMN slab_id INT UNSIGNED NULL AFTER route_id,
  ADD KEY idx_student_route_slab (slab_id),
  ADD CONSTRAINT fk_student_route_slab
    FOREIGN KEY (slab_id) REFERENCES route_fee_slabs (id) ON DELETE RESTRICT;
