# Campus Tracker Database Schema

The backend uses MySQL through Prisma. The canonical application schema is
defined in `prisma/schema.prisma`; `database/schema.sql` is provided for direct
MySQL setup.

## Core Tables

### `students`

Stores student and parent-contact information.

| Column | Type | Description |
| --- | --- | --- |
| `id` | Unsigned integer | Primary key |
| `serial_number` | Varchar, nullable | School transport serial number |
| `registration_number` | Varchar, unique | School registration number |
| `full_name` | Varchar | Student name |
| `class_name` | Varchar | Class or grade |
| `section` | Varchar, nullable | Class section (`A`, `B`, …) |
| `guardian_name` | Varchar, nullable | Father's / mother's name |
| `distance_km` | Decimal, nullable | Travel distance |
| `tag_no` | Varchar, nullable | Transport/RFID tag |
| `area` | Varchar | Pickup area (short locality) |
| `address` | Varchar, nullable | Full postal address |
| `phone` | Varchar | Primary parent phone |
| `secondary_phone` | Varchar, nullable | Secondary parent phone |
| `created_at` | Timestamp | Creation time |
| `updated_at` | Timestamp | Last update time |

`area` and `address` are deliberately separate: `area` is the short locality
that is `NOT NULL` and drives list filters and search, while `address` holds the
full postal address and is optional. `section` is its own column rather than
being parsed out of `class_name`; rows imported before migration
`20260813_student_profile_fields.sql` may still carry a combined value such as
`V D` in `class_name`. `guardian_name` is a single field because the source
records list one combined "Father's/Mother's Name".

Primary and secondary phone numbers are normalized to E.164 at write time and
indexed for parent lookup. Local 10-digit numbers use the deployment's `+91`
country code. `tag_no` is unique when present because it identifies a scanned
RFID tag. `serial_number` is an optional display/reference value and is not an
identifier.

### `drivers`

Stores driver identity, contact, licence, and duty status.

Important fields:

- `phone` is unique and is used to identify a driver in the Flutter app.
- `status` uses the `DriverStatus` enum.
- `docs_status` uses the `DocsStatus` enum.
- Vehicle assignment history is stored separately.

### `vehicles`

Stores registered school vehicles.

Important fields:

- `vehicle_code`, `registration_number`, and `chassis_number` are unique.
  `chassis_number` is nullable, so multiple vehicles may have it unset.
- `route` is a display/operational route label.
- `status` and `speed_kmh` support fleet tracking. `map_x`/`map_y` are
  dashboard screen-space percentages; they are not GPS coordinates.
- `vehicle_type` (Bus, Van, Mini Bus) and `fuel_type` (Diesel, Petrol, CNG,
  Electric) default to `Bus`/`Diesel` for existing rows.
- `seating_capacity` and the four compliance dates (`insurance_expiry`,
  `fitness_expiry`, `puc_expiry`, `permit_expiry`) are nullable at the
  database level for backward compatibility with vehicles created before
  these fields existed; the admin UI marks them required when adding or
  editing a vehicle going forward.
- Driver and student assignments are stored in relationship tables.

### `routes`

Prisma model: `TransportRoute`.

Stores transport routes and their monthly fee.

| Column | Description |
| --- | --- |
| `route_code` | Unique user-facing route identifier |
| `name` | Route name |
| `description` | Optional route description |
| `fee` | Monthly transport fee |
| `vehicle_id` | Optional assigned vehicle |

The current route fee is used when generating a monthly fee due. Existing
generated dues retain their own billed amount even if the route fee changes.

## Assignment Tables

### `driver_vehicle_assignments`

Maintains driver-to-vehicle assignment history.

- `assigned_at` records when assignment started.
- `unassigned_at = NULL` identifies the active assignment.
- A driver or vehicle can have historical assignments.
- Generated active-key columns and unique indexes enforce one active vehicle
  per driver and one active driver per vehicle.

### `student_vehicle_assignments`

Legacy/audit history only. New current-state lookups and writes use
`student_route_assignments`; creating a route assignment closes any active
direct vehicle assignment for that student.

### `student_route_assignments`

Maintains student-to-route assignment history.

- `unassigned_at = NULL` identifies the active route.
- The active route determines the student's vehicle and monthly route fee.
- `pickup_order` can be used for route sequencing.
- A generated active-key column and unique index enforce one active route per
  student. The same technique enforces one active direct vehicle row in the
  legacy assignment table.

