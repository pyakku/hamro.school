/**
 * Demo data: one school, two academic years, 120 students, a term of
 * attendance, a fee ledger with real arrears.
 *
 * Two jobs. It has to be good enough to develop against — every screen we
 * build over the next few sessions should have something plausible in it — and
 * good enough to demo to a school without anyone squinting. So the data has
 * edges: a student who joined late, a section with poor attendance, an invoice
 * 42 days overdue, a part payment, a guardian with two children.
 *
 * Deterministic. The PRNG is seeded, so a bug you see today is a bug you can
 * see again tomorrow.
 *
 * Runs as the migration role, which owns the tables and is therefore not
 * subject to row-level security — that is what lets it write a whole school in
 * one pass.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { AttendanceStatus, Role } from '../src/generated/prisma/enums.js';

const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Set MIGRATION_DATABASE_URL (see .env.example) before seeding.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ── Determinism ────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260813);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const chance = (probability: number): boolean => random() < probability;
const between = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));

/** A local calendar date. Attendance is a date, never an instant. */
const date = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day));

const addDays = (from: Date, days: number): Date =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

/** A time-of-day for the bell schedule. Prisma maps @db.Time from a Date. */
const time = (hour: number, minute: number): Date => new Date(Date.UTC(1970, 0, 1, hour, minute));

const DEMO_PASSWORD = 'hamro-demo-2026';

const SCHOOL_TIMEZONE = 'Asia/Kolkata';

/**
 * The demo's "today", read in the school's timezone.
 *
 * Everything time-sensitive below hangs off this rather than a date typed into
 * the file. A seed anchored to the afternoon it was written looks fine that
 * week and then quietly rots: registers stop before today, homework is all
 * overdue, and the first screen anybody opens is empty. Demo data has to be
 * true on the day it is shown.
 */
const DEMO_TODAY: Date = (() => {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
})();

/** Every identifier in this school is `<username>@modelschool`. */
const SCHOOL_SLUG = 'modelschool';

// ── Name pools. International, because the customers are. ──────────────────

const GIVEN_NAMES = [
  'Sofia', 'Arjun', 'Léa', 'Daniel', 'Mei', 'Omar', 'Grace', 'Tomás', 'Aisha', 'Nikhil',
  'Yuki', 'Ravi', 'Amara', 'Lucas', 'Priya', 'Noah', 'Zara', 'Kofi', 'Elena', 'Hassan',
  'Ananya', 'Mateo', 'Chen', 'Fatima', 'Diego', 'Nadia', 'Ibrahim', 'Sara', 'Kenji', 'Maya',
  'Rohan', 'Isabel', 'Tariq', 'Anika', 'Pedro', 'Leila', 'Samuel', 'Ines', 'Jamal', 'Hana',
];

const FAMILY_NAMES = [
  'Almeida', 'Mehta', 'Dubois', 'Okafor', 'Tanaka', 'Haddad', 'Mwangi', 'Silva', 'Khan', 'Sharma',
  'Nakamura', 'Patel', 'Diallo', 'Fernandes', 'Rao', 'Andersen', 'Ahmed', 'Osei', 'Petrova', 'Rahman',
  'Gurung', 'Rossi', 'Wang', 'Bennani', 'Morales', 'Karimi', 'Traoré', 'Costa', 'Yamada', 'Thapa',
];

