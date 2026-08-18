import { z } from 'zod';
import { idSchema, localDateSchema } from './common.js';

/**
 * School setup: the shape of a year.
 *
 * Grade levels, sections, subjects and the calendar — the things a school fills
 * in before anything else works, and the things every other screen hangs off.
 *
 * Names here are school-authored data, shown verbatim and never translated. A
 * school that calls it "Class VI" or "Year 7" or "UKG" is right, and the
 * product's job is to store what they typed.
 */

const name = z.string().trim().min(1).max(80);

// ── Grade levels ────────────────────────────────────────────────────────────

export const gradeLevelRowSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** Sort order and promotion order. Nursery may be 0 or -1; schools differ. */
  level: z.number().int(),
  stage: z.string().nullable(),
  sections: z.number().int(),
  students: z.number().int(),
});

export type GradeLevelRow = z.infer<typeof gradeLevelRowSchema>;

export const createGradeLevelSchema = z.object({
  name,
  level: z.number().int().min(-5).max(20),
  stage: z.string().trim().max(40).optional(),
});

export const updateGradeLevelSchema = createGradeLevelSchema.partial();

// ── Sections ────────────────────────────────────────────────────────────────

export const sectionRowSchema = z.object({
  id: idSchema,
  name: z.string(),
  gradeLevelId: idSchema,
  gradeLevelName: z.string(),
  level: z.number().int(),
  capacity: z.number().int().nullable(),
  room: z.string().nullable(),
  classTeacherId: idSchema.nullable(),
  classTeacherName: z.string().nullable(),
  students: z.number().int(),
});

export type SectionRow = z.infer<typeof sectionRowSchema>;

export const createSectionSchema = z.object({
  gradeLevelId: idSchema,
  name,
  capacity: z.number().int().min(1).max(200).nullish(),
  room: z.string().trim().max(40).nullish(),
  classTeacherId: idSchema.nullish(),
});

export const updateSectionSchema = createSectionSchema.partial().omit({ gradeLevelId: true });

// ── Subjects ────────────────────────────────────────────────────────────────

export const subjectRowSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  isExaminable: z.boolean(),
  /** Grades this subject is offered to, named for display. */
  offeredTo: z.array(z.string()),
});

export type SubjectRow = z.infer<typeof subjectRowSchema>;

export const createSubjectSchema = z.object({
  code: z.string().trim().min(1).max(16).toUpperCase(),
  name,
  isExaminable: z.boolean().default(true),
});

export const updateSubjectSchema = createSubjectSchema.partial();

// ── The calendar ────────────────────────────────────────────────────────────

export const holidayRowSchema = z.object({
  id: idSchema,
  name: z.string(),
  startDate: localDateSchema,
  /** Inclusive, and equal to startDate for a single day. */
  endDate: localDateSchema,
  days: z.number().int(),
});

export type HolidayRow = z.infer<typeof holidayRowSchema>;

export const createHolidaySchema = z
  .object({
    name,
    startDate: localDateSchema,
    endDate: localDateSchema,
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'error.setup.end_before_start',
    path: ['endDate'],
  });

/** Everything the setup screen needs, in one read. */
export const setupOverviewSchema = z.object({
  gradeLevels: z.array(gradeLevelRowSchema),
  sections: z.array(sectionRowSchema),
  subjects: z.array(subjectRowSchema),
  holidays: z.array(holidayRowSchema),
  teachers: z.array(z.object({ id: idSchema, fullName: z.string() })),
});

export type SetupOverview = z.infer<typeof setupOverviewSchema>;
