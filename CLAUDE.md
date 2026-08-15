# Hamro.school — conventions

A school management system sold to private schools internationally. One
academic year end to end: setup, running the term, assessment, closing the year.

**Read this before writing code.** The rules below are architectural, not
stylistic. Every one of them is expensive to retrofit, and several of them are
the difference between a product schools trust and one they don't.

---

## The ten rules

### 1. Multi-tenant by `schoolId`, enforced in one place

Every domain table carries `schoolId`. Forty-three of forty-five models do; the
exceptions are `School` itself and `PlatformAdmin`, which sits outside the
tenant boundary deliberately.

Two layers, and neither is optional:

- **The Prisma extension** in [apps/api/src/db/tenant.ts](apps/api/src/db/tenant.ts)
  adds `schoolId` to the `where` of every read and refuses any write aimed at
  another school. A route handler cannot forget it, because a route handler
  never writes it.
- **Postgres row-level security** on all 43 tables. The API connects as
  `hamro_app`, which every policy applies to. A connection with no
  `app.school_id` set sees zero rows — it fails closed.

**All request database work goes through `withTenant(ctx, db => …)`.** It opens
the transaction that `SET LOCAL app.school_id` needs. Two rules follow:

- No network call inside — no FCM push, no email, no upload. Do the database
  work, let `withTenant` return, then talk to the outside world.
- `rawPrisma` is not for route handlers. The only legitimate unscoped reads are
  resolving a school from a slug or id at login, and they live in `db/tenant.ts`
  and `auth/service.ts`.

Adding a model with a `schoolId`? Add it to `TENANT_MODELS` in
[apps/api/src/db/models.ts](apps/api/src/db/models.ts) and call
`SELECT enable_tenant_rls();` in the migration. Both have tests that fail if you
don't.

### 2. The academic year is an entity, not a column

A student does not have a grade or a section. An **`Enrolment`** links a student
to a grade level, a section, a roll number and an academic year. Attendance,
marks, invoices, homework and leave all hang off the enrolment.

This is what makes promotion a new row rather than an overwrite, and it is why
last year's report card still resolves after a student moves up. Never add a
`gradeLevelId` to `Student`. Never scope a term-time record to a student when it
could be scoped to an enrolment.

`Section` is also per-year: 8A in 2026–27 is a different roster and a different
class teacher from 8A in 2025–26.

### 3. Raw marks only

`Mark.rawMarks` is the only thing stored. **No letter, band, GPA, percentage,
average or rank is ever persisted.** Grades are computed at read time from raw
marks through the school's configured scale.

The scale is data: `GradingScale` → `GradingScaleVersion` → `GradingBand`.
Boundaries, labels, GPA points and the rounding rule are all rows. If you find
yourself typing `'A'`, `>= 90`, or `/ 100` anywhere in the codebase, stop.

Versions are immutable once published, and `ReportCardRun` pins the version it
published under — so editing a scale in March cannot silently rewrite the report
cards issued in December.

### 4. Money is integers in minor units

`BigInt`, minor units, with the currency and its exponent on the school. There
is no `Float` in the schema and no `number` in money arithmetic. Use
[packages/shared/src/money](packages/shared/src/money) — `add`, `applyBasisPoints`,
`allocate`, `parseDecimalString`.

Percentages of money are **basis points** (`valueBps`, `weightBps`), integers,
never fractions. `allocate` splits without losing a paisa.

Over the wire an amount is a **string** (`toWire`/`fromWire`). `JSON.stringify`
throws on a bigint, and turning it into a number to get it across is the exact
bug this all exists to prevent.

### 5. Dates versus timestamps

- A local calendar date — attendance, invoice due dates, holidays, exam dates —
  is `@db.Date` and a `YYYY-MM-DD` string on the wire.
- An event instant — audit entries, publication times, logins — is
  `@db.Timestamptz(3)`.

The school's IANA timezone (`School.timezone`) converts between them. Attendance
is taken on a school day, not at a UTC instant; getting this wrong puts
attendance on the wrong day for half the customers.

