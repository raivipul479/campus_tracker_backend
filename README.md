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

- `GET /api/health`
- `GET /api/students`
- `POST /api/students`
- `PATCH /api/students/:id`
- `DELETE /api/students/:id`
- `GET /api/drivers`
- `POST /api/drivers`
- `PATCH /api/drivers/:id`
- `DELETE /api/drivers/:id`
- `GET /api/vehicles`
- `POST /api/vehicles`
- `PATCH /api/vehicles/:id`
- `DELETE /api/vehicles/:id`
- `GET /api/assignments`
- `POST /api/assignments/driver`
- `DELETE /api/assignments/driver/:assignmentId`
- `POST /api/assignments/student`
- `DELETE /api/assignments/student/:assignmentId`
- `GET /api/vehicles/:id/roster`

Vehicle assignment requests can use either a numeric vehicle id or a vehicle code like `BUS-04`.

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
