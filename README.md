# Campus Tracker Backend

Node.js TypeScript API for the campus route frontend. It stores students, drivers, vehicles, and assignments in MySQL using Prisma ORM.

## Setup

1. Create a MySQL database:

```sql
CREATE DATABASE campus_tracker CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Update `.env` with your MySQL username and password.

4. Install dependencies and create tables:

```bash
npm install
npm run prisma:generate
npm run db:setup
```

5. Start the API:

```bash
npm run dev
```

The API runs on `http://localhost:4000` by default.

## Main Endpoints

Public (no auth):

- `GET /api/health`
- `POST /api/auth/super-admin/login`
- `POST /api/mobile-auth/parent/request-otp`
- `POST /api/mobile-auth/parent/verify-otp`
- `POST /api/mobile-auth/driver/request-otp`
- `POST /api/mobile-auth/driver/verify-otp`

Parent session (bearer token from mobile-auth, scoped to the signed-in phone number):

- `GET /api/parent/children`
- `GET /api/parent/vehicles`
- `GET /api/parent/fee-dues`
- `GET /api/parent/payments`
- `GET /api/parent/transport-logs`

Driver session (bearer token from mobile-auth, scoped to the signed-in phone number):

- `GET /api/driver/me`
- `GET /api/driver/roster`
- `POST /api/driver/transport-logs`

Everything below requires the super-admin bearer token (`GET /api/auth/super-admin/me` to check it):

- `GET /api/stats`
- `GET /api/students`, `POST /api/students`, `PATCH /api/students/:id`, `DELETE /api/students/:id`
- `GET /api/drivers`, `POST /api/drivers`, `PATCH /api/drivers/:id`, `DELETE /api/drivers/:id`
- `GET /api/vehicles`, `GET /api/vehicles/:id`, `GET /api/vehicles/:id/roster`, `POST /api/vehicles`, `PATCH /api/vehicles/:id`, `DELETE /api/vehicles/:id`
- `GET /api/routes`, `GET /api/routes/:id`, `POST /api/routes`, `PATCH /api/routes/:id`, `DELETE /api/routes/:id`
- `GET /api/assignments`
- `GET /api/assignments/driver-history/:driverId`, `GET /api/assignments/vehicle-history/:vehicleId`, `GET /api/assignments/student-history/:studentId`
- `POST /api/assignments/driver`, `DELETE /api/assignments/driver/by-driver/:driverId`, `DELETE /api/assignments/driver/:assignmentId`
- `POST /api/assignments/student`, `POST /api/assignments/students/bulk`, `DELETE /api/assignments/student/by-student/:studentId`, `DELETE /api/assignments/student/:assignmentId`
- `GET /api/fee-dues`, `GET /api/fee-dues/summary`, `GET /api/fee-dues/report`, `POST /api/fee-dues/generate`, `PATCH /api/fee-dues/:id`
- `GET /api/payments`, `POST /api/payments`, `PATCH /api/payments/:id`
- `GET /api/transport-logs`, `POST /api/transport-logs`

Vehicle and driver requests can use either a numeric id or a code like `BUS-04` where noted (`lookup.ts` resolves the ambiguity).

## Backend Structure

```text
src/
  controllers/  HTTP request and response handling
  services/     Validation, business rules, and response mapping
  models/       Prisma ORM persistence
  routes/       Express route definitions
  prisma.ts     Shared Prisma client
  db.ts         MySQL connection pool
  app.ts        Express app setup
  server.ts     Server entry point
```

Request flow:

```text
routes -> controllers -> services -> models -> Prisma -> MySQL
```

## ORM

This backend uses Prisma ORM.

- Prisma schema: `prisma/schema.prisma`
- Generate client: `npm run prisma:generate`
- Push schema to database: `npm run prisma:push`
- Existing SQL seed/setup script: `npm run db:setup`

## Example Requests

Add a student:

```json
POST /api/students
{
  "f": "251",
  "regNo": "JPIS/5441/25",
  "name": "Kaira Khandelwal",
  "class": "Grade 4",
  "kms": "25",
  "tagNo": "T-A",
  "area": "Burmese Colony",
  "phone": "7568089869",
  "secondaryPhone": "7568089869"
}
```

Add a driver:

```json
POST /api/drivers
{
  "name": "Ramesh Kumar",
  "phone": "+91 98107 24561",
  "licenseNumber": "DL-0420110123456",
  "status": "Available",
  "docs": "Verified"
}
```

Add a vehicle:

```json
POST /api/vehicles
{
  "id": "BUS-04",
  "plate": "DL 1PC 4182",
  "route": "North Loop",
  "status": "At school"
}
```

Assign a driver to a vehicle:

```json
POST /api/assignments/driver
{
  "driverId": 1,
  "vehicleId": "BUS-04",
  "route": "North Loop"
}
```

Assign a student to a vehicle:

```json
POST /api/assignments/student
{
  "studentId": 1,
  "vehicleId": "BUS-04",
  "pickupOrder": 1
}
```
