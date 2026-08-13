# 0001 — Data model

Status: **accepted**, implemented in the scaffold session.
Schema: [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma) — 43 models, validates against Prisma 6.

Everything you specified is in. This document covers the calls I made where you
gave me latitude, and the places where I think your instructions need one more
turn of the screw to actually hold.

---

## 1. Decisions I made where you left latitude

**`GradeLevel`, not `Grade`.** A codebase that computes grade letters cannot also
have a model called `Grade` — every review of the grading engine would have to
disambiguate. `GradeLevel.level` is an integer and is the basis of promotion
(next year's level = this year's + 1).

**Users are scoped to a school.** `@@unique([schoolId, email])`, not a global
unique email. The same person at two schools gets two user rows. A global
identity with school memberships is more elegant and I don't think it's worth
it: it puts a table outside the tenant boundary on day one, and cross-school
parents are rare enough to handle by hand. Reversible later; the reverse is not.

**Platform staff are a separate table.** `PlatformAdmin` sits outside `School`
entirely rather than being a seventh `Role`. If our own support access came
through `RoleAssignment`, a bug in the role check would be a cross-tenant leak
in the same code path as everything else. Different table, different middleware.

**Money is `BigInt`, not `Int`.** A 32-bit integer overflows at ~21M major units
in a 2-decimal currency. Annual totals in IDR, VND or a devalued currency get
there. The cost is that `BigInt` doesn't survive `JSON.stringify` — so
`packages/shared` will carry a `Money` codec that serialises as a decimal string
and the API contract will never emit a JS number for money.

**Marks are `Decimal(7,2)`, not integers.** Half marks are routine and Postgres
`numeric` is exact, so this honours "no floats" without inventing centimark
units. Percentages and weights that could produce fractions are stored as
**basis points** (`weightBps`, `valueBps`) — integers — so no percentage of
money is ever computed from a fraction.

**Two leave tables, not one.** `StudentLeaveRequest` and `StaffLeaveRequest`.
They look alike and behave differently: student leave decides an attendance
status, staff leave needs cover. One table with two nullable halves would leak
that confusion into every query.

**Timetables are effective-dated.** `TimetableEntry.effectiveFrom/effectiveTo`
plus a separate `PeriodSlot` bell schedule. Timetables change in February and
you still need January's to be resolvable — same argument as the academic year.

**`School.workingDays`.** Mon–Fri is not universal; Gulf schools run Sun–Thu.
This feeds the attendance denominator alongside holidays and closures.

**Invoices snapshot what they billed.** `InvoiceLine.description` and
`Invoice.currency` are copies, not lookups. Renaming a fee item must not change
what last term's invoice says.

**`Student.gender` is free text, not an enum.** Categories differ by country and
schools have to record whatever their government form asks for.

---

## 2. Four places where your instructions need one more step

These follow from your own principles; I think they're bugs if we skip them.

### 2.1 An attendance session, not just attendance records

You said: on a holiday or closure, no record exists, so the day leaves the
denominator. Right — but then "no records for 8A on Tuesday" is ambiguous
between *holiday*, *not taken yet*, and *the teacher forgot*. The denominator
becomes unrecoverable and no one can chase a missing register.

So `AttendanceSession` records that attendance **was taken** for a section on a
local date, and `AttendanceRecord` hangs off it. No session = the day doesn't
count. A session with a null `submittedAt` = someone owes you a register.

Related: I store an explicit row for **every** student in a session, not just
the absentees. The UI still works exception-first — everyone starts present,
you tap the three who aren't. But storing only exceptions breaks when a student
joins mid-term or a record is corrected, and the volume is nothing (120
students × 200 days ≈ 24k rows a year).

### 2.2 Grading scales must be versioned

"Compute grades at read time from the scale" is correct, and it has a sharp
edge: if a school edits its scale in March, every report card issued in
December silently changes. A parent disputing a grade would be shown different
letters than the ones they were sent.

`GradingScale` → `GradingScaleVersion` → `GradingBand`. A version is immutable
once published; edits create a new one. `ReportCardRun` pins the version it was
published under. Nothing denormalised, no letter stored — the card is still
computed from raw marks, but through a frozen scale.

`GradingScale.roundingDecimals` is also data, because 79.995 → A or B is a
school's policy decision and it must not live in our code.

### 2.3 Payments are never soft-deleted