const STAFF_NAMES: Array<[string, string]> = [
  ['Radhika', 'Karthik'], ['James', 'Oduya'], ['Priya', 'Nair'], ['Marco', 'Bellini'],
  ['Sunita', 'Rana'], ['David', 'Mensah'], ['Ayesha', 'Siddiqui'], ['Ken', 'Watanabe'],
  ['Elena', 'Marković'], ['Bishnu', 'Adhikari'], ['Claire', 'Dupont'], ['Ahmed', 'Zaki'],
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function hash(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

async function main(): Promise<void> {
  const existing = await prisma.school.findUnique({ where: { slug: SCHOOL_SLUG } });
  if (existing) {
    throw new Error(
      'The demo school already exists. Run `pnpm db:reset` to rebuild from scratch — ' +
        'the seed deliberately does not try to merge into a database that already has data.',
    );
  }

  console.log('Seeding Model School…');

  // ── School ───────────────────────────────────────────────────────────────
  const school = await prisma.school.create({
    data: {
      slug: SCHOOL_SLUG,
      name: 'Model School',
      legalName: 'Model School Pvt. Ltd.',
      timezone: SCHOOL_TIMEZONE,
      currency: 'INR',
      currencyMinorUnits: 2,
      defaultLocale: 'en',
      workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      city: 'Kalimpong',
      country: 'IN',
      plan: 'BETA',
      onboardedAt: new Date(),
      email: 'office@modelschool.example',
      phone: '+91-3552-255100',
    },
  });
  const schoolId = school.id;

  // ── Academic years ───────────────────────────────────────────────────────
  // Last year is closed and this one is running: that is what makes promotion,
  // and "last year's report card still resolves", demonstrable on day one.
  const lastYear = await prisma.academicYear.create({
    data: {
      schoolId,
      name: '2025–26',
      startDate: date(2025, 4, 1),
      endDate: date(2026, 3, 31),
      status: 'CLOSED',
      isCurrent: false,
    },
  });

  const thisYear = await prisma.academicYear.create({
    data: {
      schoolId,
      name: '2026–27',
      startDate: date(2026, 4, 1),
      endDate: date(2027, 3, 31),
      status: 'ACTIVE',
      isCurrent: true,
    },
  });

  const termSpans: Array<[string, number, Date, Date]> = [
    ['Term 1', 1, date(2026, 4, 1), date(2026, 8, 31)],
    ['Term 2', 2, date(2026, 9, 1), date(2026, 12, 20)],
    ['Term 3', 3, date(2027, 1, 5), date(2027, 3, 31)],
  ];

  const terms = [];
  for (const [name, sequence, startDate, endDate] of termSpans) {
    terms.push(
      await prisma.term.create({
        data: { schoolId, academicYearId: thisYear.id, name, sequence, startDate, endDate },
      }),
    );
  }
  const term1 = terms[0]!;

  for (const [name, sequence, startDate, endDate] of termSpans) {
    await prisma.term.create({
      data: {
        schoolId,
        academicYearId: lastYear.id,
        name,
        sequence,
        startDate: addDays(startDate, -365),
        endDate: addDays(endDate, -365),
      },
    });
  }

  // ── Grade levels and subjects ────────────────────────────────────────────
  const gradeLevels = [];
  for (const level of [6, 7, 8]) {
    gradeLevels.push(
      await prisma.gradeLevel.create({
        data: { schoolId, name: `Grade ${level}`, level, stage: 'Middle' },
      }),
    );
  }

  const subjectSpecs: Array<[string, string, boolean]> = [
    ['MATH', 'Mathematics', true],
    ['SCI', 'Science', true],
    ['ENG', 'English', true],
    ['HUM', 'Humanities', true],
    ['NEP', 'Nepali', true],
    ['CS', 'Computer Science', true],
    ['PE', 'Physical Education', false],
  ];

  const subjects = [];
  for (const [code, name, isExaminable] of subjectSpecs) {
    subjects.push(await prisma.subject.create({ data: { schoolId, code, name, isExaminable } }));
  }
  const examinable = subjects.filter((subject) => subject.isExaminable);

  // ── Staff ────────────────────────────────────────────────────────────────
  const passwordHash = await hash(DEMO_PASSWORD);

  async function createUser(
    firstName: string,
    lastName: string,
    username: string,
    roles: Role[],
  ): Promise<string> {
    const user = await prisma.user.create({
      data: {
        schoolId,
        identifier: `${username}@${SCHOOL_SLUG}`,
        username,
        // No contact address on seeded accounts: they are fictional people and
        // nothing should ever try to email them.
        contactEmail: null,
        passwordHash,
        firstName,
        lastName,
        roleAssignments: { create: roles.map((role) => ({ schoolId, role })) },
      },
    });
    return user.id;
  }

  const adminUserId = await createUser('Meera', 'Joshi', 'admin', ['SCHOOL_ADMIN']);
  await prisma.staffProfile.create({
    data: {
      schoolId,
      userId: adminUserId,
      employeeCode: 'EMP-001',
      designation: 'Principal',
      joinedOn: date(2019, 4, 1),
    },
  });

  const accountsUserId = await createUser('Suresh', 'Baral', 'accounts', ['ACCOUNTS']);
  await prisma.staffProfile.create({
    data: {
      schoolId,
      userId: accountsUserId,
      employeeCode: 'EMP-002',
      designation: 'Accounts officer',
      joinedOn: date(2021, 6, 1),
    },
  });

  const driverUserId = await createUser('Bikash', 'Tamang', 'driver', ['DRIVER']);
  await prisma.staffProfile.create({
    data: {
      schoolId,
      userId: driverUserId,
      employeeCode: 'EMP-003',
      designation: 'Bus driver',
      joinedOn: date(2023, 1, 15),
      licenceNumber: 'DL-44-2023-8891',
    },
  });

  const teachers = [];
  for (const [index, [firstName, lastName]] of STAFF_NAMES.entries()) {
    const username = `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z]/g, '')}`;
    const userId = await createUser(firstName, lastName, username, ['TEACHER']);
    const staff = await prisma.staffProfile.create({
      data: {
        schoolId,
        userId,
        employeeCode: `EMP-${pad(index + 10, 3)}`,
        designation: 'Teacher',
        department: pick(['Science', 'Languages', 'Humanities', 'Mathematics']),
        joinedOn: date(between(2018, 2025), between(1, 12), between(1, 28)),
      },
    });
    teachers.push({ ...staff, userId });
  }

  // ── Sections, for both years ─────────────────────────────────────────────
  interface SectionRow {
    id: string;
    name: string;
    gradeLevelId: string;
    level: number;
    academicYearId: string;
  }

  const sections: SectionRow[] = [];
  let teacherCursor = 0;

  for (const year of [lastYear, thisYear]) {
    for (const gradeLevel of gradeLevels) {
      for (const name of ['A', 'B']) {
        const classTeacher = teachers[teacherCursor % teachers.length]!;
        teacherCursor += 1;
        const section = await prisma.section.create({
          data: {
            schoolId,
            academicYearId: year.id,
            gradeLevelId: gradeLevel.id,
            name,
            capacity: 30,
            room: `${gradeLevel.level}${name}`,
            classTeacherId: classTeacher.id,
          },
        });
        sections.push({
          id: section.id,
          name,
          gradeLevelId: gradeLevel.id,
          level: gradeLevel.level,
          academicYearId: year.id,
        });
      }
    }
  }

  const thisYearSections = sections.filter((section) => section.academicYearId === thisYear.id);
  const lastYearSections = sections.filter((section) => section.academicYearId === lastYear.id);

  // ── Curriculum and teaching assignments ──────────────────────────────────
  for (const year of [lastYear, thisYear]) {
    for (const gradeLevel of gradeLevels) {
      for (const subject of subjects) {
        await prisma.subjectOffering.create({
          data: {
            schoolId,
            academicYearId: year.id,
            gradeLevelId: gradeLevel.id,
            subjectId: subject.id,
            isElective: subject.code === 'CS',
            weightBps: subject.isExaminable ? 10_000 : 0,
          },
        });
      }
    }
  }

  let assignmentCursor = 0;
  for (const section of sections) {
    for (const subject of subjects) {
      const teacher = teachers[assignmentCursor % teachers.length]!;
      assignmentCursor += 1;
      await prisma.teachingAssignment.create({
        data: {
          schoolId,
          academicYearId: section.academicYearId,
          staffId: teacher.id,
          sectionId: section.id,
          subjectId: subject.id,
        },
      });
    }
  }

  // ── Bell schedule and timetable ──────────────────────────────────────────
  const slotSpecs: Array<[string, number, Date, Date, boolean]> = [
    ['Assembly', 1, time(8, 0), time(8, 15), false],
    ['Period 1', 2, time(8, 20), time(9, 5), true],
    ['Period 2', 3, time(9, 10), time(9, 55), true],
    ['Break', 4, time(9, 55), time(10, 15), false],
    ['Period 3', 5, time(10, 15), time(11, 0), true],
    ['Period 4', 6, time(11, 5), time(11, 50), true],
    ['Lunch', 7, time(11, 50), time(12, 30), false],
    ['Period 5', 8, time(12, 30), time(13, 15), true],
    ['Period 6', 9, time(13, 20), time(14, 5), true],
  ];

  const periodSlots = [];
  for (const [name, sequence, startTime, endTime, isTeaching] of slotSpecs) {
    periodSlots.push(
      await prisma.periodSlot.create({
        data: { schoolId, academicYearId: thisYear.id, name, sequence, startTime, endTime, isTeaching },
      }),
    );
  }
  const teachingSlots = periodSlots.filter((slot) => slot.isTeaching);

  const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
  for (const section of thisYearSections) {
    const assignments = await prisma.teachingAssignment.findMany({
      where: { sectionId: section.id },
      select: { subjectId: true, staffId: true },
    });

    for (const dayOfWeek of weekdays) {
      for (const [index, slot] of teachingSlots.entries()) {
        const assignment = assignments[(index + weekdays.indexOf(dayOfWeek)) % assignments.length]!;
        await prisma.timetableEntry.create({
          data: {
            schoolId,
            academicYearId: thisYear.id,
            sectionId: section.id,
            periodSlotId: slot.id,
            subjectId: assignment.subjectId,
            staffId: assignment.staffId,
            dayOfWeek,
            room: `${section.level}${section.name}`,
            effectiveFrom: thisYear.startDate,
          },
        });
      }
    }
  }

  // ── Students, guardians, enrolments ──────────────────────────────────────
  //
  // Grades 7 and 8 were here last year and were promoted into this one, so
  // promotedToEnrolmentId has something real in it. Grade 6 are new admissions.

  interface StudentRow {
    id: string;
    firstName: string;
    lastName: string;
    enrolmentId: string;
    sectionId: string;
    level: number;
  }

  const studentRows: StudentRow[] = [];
  let admissionCounter = 1;
  let guardianCounter = 0;
  let lastGuardianId: string | null = null;

  for (const section of thisYearSections) {
    const classSize = between(18, 22);

    for (let rollNumber = 1; rollNumber <= classSize; rollNumber += 1) {
      const firstName = pick(GIVEN_NAMES);
      const lastName = pick(FAMILY_NAMES);
      const admissionYear = section.level === 6 ? 2026 : between(2023, 2025);

      const student = await prisma.student.create({
        data: {
          schoolId,
          admissionNumber: `GH-${admissionYear}-${pad(admissionCounter, 4)}`,
          firstName,
          lastName,
          gender: pick(['female', 'male']),
          dateOfBirth: date(2026 - (section.level + 5), between(1, 12), between(1, 28)),
          admissionDate: date(admissionYear, 4, between(1, 20)),
          nationality: pick(['Nepali', 'Indian', 'British', 'Japanese', 'Kenyan']),
          bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'O-']),
        },
      });
      admissionCounter += 1;

      // Roughly one family in twelve has a sibling already in the school, so
      // the guardian is reused. Sibling discounts need this to be real.
      let guardianId: string;
      if (lastGuardianId && chance(0.08)) {
        guardianId = lastGuardianId;
      } else {
        guardianCounter += 1;
        const guardianFirst = pick(GIVEN_NAMES);
        const guardianUserId = await createUser(
          guardianFirst,
          lastName,
          `parent${pad(guardianCounter, 3)}`,
          ['PARENT'],
        );
        const guardian = await prisma.guardian.create({
          data: {
            schoolId,
            userId: guardianUserId,
            firstName: guardianFirst,
            lastName,
            phone: `+977-98${between(10000000, 99999999)}`,
            email: `parent${pad(guardianCounter, 3)}@modelschool.example`,
            occupation: pick(['Engineer', 'Doctor', 'Shopkeeper', 'Teacher', 'Civil servant']),
          },
        });
        guardianId = guardian.id;
        lastGuardianId = guardian.id;
      }

      await prisma.studentGuardian.create({
        data: {
          schoolId,
          studentId: student.id,
          guardianId,
          relation: pick(['FATHER', 'MOTHER', 'GUARDIAN']),
          isPrimary: true,
        },
      });

      // A couple of students join after the term starts — the case that
      // breaks attendance percentages if the denominator is naive.
      const joinedLate = chance(0.03);

      const enrolment = await prisma.enrolment.create({
        data: {
          schoolId,
          academicYearId: thisYear.id,
          studentId: student.id,
          gradeLevelId: section.gradeLevelId,
          sectionId: section.id,
          rollNumber,
          status: 'ACTIVE',
          enrolledOn: joinedLate ? date(2026, 6, between(1, 20)) : thisYear.startDate,
        },
      });

      // Returning students have last year's enrolment too, one grade below,
      // linked forward by the promotion.
      if (section.level > 6) {
        const previousSection = lastYearSections.find(
          (candidate) => candidate.level === section.level - 1 && candidate.name === section.name,
        );
        if (previousSection) {
          await prisma.enrolment.create({
            data: {
              schoolId,
              academicYearId: lastYear.id,
              studentId: student.id,
              gradeLevelId: previousSection.gradeLevelId,
              sectionId: previousSection.id,
              rollNumber,
              status: 'COMPLETED',
              enrolledOn: lastYear.startDate,
              exitedOn: lastYear.endDate,
              promotedToEnrolmentId: enrolment.id,
            },
          });
        }
      }

      studentRows.push({
        id: student.id,
        firstName,
        lastName,
        enrolmentId: enrolment.id,
        sectionId: section.id,
        level: section.level,
      });
    }
  }

  /**
   * One student login.
   *
   * Older students sign in themselves — and the STUDENT role is the narrowest
   * one that still sees academic records, so it is the one most likely to be
   * got wrong. Without an account to sign in as, nobody ever looks at it.
   *
   * The account hangs off an existing Student row rather than inventing a
   * person: `Student.userId` is how identity attaches to a child, and a login
   * with no student record behind it would see nothing and prove nothing.
   */
  const studentLogin = studentRows.find((row) => row.level === 8) ?? studentRows[0]!;
  const studentUserId = await createUser(
    studentLogin.firstName,
    studentLogin.lastName,
    'student',
    ['STUDENT'],
  );
  await prisma.student.update({
    where: { id: studentLogin.id },
    data: { userId: studentUserId },
  });

  // ── Grading scales ───────────────────────────────────────────────────────
  //
  // Two of them, because the whole point is that a school configures its own.
  // Not one letter or boundary in this codebase — it is all rows.

  const percentageScale = await prisma.gradingScale.create({
    data: {
      schoolId,
      name: 'Percentage (A+ to E)',
      type: 'PERCENTAGE',
      aggregation: 'WEIGHTED_MEAN',
      roundingDecimals: 2,
    },
  });

  const percentageVersion = await prisma.gradingScaleVersion.create({
    data: { schoolId, gradingScaleId: percentageScale.id, version: 1, publishedAt: new Date() },
  });

  const bands: Array<[string, number, number, boolean, string]> = [
    ['A+', 90, 100.001, true, 'Outstanding'],
    ['A', 80, 90, true, 'Excellent'],
    ['B+', 70, 80, true, 'Very good'],
    ['B', 60, 70, true, 'Good'],
    ['C', 50, 60, true, 'Satisfactory'],
    ['D', 40, 50, true, 'Needs improvement'],
    ['E', 0, 40, false, 'Unsatisfactory'],
  ];

  for (const [index, [label, min, max, isPass, description]] of bands.entries()) {
    await prisma.gradingBand.create({
      data: {
        schoolId,
        versionId: percentageVersion.id,
        label,
        description,
        minPercent: min.toFixed(3),
        maxPercent: max.toFixed(3),
        isPass,
        sequence: index + 1,
      },
    });
  }

  // A second scale nobody is using yet, to keep us honest: the engine must
  // resolve which scale applies rather than assuming there is only one.
  const gpaScale = await prisma.gradingScale.create({
    data: { schoolId, name: 'GPA 4.0', type: 'GPA', aggregation: 'WEIGHTED_MEAN', roundingDecimals: 2 },
  });
  const gpaVersion = await prisma.gradingScaleVersion.create({
    data: { schoolId, gradingScaleId: gpaScale.id, version: 1, publishedAt: new Date() },
  });
  const gpaBands: Array<[string, number, number, number]> = [
    ['A', 90, 100.001, 4],
    ['B', 80, 90, 3],
    ['C', 70, 80, 2],
    ['D', 60, 70, 1],
    ['F', 0, 60, 0],
  ];
  for (const [index, [label, min, max, points]] of gpaBands.entries()) {
    await prisma.gradingBand.create({
      data: {
        schoolId,
        versionId: gpaVersion.id,
        label,
        minPercent: min.toFixed(3),
        maxPercent: max.toFixed(3),
        points: points.toFixed(3),
        isPass: points > 0,
        sequence: index + 1,
      },
    });
  }

  await prisma.gradingScaleAssignment.create({
    data: {
      schoolId,
      academicYearId: thisYear.id,
      gradingScaleId: percentageScale.id,
      versionId: percentageVersion.id,
    },
  });

  // ── Holidays and a closure ───────────────────────────────────────────────
  const holidays: Array<[string, Date, Date]> = [
    ['Labour Day', date(2026, 5, 1), date(2026, 5, 1)],
    ['Summer break', date(2026, 6, 8), date(2026, 6, 19)],
    ['Republic Day', date(2026, 5, 29), date(2026, 5, 29)],
  ];
  for (const [name, startDate, endDate] of holidays) {
    await prisma.holiday.create({
      data: { schoolId, academicYearId: thisYear.id, name, startDate, endDate, scope: 'SCHOOL' },
    });
  }

  // An unplanned closure. Like a holiday, it must leave the attendance
  // denominator entirely — nobody is marked absent for a strike.
  await prisma.closure.create({
    data: {
      schoolId,
      academicYearId: thisYear.id,
      reason: 'City-wide transport strike',
      startDate: date(2026, 7, 14),
      endDate: date(2026, 7, 14),
      scope: 'SCHOOL',
      declaredByUserId: adminUserId,
      notifiedAt: new Date(Date.UTC(2026, 6, 13, 12, 0)),
    },
  });

  const excludedDates = new Set<string>();
  const markExcluded = (from: Date, to: Date): void => {
    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      excludedDates.add(cursor.toISOString().slice(0, 10));
    }
  };
  for (const [, startDate, endDate] of holidays) markExcluded(startDate, endDate);
  markExcluded(date(2026, 7, 14), date(2026, 7, 14));

  // ── Attendance: term 1 up to "today" in the demo ─────────────────────────
  //
  // Sessions exist only for days the school actually ran. A holiday has no
  // session at all, so it never lands in a denominator — which is the whole
  // reason the session table exists.

  // Registers run to *yesterday*; today is handled separately below, because a
  // real morning has some registers in and some still owed. Clamped into
  // term 1 so that seeding during the winter holidays still produces a term
  // with attendance in it rather than nothing at all.
  /** An instant `daysAgo` before the demo's today, at a wall-clock hour. */
  const agoAt = (daysAgo: number, hour: number, minute = 0): Date =>
    new Date(addDays(DEMO_TODAY, -daysAgo).getTime() + (hour * 60 + minute) * 60_000);

  const clamp = (value: Date, min: Date, max: Date): Date =>
    value < min ? min : value > max ? max : value;

  const attendanceUntil = clamp(addDays(DEMO_TODAY, -1), term1.startDate, term1.endDate);
  const schoolDays: Date[] = [];
  for (let cursor = term1.startDate; cursor <= attendanceUntil; cursor = addDays(cursor, 1)) {
    const weekday = cursor.getUTCDay(); // 0 = Sunday
    if (weekday === 0 || weekday === 6) continue;
    if (excludedDates.has(cursor.toISOString().slice(0, 10))) continue;
    schoolDays.push(cursor);
  }

  const enrolmentsBySection = new Map<string, StudentRow[]>();
  for (const row of studentRows) {
    const list = enrolmentsBySection.get(row.sectionId) ?? [];
    list.push(row);
    enrolmentsBySection.set(row.sectionId, list);
  }

  const enrolmentStartDates = new Map<string, Date>(
    (
      await prisma.enrolment.findMany({
        where: { academicYearId: thisYear.id },
        select: { id: true, enrolledOn: true },
      })
    ).map((enrolment) => [enrolment.id, enrolment.enrolledOn]),
  );

  // A couple of students are chronic absentees so the "below 75%" case has
  // someone in it on the demo screen.
  const strugglers = new Set(
    studentRows.filter(() => chance(0.04)).map((row) => row.enrolmentId),
  );

  let sessionCount = 0;
  let recordCount = 0;

  for (const section of thisYearSections) {
    const roster = enrolmentsBySection.get(section.id) ?? [];
    const classTeacherUserId = teachers[thisYearSections.indexOf(section) % teachers.length]!.userId;

    for (const day of schoolDays) {
      const session = await prisma.attendanceSession.create({
        data: {
          schoolId,
          academicYearId: thisYear.id,
          sectionId: section.id,
          date: day,
          sessionKey: 'DAY',
          takenByUserId: classTeacherUserId,
          submittedAt: new Date(day.getTime() + 9 * 60 * 60 * 1000),
          lockedAt: day < addDays(attendanceUntil, -7) ? new Date(day.getTime() + 86_400_000) : null,
        },
      });
      sessionCount += 1;

      const records = roster
        // Someone who had not joined yet has no record, so the days before
        // they arrived never count against them.
        .filter((row) => (enrolmentStartDates.get(row.enrolmentId) ?? day) <= day)
        .map((row) => {
          const absenteeism = strugglers.has(row.enrolmentId) ? 0.22 : 0.04;
          let status: AttendanceStatus = 'PRESENT';
          let minutesLate: number | null = null;

          if (chance(absenteeism)) {
            status = chance(0.45) ? 'ABSENT_APPROVED' : 'ABSENT_UNEXPLAINED';
          } else if (chance(0.05)) {
            status = 'LATE';
            minutesLate = between(5, 35);
          }

          return {
            schoolId,
            sessionId: session.id,
            enrolmentId: row.enrolmentId,
            date: day,
            status,
            minutesLate,
            recordedByUserId: classTeacherUserId,
          };
        });

      await prisma.attendanceRecord.createMany({ data: records });
      recordCount += records.length;
    }
  }

  /**
   * Today, half done.
   *
   * A demo where every register is already in shows nothing interesting: the
   * number an administrator actually opens this product for in the morning is
   * how many teachers still owe one. So the first half of the sections have
   * submitted and the rest have not — which also exercises the "register due"
   * path on a teacher's overview and the marigold dot in the section picker.
   */
  const todayIsSchoolDay =
    DEMO_TODAY >= term1.startDate &&
    DEMO_TODAY <= term1.endDate &&
    DEMO_TODAY.getUTCDay() !== 0 &&
    DEMO_TODAY.getUTCDay() !== 6 &&
    !excludedDates.has(DEMO_TODAY.toISOString().slice(0, 10));

  if (todayIsSchoolDay) {
    const takenToday = thisYearSections.slice(0, Math.ceil(thisYearSections.length / 2));

    for (const section of takenToday) {
      const roster = enrolmentsBySection.get(section.id) ?? [];
      const classTeacherUserId =
        teachers[thisYearSections.indexOf(section) % teachers.length]!.userId;

      const session = await prisma.attendanceSession.create({
        data: {
          schoolId,
          academicYearId: thisYear.id,
          sectionId: section.id,
          date: DEMO_TODAY,
          sessionKey: 'DAY',
          takenByUserId: classTeacherUserId,
          submittedAt: new Date(DEMO_TODAY.getTime() + 9 * 60 * 60 * 1000),
          lockedAt: null,
        },
      });
      sessionCount += 1;

      const records = roster
        .filter((row) => (enrolmentStartDates.get(row.enrolmentId) ?? DEMO_TODAY) <= DEMO_TODAY)
        .map((row) => {
          const absenteeism = strugglers.has(row.enrolmentId) ? 0.22 : 0.04;
          let status: AttendanceStatus = 'PRESENT';
          let minutesLate: number | null = null;

          if (chance(absenteeism)) {
            status = chance(0.45) ? 'ABSENT_APPROVED' : 'ABSENT_UNEXPLAINED';
          } else if (chance(0.05)) {
            status = 'LATE';
            minutesLate = between(5, 35);
          }

          return {
            schoolId,
            sessionId: session.id,
            enrolmentId: row.enrolmentId,
            date: DEMO_TODAY,
            status,
            minutesLate,
            recordedByUserId: classTeacherUserId,
          };
        });

      await prisma.attendanceRecord.createMany({ data: records });
      recordCount += records.length;
    }
  }

  /**
   * The staff return, over the same days as the class registers.
   *
   * Teachers are in far more reliably than children are, so the rates here are
   * low on purpose — but not zero, because a screen where every row is green
   * shows nothing about how the four states read next to each other.
   */
  let staffDayCount = 0;
  let staffRecordCount = 0;

  const allStaff = await prisma.staffProfile.findMany({
    where: { schoolId, status: 'ACTIVE' },
    select: { id: true },
  });

  for (const day of schoolDays) {
    const staffDay = await prisma.staffAttendanceDay.create({
      data: {
        schoolId,
        academicYearId: thisYear.id,
        date: day,
        takenByUserId: adminUserId,
        submittedAt: new Date(day.getTime() + 8 * 60 * 60 * 1000),
        lockedAt: day < addDays(attendanceUntil, -14) ? new Date(day.getTime() + 86_400_000) : null,
      },
    });
    staffDayCount += 1;

    const records = allStaff.map((member) => {
      let status: AttendanceStatus = 'PRESENT';
      let minutesLate: number | null = null;

      if (chance(0.03)) {
        status = chance(0.7) ? 'ABSENT_APPROVED' : 'ABSENT_UNEXPLAINED';
      } else if (chance(0.04)) {
        status = 'LATE';
        minutesLate = between(5, 25);
      }

      return {
        schoolId,
        dayId: staffDay.id,
        staffId: member.id,
        date: day,
        status,
        minutesLate,
        recordedByUserId: adminUserId,
      };
    });

    await prisma.staffAttendanceRecord.createMany({ data: records });
    staffRecordCount += records.length;
  }

  // Today is left untaken on purpose, so the office has a return to file and
  // the screen has something to do on the day of a demo.

  // ── Fees ─────────────────────────────────────────────────────────────────
  //
  // Every amount is minor units. ₹48,000 is 4_800_000n paise. No floats reach
  // this file, and none should ever reach the ledger.

  const feeByLevel: Record<number, bigint> = {
    6: 4_200_000n,
    7: 4_500_000n,
    8: 4_800_000n,
  };

  const invoices: Array<{ id: string; enrolmentId: string; totalMinor: bigint }> = [];
  let invoiceNumber = 1;

  for (const gradeLevel of gradeLevels) {
    const tuition = feeByLevel[gradeLevel.level]!;

    const structure = await prisma.feeStructure.create({
      data: {
        schoolId,
        academicYearId: thisYear.id,
        gradeLevelId: gradeLevel.id,
        name: `${gradeLevel.name} — 2026–27`,
      },
    });

    const tuitionItem = await prisma.feeItem.create({
      data: {
        schoolId,
        feeStructureId: structure.id,
        termId: term1.id,
        name: 'Tuition',
        category: 'TUITION',
        amountMinor: tuition,
        frequency: 'TERM',
      },
    });

    const transportItem = await prisma.feeItem.create({
      data: {
        schoolId,
        feeStructureId: structure.id,
        termId: term1.id,
        name: 'Transport',
        category: 'TRANSPORT',
        amountMinor: 600_000n,
        frequency: 'TERM',
        isOptional: true,
      },
    });

    await prisma.feeItem.create({
      data: {
        schoolId,
        feeStructureId: structure.id,
        name: 'Admission',
        category: 'ONE_TIME',
        amountMinor: 1_500_000n,
        frequency: 'ONE_TIME',
      },
    });

    // Term 1 invoices for every student in the grade.
    const roster = studentRows.filter((row) => row.level === gradeLevel.level);
    for (const row of roster) {
      const takesTransport = chance(0.45);
      const subtotal = tuition + (takesTransport ? 600_000n : 0n);

      // One family in twenty has a concession — a sibling discount or a
      // scholarship. Percentages are basis points so the arithmetic stays
      // integral.
      const hasConcession = chance(0.05);
      const concessionBps = hasConcession ? 2500 : 0;
      const concession = (subtotal * BigInt(concessionBps)) / 10_000n;
      const total = subtotal - concession;

      if (hasConcession) {
        await prisma.feeConcession.create({
          data: {
            schoolId,
            studentId: row.id,
            enrolmentId: row.enrolmentId,
            feeItemId: tuitionItem.id,
            name: 'Sibling discount',
            type: 'PERCENTAGE',
            valueBps: concessionBps,
            validFrom: thisYear.startDate,
          },
        });
      }

      const invoice = await prisma.invoice.create({
        data: {
          schoolId,
          academicYearId: thisYear.id,
          enrolmentId: row.enrolmentId,
          termId: term1.id,
          number: `INV-2627-${pad(invoiceNumber, 4)}`,
          issueDate: date(2026, 4, 10),
          dueDate: date(2026, 5, 10),
          currency: 'INR',
          subtotalMinor: subtotal,
          concessionMinor: concession,
          totalMinor: total,
          status: 'ISSUED',
          lines: {
            create: [
              {
                schoolId,
                feeItemId: tuitionItem.id,
                description: 'Tuition — Term 1',
                quantity: 1,
                unitAmountMinor: tuition,
                concessionMinor: concession,
                lineTotalMinor: tuition - concession,
                sequence: 1,
              },
              ...(takesTransport
                ? [
                    {
                      schoolId,
                      feeItemId: transportItem.id,
                      description: 'Transport — Term 1',
                      quantity: 1,
                      unitAmountMinor: 600_000n,
                      concessionMinor: 0n,
                      lineTotalMinor: 600_000n,
                      sequence: 2,
                    },
                  ]
                : []),
            ],
          },
        },
      });

      invoiceNumber += 1;
      invoices.push({ id: invoice.id, enrolmentId: row.enrolmentId, totalMinor: total });
    }
  }

  // Payments. Roughly the mix a school actually has in August: most paid, some
  // part paid, a tail that has not paid at all and is now well overdue.
  let receiptNumber = 1;
  for (const invoice of invoices) {
    const roll = random();
    if (roll < 0.72) {
      await recordPayment(invoice, invoice.totalMinor, date(2026, between(4, 5), between(10, 28)));
    } else if (roll < 0.86) {
      const half = invoice.totalMinor / 2n;
      await recordPayment(invoice, half, date(2026, 5, between(1, 28)));
    }
    // The rest are unpaid, and the oldest are 90+ days past due.
  }

  async function recordPayment(
    invoice: { id: string; enrolmentId: string },
    amountMinor: bigint,
    receivedOn: Date,
  ): Promise<void> {
    const method = pick(['CASH', 'CHEQUE', 'BANK_TRANSFER'] as const);
    const payment = await prisma.payment.create({
      data: {
        schoolId,
        receiptNumber: `RCP-2627-${pad(receiptNumber, 4)}`,
        enrolmentId: invoice.enrolmentId,
        amountMinor,
        currency: 'INR',
        method,
        reference: method === 'CASH' ? null : `${method === 'CHEQUE' ? 'CHQ' : 'UTR'}-${between(100000, 999999)}`,
        receivedOn,
        clearedOn: method === 'CHEQUE' ? addDays(receivedOn, 3) : receivedOn,
        recordedByUserId: accountsUserId,
        allocations: { create: [{ schoolId, invoiceId: invoice.id, amountMinor }] },
      },
    });
    receiptNumber += 1;

    const paid = await prisma.paymentAllocation.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { amountMinor: true },
    });
    const paidTotal = paid._sum.amountMinor ?? 0n;
    const invoiceRow = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paidMinor: paidTotal,
        status: paidTotal >= invoiceRow.totalMinor ? 'PAID' : 'PARTIALLY_PAID',
      },
    });
    void payment;
  }

  // ── An exam with raw marks ───────────────────────────────────────────────
  //
  // Marks only. No letter, no average, no rank is stored — those are computed
  // through the grading scale at read time, which is the thing we must never
  // let slip.

  const unitTest = await prisma.exam.create({
    data: {
      schoolId,
      academicYearId: thisYear.id,
      termId: term1.id,
      name: 'Unit Test 1',
      category: 'UNIT_TEST',
      weightBps: 2000,
      startDate: date(2026, 7, 6),
      endDate: date(2026, 7, 10),
      resultsPublishedAt: new Date(Date.UTC(2026, 6, 20)),
    },
  });

  let markCount = 0;
  for (const gradeLevel of gradeLevels) {
    for (const subject of examinable) {
      const examSubject = await prisma.examSubject.create({
        data: {
          schoolId,
          examId: unitTest.id,
          subjectId: subject.id,
          gradeLevelId: gradeLevel.id,
          maxMarks: '50.00',
          passMarks: '20.00',
          examDate: date(2026, 7, between(6, 10)),
        },
      });

      const roster = studentRows.filter((row) => row.level === gradeLevel.level);
      const marks = roster.map((row) => {
        const absent = chance(0.02);
        return {
          schoolId,
          examSubjectId: examSubject.id,
          enrolmentId: row.enrolmentId,
          rawMarks: absent ? null : (between(28, 100) / 2).toFixed(2),
          isAbsent: absent,
          enteredByUserId: teachers[0]!.userId,
        };
      });
      await prisma.mark.createMany({ data: marks });
      markCount += marks.length;
    }
  }

  // ── Homework and notices ─────────────────────────────────────────────────
  const homeworkSamples: Array<[string, string, number]> = [
    ['MATH', 'Exercise 6.2, questions 1–14', 1],
    ['ENG', 'Read chapter 4 and write a 200-word response', 2],
    ['SCI', 'Lab write-up — separating mixtures', 4],
    ['HUM', 'Map work: trade routes, page 51', 3],
  ];

  for (const section of thisYearSections.slice(0, 4)) {
    for (const [code, body, dueInDays] of homeworkSamples) {
      const subject = subjects.find((candidate) => candidate.code === code)!;
      const assignment = await prisma.teachingAssignment.findFirstOrThrow({
        where: { sectionId: section.id, subjectId: subject.id },
        select: { staffId: true },
      });
      await prisma.homeworkPost.create({
        data: {
          schoolId,
          academicYearId: thisYear.id,
          sectionId: section.id,
          subjectId: subject.id,
          postedByStaffId: assignment.staffId,
          body,
          dueDate: addDays(attendanceUntil, dueInDays),
          publishedAt: agoAt(1, 10, 0),
          notifyGuardians: true,
          notificationSentAt: agoAt(1, 10, 1),
        },
      });
    }
  }

  await prisma.notice.create({
    data: {
      schoolId,
      academicYearId: thisYear.id,
      title: 'Parent–teacher meeting, Saturday 22 August',
      body: 'Slots are 15 minutes and run from 9:00 am. Book through the office.',
      scope: 'SCHOOL',
      publishedAt: agoAt(7, 9, 0),
      isPinned: true,
      authorUserId: adminUserId,
    },
  });

  await prisma.notice.create({
    data: {
      schoolId,
      academicYearId: thisYear.id,
      title: 'Grade 8 science field trip — consent forms due Friday',
      body: 'Please return the signed form with the ₹450 contribution.',
      scope: 'GRADE_LEVEL',
      gradeLevelId: gradeLevels[2]!.id,
      publishedAt: agoAt(6, 14, 30),
      authorUserId: adminUserId,
    },
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  // Scoped to this school. The seed runs as the owner role, which is exempt
  // from row-level security, so an unqualified count here quietly totals every
  // tenant in the database — and prints a negative number the moment a second
  // school exists.
  const unpaid =
    invoices.length -
    (await prisma.invoice.count({
      where: { schoolId, academicYearId: thisYear.id, status: 'PAID' },
    }));

  console.log(`
  Model School seeded.

    Academic years   2025–26 (closed), 2026–27 (current)
    Grade levels     6, 7, 8 · ${thisYearSections.length} sections
    Students         ${studentRows.length}
    Staff            ${teachers.length} teachers + admin, accounts, driver
    Attendance       ${sessionCount} sessions, ${recordCount} records over ${schoolDays.length} school days
    Staff attendance ${staffDayCount} returns, ${staffRecordCount} records
    Marks            ${markCount} raw marks (Unit Test 1)
    Invoices         ${invoices.length} for Term 1 · ${unpaid} not fully paid
    Grading scales   Percentage (A+ to E), GPA 4.0

  Sign in at https://${SCHOOL_SLUG}.hamro.school

    admin              school admin
    accounts           accounts
    radhika.karthik    teacher
    parent001          parent
    student            student
    driver             driver

    From app.hamro.school add the suffix, e.g. admin@${SCHOOL_SLUG}.
    password: ${DEMO_PASSWORD}
`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
