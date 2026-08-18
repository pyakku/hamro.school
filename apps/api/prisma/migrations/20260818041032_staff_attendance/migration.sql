-- AlterTable
ALTER TABLE "platform_settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "staff_attendance_days" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "taken_by_user_id" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "locked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_attendance_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_attendance_records" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "day_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "leave_request_id" TEXT,
    "minutes_late" INTEGER,
    "remark" TEXT,
    "recorded_by_user_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_attendance_days_school_id_academic_year_id_date_idx" ON "staff_attendance_days"("school_id", "academic_year_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_attendance_days_school_id_date_key" ON "staff_attendance_days"("school_id", "date");

-- CreateIndex
CREATE INDEX "staff_attendance_records_school_id_staff_id_date_idx" ON "staff_attendance_records"("school_id", "staff_id", "date");

-- CreateIndex
CREATE INDEX "staff_attendance_records_school_id_date_status_idx" ON "staff_attendance_records"("school_id", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "staff_attendance_records_day_id_staff_id_key" ON "staff_attendance_records"("day_id", "staff_id");

-- AddForeignKey
ALTER TABLE "staff_attendance_days" ADD CONSTRAINT "staff_attendance_days_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance_days" ADD CONSTRAINT "staff_attendance_days_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance_days" ADD CONSTRAINT "staff_attendance_days_taken_by_user_id_fkey" FOREIGN KEY ("taken_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance_records" ADD CONSTRAINT "staff_attendance_records_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance_records" ADD CONSTRAINT "staff_attendance_records_day_id_fkey" FOREIGN KEY ("day_id") REFERENCES "staff_attendance_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance_records" ADD CONSTRAINT "staff_attendance_records_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance_records" ADD CONSTRAINT "staff_attendance_records_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "staff_leave_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance_records" ADD CONSTRAINT "staff_attendance_records_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Tenant isolation ────────────────────────────────────────────────────────
--
-- Two new tables carrying school_id, so two new tables that must fail closed.
-- enable_tenant_rls() finds every table with the column and (re)applies the
-- policy, so this is the one line rather than a pair of hand-written policies
-- that could drift from the others.
SELECT enable_tenant_rls();

-- ── The audit trail ─────────────────────────────────────────────────────────
--
-- Staff attendance decides pay and cover, so it is argued about for the same
-- reasons marks and fees are: someone will one day need to know who marked a
-- teacher absent on a Tuesday in March, and when. Writes go through
-- auditedWrite(), and the tenant extension throws if one does not.
--
-- DELETE is deliberately *not* revoked here, unlike payments. Re-taking a
-- return replaces its records, exactly as re-taking a class register does, and
-- the two attendance systems should not disagree about something so basic. The
-- protection is the append-only trail, which records the before and after of
-- every change; the ledger rule exists because money must reconcile against a
-- bank statement, which is not a property attendance has.