## Fee Management

### `fee_dues`

Stores one authoritative monthly fee record per student.

| Column | Description |
| --- | --- |
| `student_id` | Student owing the fee |
| `route_id` | Route used when the due was generated |
| `month` | Billing month in `YYYY-MM` format |
| `base_amount` | Route fee captured at generation time |
| `discount` | Discount or concession |
| `fine` | Late fee or adjustment |
| `paid_amount` | Total allocated received payments |
| `balance` | Remaining payable amount |
| `status` | Pending, Partial, Paid, Overdue, or Waived |
| `generated_at` | Due generation timestamp |

`student_id + month` is unique, preventing duplicate monthly dues.

Balance calculation:

```text
balance = max(base_amount + fine - discount - paid_amount, 0)
```

### `payments`

Stores payment receipts.

| Column | Description |
| --- | --- |
| `receipt_id` | Unique receipt identifier |
| `student_id` | Linked student |
| `due_id` | Optional linked monthly due |
| `student_name` | Name snapshot for receipt history |
| `plan` | Monthly, quarterly, annual, or other plan |
| `amount` | Received amount |
| `paid_on` | Payment date |
| `method` | UPI, card, cash, or bank transfer |
| `status` | Paid, Collected, Pending, or Overdue |

When a `Paid` or `Collected` payment is linked to a due, the backend recomputes
`paid_amount` from all qualifying linked payments and updates balance/status in
the same transaction. It never increments a trusted running total. A single
`due_id` only supports a monthly payment; multi-month plans are rejected when a
due is supplied until a `payment_due_allocations` ledger is implemented.

## Transport History

### `transport_logs`

Stores student pickup and drop GPS evidence.

| Column | Description |
| --- | --- |
| `student_id` | Student being transported |
| `action` | Pickup or Drop |
| `recorded_at` | Event timestamp |
| `latitude` | GPS latitude |
| `longitude` | GPS longitude |
| `accuracy` | GPS accuracy in metres |

The driver app creates these records. The parent app groups them by student and
date to display check-in/check-out history with map locations.

## Relationships

```text
Student 1 --- * StudentRouteAssignment * --- 1 TransportRoute
Student 1 --- * StudentVehicleAssignment * --- 1 Vehicle
Driver  1 --- * DriverVehicleAssignment  * --- 1 Vehicle

TransportRoute * --- 0..1 Vehicle

Student 1 --- * FeeDue
TransportRoute 1 --- * FeeDue
FeeDue 0..1 --- * Payment
Student 0..1 --- * Payment

Student 1 --- * TransportLog
```

Fee dues, transport logs, and assignment history use `ON DELETE RESTRICT`, so
retained financial, safety, or assignment history prevents a hard-delete.
Payment records retain their receipt/name snapshot; student or due references
use `SET NULL` where configured.

## Enums

- `DriverStatus`: On duty, Available, Off duty, At school
- `DocsStatus`: Verified, ExpiringSoon, Pending, Expired
- `VehicleStatus`: On route, At school, Offline
- `PaymentStatus`: Paid, Collected, Pending, Overdue
- `FeeDueStatus`: Pending, Partial, Paid, Overdue, Waived
- `TransportLogType`: Pickup, Drop

## Monthly Fee Flow

1. Assign a student to a route with a positive fee.
2. Generate dues for a month using `POST /api/fee-dues/generate`.
3. The backend creates one `fee_dues` row per eligible student.
4. Record a payment using `studentId` and `dueId`.
5. The payment transaction updates the linked due automatically.
6. Admin reports and the parent app read the same persisted ledger.

## Schema Commands

From `campus_tracker_backend`:

```powershell
npx prisma validate
npx prisma generate
npx prisma db push
```

The active-assignment generated columns are MySQL-specific and live in
`database/schema.sql`. Do not use `prisma db push` against production because it
does not model those columns. Apply versioned SQL migrations instead; existing
installations must apply `database/migrations/20260705_integrity_fixes.sql`.

## Deferred Normalization

`students.area` remains a compatibility field. Replacing it with a
`pickup_stops` table (including expected coordinates) requires an API/UI data
migration. An explicit April-March `academic_year` dimension likewise requires
a reporting and fee-generation migration. These should not be added as unused
columns without defining their lifecycle and ownership first.
