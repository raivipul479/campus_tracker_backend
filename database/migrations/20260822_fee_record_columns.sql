-- Columns the school's fee summary sheet carries that this system had nowhere
-- to store.
--
-- The sheet is the format the fee gateway (Qfix) produces and the office already
-- works in, so import and export both speak it. Everything else in that sheet is
-- already covered: Total Amount is fee_dues.base_amount, Late Payment Charges is
-- fine, Remaining Amount is balance, Payment Mode is payments.method, and Fee
-- Head / Fees Category are derived from fee_dues.month, which already stores the
-- quarter ("2026-Q2" is the sheet's "2nd Quarter Fee").
--
-- Institute and Branch are deliberately NOT stored. They are constant for this
-- deployment and are left blank on export rather than duplicated onto every
-- student row.
--
-- All four columns are nullable and additive: nothing existing changes, and a
-- record created before this migration simply has them empty.

-- The sheet's "E-Mail Address". Not unique: siblings legitimately share a
-- parent's address, and the sheet shows exactly that (nisu152@gmail.com against
-- two children).
ALTER TABLE students
  ADD COLUMN email VARCHAR(190) NULL AFTER secondary_phone;

-- The sheet's "Due Date". generated_at records when the due was raised, which is
-- a different thing and cannot stand in for when it is payable.
ALTER TABLE fee_dues
  ADD COLUMN due_date DATE NULL AFTER month;

-- The sheet splits payment timing into "Fees Paid Date" and "Fees Paid Time".
-- paid_on stays DATE so every existing report and its BETWEEN filter keeps
-- behaving; the clock time goes in its own column, mirroring the sheet.
--
-- paid_time is CHAR(8) rather than TIME on purpose. Prisma maps a TIME column to
-- DateTime and hands back 1970-01-01T15:26:00Z, which invites a timezone bug on
-- every read for a value that is only ever validated on the way in and printed
-- back out. Stored as the sheet writes it, "15:26:00".
--
-- reference_number is the gateway's own receipt ("Q4VFQEYWS521324"), stored
-- exactly as given for reconciliation. UNIQUE so re-importing the same sheet
-- updates rather than duplicates — MySQL and MariaDB both allow many NULLs in a
-- unique index, so payments recorded inside this system are unaffected.
ALTER TABLE payments
  ADD COLUMN paid_time CHAR(8) NULL AFTER paid_on,
  ADD COLUMN reference_number VARCHAR(64) NULL AFTER method,
  ADD UNIQUE KEY uq_payments_reference_number (reference_number);
