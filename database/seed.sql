INSERT INTO vehicles (vehicle_code, registration_number, route, status, speed_kmh, map_x, map_y) VALUES
  ('BUS-04', 'DL 1PC 4182', 'North Loop', 'On route', 38, 62, 35),
  ('BUS-07', 'DL 1PC 5721', 'East Park', 'On route', 24, 30, 63),
  ('VAN-02', 'DL 1VC 9044', 'South City', 'At school', 0, 50, 74),
  ('BUS-11', 'DL 1PC 6510', 'West End', 'Offline', 0, 79, 66)
ON DUPLICATE KEY UPDATE
  route = VALUES(route),
  status = VALUES(status),
  speed_kmh = VALUES(speed_kmh),
  map_x = VALUES(map_x),
  map_y = VALUES(map_y);

INSERT INTO drivers (full_name, phone, license_number, status, docs_status, route) VALUES
  ('Ramesh Kumar', '+91 98107 24561', 'DL-0420110123456', 'On duty', 'Verified', 'North Loop'),
  ('Sunil Yadav', '+91 99584 10882', NULL, 'On duty', 'Verified', 'East Park'),
  ('Amit Singh', '+919871354119', NULL, 'At school', 'ExpiringSoon', 'South City'),
  ('Deepak Rana', '+91 98188 40912', NULL, 'Off duty', 'Verified', 'West End'),
  ('Manoj Verma', '+919971036481', NULL, 'Available', 'Pending', NULL)
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  docs_status = VALUES(docs_status),
  route = VALUES(route);

INSERT INTO students (serial_number, registration_number, full_name, class_name, distance_km, tag_no, area, phone, secondary_phone) VALUES
  ('251', 'JPIS/5441/25', 'Kaira Khandelwal', 'Grade 4', 25, 'T-A', 'Burmese Colony', '7568089869', '7568089869'),
  ('238', 'JPIS/4768/23', 'Aryadit Agarwal', 'Grade 4', 25, 'T-A', 'Adarsh Nagar', '9829919869', NULL),
  ('239', 'JPIS/4765/23', 'Maurya Dhariwal', 'Grade 4', 25, 'T-A', 'Adarsh Nagar', '9829009228', '9928889228'),
  ('242', 'JPIS/4760/23', 'Aadhvan Malpani', 'Grade 4', 25, 'T-A', 'Adarsh Nagar', '9928515725', '9829857009'),
  ('249', 'JPIS/5451/25', 'Aarohi Patni', 'Grade 4', 25, 'T-A', 'Tilak Nagar', '9829055010', '7014896293')
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  class_name = VALUES(class_name),
  distance_km = VALUES(distance_km),
  tag_no = VALUES(tag_no),
  area = VALUES(area),
  phone = VALUES(phone),
  secondary_phone = VALUES(secondary_phone);

INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, route)
SELECT d.id, v.id, v.route
FROM drivers d
JOIN vehicles v ON
  (d.full_name = 'Ramesh Kumar' AND v.vehicle_code = 'BUS-04')
  OR (d.full_name = 'Sunil Yadav' AND v.vehicle_code = 'BUS-07')
  OR (d.full_name = 'Amit Singh' AND v.vehicle_code = 'VAN-02')
  OR (d.full_name = 'Deepak Rana' AND v.vehicle_code = 'BUS-11')
WHERE NOT EXISTS (
  SELECT 1
  FROM driver_vehicle_assignments a
  WHERE a.driver_id = d.id AND a.vehicle_id = v.id AND a.unassigned_at IS NULL
);
