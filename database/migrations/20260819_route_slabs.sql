-- Distance slabs as children of a route, with assignments pointing at a slab.
--
-- A route is ONE row and one physical bus run ("B-10"). Its slabs are the
-- distance bands it is priced in (1-10 km, 11-20 km ...). A student assignment
-- records both: the ROUTE, which is where the bus, driver, roster, attendance
-- and every existing join already hang, and the SLAB, which is what decides the
-- fee. A slab has no identity of its own — its code, name and vehicle are read
-- from its parent route.
--
-- This replaces 20260819_route_bands.sql, which modelled each band as its own
-- row in `routes` ("B-10 1-10"). That duplicated one run into many route
-- records, polluted every route list and dropdown, and split a single bus's
-- roster across rows.
--
-- Reverts that migration first, then builds the slab model. Reverting is safe
-- here because the band rows were created by backfill-route-bands.ts and hold no
-- history of their own: assignments are moved back to the parent they came from,
-- which is where they pointed before that script ran.

-- 1. Put every assignment back on the real route.
UPDATE student_route_assignments a
  JOIN routes r ON r.id = a.route_id
  SET a.route_id = r.parent_route_id
  WHERE r.parent_route_id IS NOT NULL;

-- 2. Remove the generated band rows. Guarded on having no assignments left so a
--    band that somehow still holds students is kept rather than silently
--    deleted along with them.
DELETE FROM routes
  WHERE parent_route_id IS NOT NULL
    AND id NOT IN (SELECT route_id FROM student_route_assignments)
    AND id NOT IN (SELECT route_id FROM fee_dues);

ALTER TABLE routes
  DROP FOREIGN KEY fk_routes_parent;

ALTER TABLE routes
  DROP KEY idx_routes_parent,
  DROP COLUMN parent_route_id,
  DROP COLUMN min_km,
  DROP COLUMN max_km;

-- 3. Slabs: the priced distance bands of a route.
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

-- 4. Which slab a student is billed on.
--
-- Nullable because a route need not be banded: with no slab the student falls
-- back to routes.fee, which is exactly how billing worked before slabs existed.
--
-- ON DELETE RESTRICT so a slab that students are billed on cannot be deleted out
-- from under them; the API unassigns or moves them first.
ALTER TABLE student_route_assignments
  ADD COLUMN slab_id INT UNSIGNED NULL AFTER route_id,
  ADD KEY idx_student_route_slab (slab_id),
  ADD CONSTRAINT fk_student_route_slab
    FOREIGN KEY (slab_id) REFERENCES route_fee_slabs (id) ON DELETE RESTRICT;