You asked for soft delete plus audit on fees. Soft-deleting money is wrong even
with an audit log — a deleted payment silently changes every historical total,
and reconciliation against a bank statement stops working. `Payment` has no
`deletedAt`. A mistake is corrected by a **reversing row** (`status: REVERSED`,
`reversesPaymentId`, `reversalReason`). Soft delete stays on students, staff,
sections, homework, notices, marks and invoices.

Payments also allocate across invoices (`PaymentAllocation`) rather than
belonging to one. A parent paying a round sum against three outstanding terms
is one receipt and three allocations; without this the ledger can't represent
what actually happened at the counter.

### 2.4 Postgres RLS underneath the Prisma extension

You asked for tenant scoping in one place. I'd like it in two. The extension
catches every query the app makes; it does not catch a raw query, a migration
script, a background job written in a hurry, or a `psql` session. RLS on
`school_id` with a `SET LOCAL app.school_id` per request is a database-level
backstop that costs a policy per table and one line in the connection wrapper.

Given "fatal to the business", I'd take both. If you'd rather ship faster, the
extension alone is defensible for now and RLS is retrofittable — unlike almost
everything else in this document.

---

## 3. Things the migration must add that Prisma can't express

All of these now live in
[`20260813180000_tenant_isolation`](../../apps/api/prisma/migrations/20260813180000_tenant_isolation/migration.sql):

- **Partial unique indexes for soft delete**, on sections, subjects and grade
  levels — the structures schools genuinely delete and recreate. Admission
  numbers and employee codes deliberately keep their hard uniqueness: an
  identity number issued to a person should not be silently reissued to someone
  else. Restore the record instead.
- **Snake_case columns.** The schema started with camelCase columns under
  snake_case table names, and the first RLS function — which looks for a
  `school_id` column — matched zero tables and silently protected nothing. All
  406 columns now carry `@map`. The lesson is in the tests: the RLS test asserts
  no table with a `school_id` is left without a policy.
- **One current year per school.** `CREATE UNIQUE INDEX ... ON academic_years (school_id) WHERE is_current`.
- **`audit_logs` is append-only.** Revoke `UPDATE`/`DELETE` from the app role.
- **Invoice and receipt numbering.** Sequential per school per year, allocated
  inside the transaction that creates the row.

---

## 4. Two questions — both now answered

**Decided:** no composite tenant foreign keys; RLS instead. **Decided:**
attendance is daily, with the schema ready for per-period without a migration.
The original framing is kept below.


**a) Composite tenant foreign keys?** Right now FKs are single-column
(`sectionId`), so tenancy is enforced by the extension and RLS but the database
would technically permit an enrolment pointing at another school's section.
Composite FKs (`[schoolId, sectionId] → [schoolId, id]`) make that
structurally impossible. Cost: every relation in the schema gets noisier, and
Prisma's generated types follow. **My recommendation:** skip it, take RLS
instead — it covers the realistic failure (a query forgetting the filter) rather
than the unrealistic one (a service deliberately writing a mismatched pair).

**b) Per-period attendance — now or later?** The schema supports it
(`AttendanceSession.periodSlotId` + `sessionKey`, with `"DAY"` for daily) so
adding it later needs no migration of the uniqueness rule. I've assumed daily
attendance for the seed and for session 3. Say if any target school takes it
every period, because it changes the attendance UI substantially.

---

## Model inventory

| Area | Models |
|---|---|
| Tenant | `School` |
| Calendar | `AcademicYear`, `Term`, `Holiday`, `Closure` |
| Identity | `User`, `PlatformAdmin`, `RoleAssignment`, `RefreshToken`, `PasswordResetToken` |
| People | `Student`, `Guardian`, `StudentGuardian`, `StaffProfile` |
| Structure | `GradeLevel`, `Section`, `Subject`, `SubjectOffering`, `TeachingAssignment` |
| Spine | `Enrolment` |
| Timetable | `PeriodSlot`, `TimetableEntry` |
| Attendance | `AttendanceSession`, `AttendanceRecord`, `StudentLeaveRequest`, `StaffLeaveRequest` |
| Communication | `HomeworkPost`, `Notice`, `DeviceToken` |
| Assessment | `Exam`, `ExamSubject`, `Mark`, `GradingScale`, `GradingScaleVersion`, `GradingBand`, `GradingScaleAssignment`, `ReportCardRun` |
| Fees | `FeeStructure`, `FeeItem`, `FeeConcession`, `Invoice`, `InvoiceLine`, `Payment`, `PaymentAllocation` |
| Audit | `AuditLog` |
