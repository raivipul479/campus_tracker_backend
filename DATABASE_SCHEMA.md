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
| `fee` | Flat fee, used only when the route has no slabs |
| `vehicle_id` | Optional assigned vehicle |

### `route_fee_slabs`

Prisma model: `RouteFeeSlab`.

The distance bands a route is priced in. The route stays **one row** and one
physical bus run; a slab has no identity of its own — its code, name and vehicle
are read from its parent route.

| Column | Description |
| --- | --- |
| `route_id` | Owning route, `ON DELETE CASCADE` |
| `min_km` / `max_km` | The band's distance range, both inclusive |
| `fee` | Charge for a student assigned to this slab |

A student assignment records **both** the route and the slab
(`student_route_assignments.slab_id`):

- the **route** is where the bus, driver, roster, attendance and every existing
  join already hang, so none of them change when slabs are introduced;
- the **slab** is what decides the fee.

Rules to preserve:

- **Slabs must not overlap** within a route. `RouteService.parseSlabs` rejects
  overlaps and `uq_route_fee_slabs_route_min` stops duplicates at the database;
  with overlapping slabs the fee for a distance is ambiguous.
- **Editing slabs preserves rows students are billed on.** `replaceSlabs` matches
  an existing slab by its starting kilometre and updates it in place. Deleting
  and recreating would change the slab id under every assignment pointing at it,
  which is the entire link between a student and their fee.
- **A slab in use cannot be removed.** `ON DELETE RESTRICT` on
  `fk_student_route_slab`, and `replaceSlabs` refuses with an explanation rather
  than a foreign-key error. Move those students first.
- **A slab must belong to the route being assigned.** `resolveSlabId` rejects a
  slab from another route — it would bill a fee unrelated to the bus ridden.
- **`slab_id` is nullable** and means the route is unbanded: the student falls
  back to `routes.fee`, exactly how billing worked before slabs existed.
- **Ambiguity is refused, not guessed.** Assigning without a `slabId` to a route
  with several slabs is a 400; with one slab it picks that one.

`students.distance_km` (written by student import's `parseSlabKm`) is only a hint
for choosing a slab in the UI. It does not decide the fee — the assignment does.

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
| `month` | Billing quarter, `YYYY-Qn` (see the fee flow below) |
| `due_date` | When the due is payable. `generated_at` is when it was raised — a different thing |
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
| `paid_time` | Clock time, `CHAR(8)`. Separate from `paid_on` so existing date-range reports keep behaving, mirroring the fee sheet's two columns |
| `method` | UPI, card, cash, or bank transfer |
| `reference_number` | The fee gateway's own receipt, stored as given. UNIQUE — it is the idempotency key for sheet import |
| `status` | Paid, Collected, Pending, or Overdue |

When a `Paid` or `Collected` payment is linked to a due, the backend recomputes
`paid_amount` from all qualifying linked payments and updates balance/status in
the same transaction. It never increments a trusted running total. A single
`due_id` only supports a monthly payment; multi-month plans are rejected when a
due is supplied until a `payment_due_allocations` ledger is implemented.

### Fee summary sheet (import / export)

`services/fee-sheet.ts` owns the office's own fee sheet format — the layout the
fee gateway produces — and both directions share it so a column cannot mean one
thing going out and another coming back.

`GET /api/fee-dues/sheet/export` writes it; `POST /api/fee-dues/sheet/import`
reads it, raising the dues a sheet describes and then recording its payments.

Rules to preserve:

- **Import never writes `paid_amount`, `balance` or `status` directly.** It
  writes the billed figures and the payments, then calls `reconcileDuePayments`,
  which derives the rest from the payments that actually exist. This is the
  invariant that keeps a balance honest.
- **`reference_number` is the idempotency key.** Re-importing the same sheet
  updates the matching payment instead of paying a due twice.
- **A row is matched to a student by name, narrowed by Standard/Course.** The
  sheet carries no registration number and masks Mobile Number (`*******20`).
  An ambiguous or missing match is **rejected**, never guessed — a wrong guess
  bills a real family for another child.
- **Mobile Number is never written back**, for the same masking reason: the
  stored number is what the parent app logs in with.
- **Fee Head and Fees Category are derived**, not stored. `month` already holds
  the quarter, and `2026-Q2` is the sheet's "2nd Quarter Fee".
- **Institute and Branch are not stored.** They are constant for the deployment
  and are left blank on export rather than duplicated onto every student.
- Dates are day-first (`15/07/2026`, `05/08/26`) and parsed as UTC midnight so a
  date never shifts across the server's timezone.
- Each row imports in its own transaction, so one bad row does not lose a
  thousand good ones. Rejects come back with row number and reason.

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

1. Define a route, then its distance slabs and their fees.
2. Assign a student to that route **and** to one of its slabs.
3. Generate dues for a period using `POST /api/fee-dues/generate`.
4. The backend bills each student their slab's fee — or the route's flat `fee`
   when the route has no slabs — and creates one `fee_dues` row per eligible
   student. A student whose fee resolves to zero is skipped and counted in the
   response.
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