### 6. Attendance

Status is an enum: `PRESENT`, `ABSENT_UNEXPLAINED`, `ABSENT_APPROVED`, `LATE`.
Never a boolean. Approved leave and unexplained absence must stay separable in
every percentage.

**A holiday or closure has no attendance records at all** — the day leaves the
denominator instead of being marked absent. To make that recoverable,
`AttendanceSession` records that attendance *was taken* for a section on a date.
No session means the day does not count; a session with no `submittedAt` means a
teacher owes you a register. Records exist for every enrolment in a session, not
just the absentees.

### 7. Identity is separate from role

`User` is a person. `RoleAssignment` is what they may do, and one user can hold
several — the teacher who is also a parent of a child in the school is a normal
case, not an edge case. Permission resolution takes a list of roles and returns
the widest scope.

Emails are unique **per school**, not globally.

Each school lives at `<slug>.hamro.school`, and **the subdomain is the tenant**.
The API resolves it from the `Host` header and takes it over anything in the
request body, so no payload can talk its way into another school. Both halves
use `schoolSlugFromHost` from `packages/shared`, so the browser and the server
cannot disagree about what a hostname means.

Reserved subdomains (`admin`, `api`, `www`, `internal`, …) are in
`RESERVED_SUBDOMAINS` and cannot be claimed at signup. `admin.hamro.school` is
ours.

TLS is issued per school on first request — Caddy's on-demand TLS, gated by
`/internal/tls-allowed`, which says yes only for a real school. Not a wildcard
certificate: that needs DNS-01 and an API token the registrar does not offer.
Let's Encrypt allows 50 certificates per registered domain per week, which is
the ceiling on new schools per week until that changes.

### 8. Permissions are checked server-side, per resource

The matrix is [packages/shared/src/permissions](packages/shared/src/permissions):
data, shared, tested. Never write `if (user.role === 'TEACHER')` in a handler.

- `requirePermission('attendance:write')` in the route definition answers "may
  this kind of role do this at all".
- The scope resolvers in [apps/api/src/policy/guard.ts](apps/api/src/policy/guard.ts)
  answer "whose records" — `ALL`, `OWN_SECTIONS`, `OWN_CHILDREN`, `SELF` — and
  return a `where` fragment, because a check that runs after the rows are
  fetched is a check someone will forget and it leaks counts even when it works.

Accounts must never see marks, report cards or homework. That is enforced by
omission from the matrix and asserted by tests.

The web app's `can()` decides whether to render a nav item. That is a courtesy,
never a control.

### 9. No user-facing string in the source

Every string a person can read is an i18n key from
[packages/shared/src/i18n](packages/shared/src/i18n). The API sends keys, not
sentences: `{ error: { key: 'error.auth.invalid_credentials' } }`. Components
call `t()`.

School-authored text — subject names, notice bodies, grade band labels — is
**data**. It is stored and shown verbatim and never goes in the catalogue.

