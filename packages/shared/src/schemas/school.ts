import { z } from 'zod';
import { idSchema, localDateSchema } from './common.js';

/**
 * The academic year, and the shape of the year the whole app hangs off.
 *
 * Rule 2: the year is an entity, not a column. Every screen in the product is
 * "this, in this year" — which is why the shell fetches this once and every
 * other request is read in its light.
 */

export const academicYearStatusSchema = z.enum(['PLANNING', 'ACTIVE', 'CLOSED']);

export const academicYearSchema = z.object({
  id: idSchema,
  /** School-facing label — "2026–27". Free text; schools disagree about this. */
  name: z.string(),
  startDate: localDateSchema,
  endDate: localDateSchema,
  status: academicYearStatusSchema,
  isCurrent: z.boolean(),
});

export type AcademicYearView = z.infer<typeof academicYearSchema>;

export const termSchema = z.object({
  id: idSchema,
  name: z.string(),
  sequence: z.number().int(),
  startDate: localDateSchema,
  endDate: localDateSchema,
});

export type TermView = z.infer<typeof termSchema>;

/**
 * What the shell needs to draw a topbar, on every page.
 *
 * `today` comes from the server rather than the browser on purpose. The date a
 * school works in is the date at the *school*, and a parent checking homework
 * from another country must not see a different day from the teacher who set
 * it. The browser clock also happens to be wrong quite often.
 */
export const schoolContextSchema = z.object({
  today: localDateSchema,
  academicYear: academicYearSchema.nullable(),
  /** The term `today` falls in. Null between terms and during the holidays. */
  currentTerm: termSchema.nullable(),
  terms: z.array(termSchema),
  /**
   * False on a holiday or a closure, with the school's own wording for why.
   * Rule 6: a closed day has no attendance at all, so screens say that rather
   * than showing an empty register that looks like a missing one.
   */
  isSchoolDay: z.boolean(),
  nonSchoolDayReason: z.string().nullable(),
});

export type SchoolContext = z.infer<typeof schoolContextSchema>;
