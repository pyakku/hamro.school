# hamro.school

School management system for private schools. One academic year end to end:
setup, running the term, assessment, closing the year.

Fees are **tracked, not processed** — no payment gateway. The office records
cash, cheque and transfer payments; the system keeps the ledger and chases dues.

## Stack

| | |
|---|---|
| API | Node 22, TypeScript, Fastify 5, Prisma 7, PostgreSQL 16, Zod 4 |
| Web | React 19, Vite, TanStack Query, React Router, Tailwind 4 |
| Mobile | Flutter — parents, teachers, drivers (not started; the API serves it) |
| Push | Firebase Cloud Messaging (not wired up) |
| Repo | pnpm workspace — `apps/api`, `apps/web`, `packages/shared` |

## Running it

```bash
cp .env.example .env
pnpm install
pnpm db:up          # Postgres 16 in Docker, with the RLS-restricted app role
pnpm db:migrate
pnpm db:seed
pnpm dev            # API on :4000, web on :5173
```

Sign in with school `modelschool`, password `hamro-demo-2026`. These are
usernames rather than email addresses — nothing can be sent to them.

| Account | Role |
|---|---|
| `admin@modelschool` | School admin |
| `accounts@modelschool` | Accounts |
| `radhika.karthik@modelschool` | Teacher |
| `parent001@modelschool` | Parent |
| `student@modelschool` | Student |
| `driver@modelschool` | Driver |

On a school's own subdomain the suffix is implied, so you can type just `admin`.

The seed builds one school with two academic years, 123 students across grades
6–8, staff, a term of attendance and staff attendance, a fee ledger with real
arrears, and two grading scales. It anchors on the day it runs, so registers
stop at today and homework is due this week; `pnpm db:reset-demo && pnpm db:seed`
rebuilds just the demo school when the data goes stale.

**Not using Docker?** Run `docker/postgres/init/01-app-role.sql` against your
database as its owner first — migrations refuse to run without the `hamro_app`
role.

## Commands

```bash
pnpm dev            # both apps
pnpm test           # everything, against a real Postgres
pnpm typecheck
pnpm build
pnpm db:reset       # drop, migrate, reseed
pnpm db:studio
```

## Where things are

```
apps/api          Fastify API. Tenant isolation in src/db, auth in src/auth,
                  the policy layer in src/policy.
apps/web          React app. Sign-in screen only so far.
packages/shared   The contract: Zod schemas, money, the permission matrix,
                  i18n keys. Used by both, so neither can drift.
docs/decisions    Why the data model looks the way it does.
docs/design-system.md
CLAUDE.md         The ten architectural rules. Read before writing code.
```

## The rules that matter

Full versions in [CLAUDE.md](CLAUDE.md). In brief: every table carries
`schoolId` and isolation is enforced twice, in a Prisma extension and in
Postgres RLS; the academic year is an entity and `Enrolment` is the spine; only
raw marks are stored, never a grade letter; money is `BigInt` minor units;
calendar dates and timestamps are different types; attendance is a four-state
enum and excluded days have no record at all; identity is separate from role;
permissions are checked server-side per resource; no user-facing string lives in
the source; marks, fees and attendance are append-only audited.