Interface writing, per the design system: buttons name the action ("Save
attendance", never "Submit"); the same word all the way through a flow; empty
states are invitations, not "No data found"; nothing is named after the schema —
it is "guardians", not "contact records".

### 10. Soft delete and the audit trail

`deletedAt` + `deletedByUserId`. The tenant extension hides soft-deleted rows
from reads unless the query mentions `deletedAt` explicitly.

**Money is never soft-deleted.** A deleted payment silently changes every
historical total and breaks reconciliation against a bank statement. Corrections
are a reversing row (`status: REVERSED`, `reversesPaymentId`). The database
enforces this: `DELETE` on `payments` and `payment_allocations` is revoked from
the app role.

Marks, fees and attendance write to `audit_logs`, which is **append-only** —
`UPDATE` and `DELETE` are revoked from the app role, so not even a bug in our
own audit code can rewrite history. Writes to audited models go through
`auditedWrite()`; the tenant extension throws if one doesn't.

---

## Repository

```
apps/api        Fastify 5, Prisma 7, Zod 4, Postgres
apps/web        React 19, Vite, TanStack Query, React Router, Tailwind 4
packages/shared Types, Zod schemas, money, permissions, i18n — API and web
docs/decisions  Why things are the way they are
```

`packages/shared` is the contract. A validation rule that exists in two places
will drift, and the copy that drifts is the one the server trusts.

## Getting started

```bash
cp .env.example .env
pnpm install
pnpm db:up          # Postgres in Docker, with the hamro_app role
pnpm db:migrate
pnpm db:seed
pnpm dev            # API on :4000, web on :5173
```

Sign in at http://localhost:5173 with school `greenhill` and password
`hamro-demo-2026`. Seeded accounts: `admin@`, `accounts@`,
`radhika.karthik@` (teacher), `parent001@`, `driver@` — all `@greenhill.example`.

Not using Docker? Run [docker/postgres/init/01-app-role.sql](docker/postgres/init/01-app-role.sql)
against your database as the owner first. Migrations will refuse to run without
the `hamro_app` role, on purpose — a database where RLS exists but nothing is
subject to it looks protected and is not.

## Database roles

| Role | Used by | RLS |
|---|---|---|
| `hamro` (owner) | `prisma migrate`, the seed | Exempt — it owns the tables |
| `hamro_app` | The API at runtime | Subject to every policy |

`DATABASE_URL` is the app's. `MIGRATION_DATABASE_URL` is the owner's and never
serves a request. Prisma 7 keeps them apart properly: the migration URL lives in
`prisma.config.ts`, the runtime one in the adapter.

## Auth

Access token: short-lived JWT (15m), carrying school, user and roles — never
permissions, which are re-derived server-side per request so a revocation takes
effect immediately.

Refresh token: **not** a JWT. An opaque random string prefixed with the school
id (`<schoolId>.<secret>`, needed to open the tenant scope before the lookup),
stored only as a SHA-256 hash, rotated on every use with reuse detection. A
replayed token revokes the whole chain — we cannot tell a retry from a theft, so
we assume the worse case.

Browser: httpOnly cookie. Flutter: `?client=mobile` returns it in the body.

Passwords: argon2id, 19 MiB / 2 passes, rehashed on login when the parameters
move. Login failures are indistinguishable — wrong password, unknown user and
unknown school all return `INVALID_CREDENTIALS`, because the difference tells an
attacker which families attend which school.

## Testing

```bash
pnpm test           # everything
```

Tests run against a real Postgres. The things most worth testing here — RLS, an
append-only grant, a partial unique index — only exist in the database, and a
mock would happily agree with a bug.

Rate limits stay **on** in tests; tests that don't care about them use different
client IPs. A limiter disabled in test is a limiter nobody notices breaking.

## Working style

- Small, focused commits with clear messages.
- When a decision has a real trade-off, say what the options are and recommend
  one rather than picking silently.
- If something asked for is a bad idea, say so.

## Roadmap

One session each, in order. Each depends on the ones above it.

1. **School setup** — grades, sections, subjects, staff, holidays.
2. **Student import** — spreadsheet upload, column mapping, validation, preview.
   Early, because it is how real data arrives and the first thing a school judges.
3. **Attendance** — the daily habit. If it is not fast on a phone, nothing else
   matters. See the attendance UX notes in the design system.
4. **Homework and notices**, with FCM — the first thing parents see.
5. **Exams, marks and report cards** — the grading scale engine is the hard part.
6. **Fee tracking** — structures, invoices, receipts, dues.
7. **Leave and closures.**
8. **Promotion** — needs all of the above.
9. **Flutter app** — parents, then teachers, then the driver.

Bus tracking last, and only once a school has asked for it. It needs a
foreground service and a persistent notification on Android, and it is the one
item that is not just a database with permissions.

## Design

[docs/design-system.md](docs/design-system.md). The short version: every number is mono, every prose string is Mukta; jade means
present or paid, stamp means absent or overdue, marigold means active or late,
and none of the three is ever decorative; 3px radius everywhere; hard offset
shadows only on primary actions; visible focus rings, always.
