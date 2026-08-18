-- SUPERSEDED by 20260819_route_slabs.sql, which reverts this. Kept because it
-- was applied to live databases and that migration's revert steps assume these
-- columns exist; do not delete.
--
-- Second attempt at distance pricing: each band as its own row in `routes`
-- ("B-10 1-10") under a parent route. Abandoned because it duplicated one bus
-- run into many route records and split a single roster across rows.

ALTER TABLE routes
  ADD COLUMN parent_route_id INT UNSIGNED NULL AFTER vehicle_id,
  ADD COLUMN min_km DECIMAL(8,2) NULL AFTER parent_route_id,
  ADD COLUMN max_km DECIMAL(8,2) NULL AFTER min_km,
  ADD KEY idx_routes_parent (parent_route_id),
  ADD CONSTRAINT fk_routes_parent
    FOREIGN KEY (parent_route_id) REFERENCES routes (id) ON DELETE RESTRICT;

DROP TABLE IF EXISTS route_fee_slabs;
