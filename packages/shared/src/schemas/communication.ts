import { z } from 'zod';
import { idSchema, localDateSchema } from './common.js';

/**
 * Notices and homework — the two things parents actually open the app for.
 *
 * `title` and `body` here are school-authored: a teacher's words, stored and
 * shown verbatim. They are data, not copy, and they never go near the message
 * catalogue (rule 9). Everything *around* them — "Due", "Whole school",
 * "Pinned" — is a key.
 */

export const audienceScopeSchema = z.enum(['SCHOOL', 'GRADE_LEVEL', 'SECTION']);

export const noticeSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  body: z.string(),
  scope: audienceScopeSchema,
  /** The grade or section named by the scope, ready to show. Null for a whole-school notice. */
  audienceName: z.string().nullable(),
  isPinned: z.boolean(),
  /** An instant — a publication time, read in the school's timezone. */
  publishedAt: z.string().nullable(),
  authorName: z.string(),
});

export type NoticeSummary = z.infer<typeof noticeSummarySchema>;

export const homeworkSummarySchema = z.object({
  id: idSchema,
  title: z.string().nullable(),
  body: z.string(),
  /** A local calendar date. Homework is due on a school day, not at an instant. */
  dueDate: localDateSchema,
  subjectName: z.string(),
  sectionName: z.string(),
  gradeLevelName: z.string(),
  postedByName: z.string(),
  publishedAt: z.string().nullable(),
  /** For a guardian reading several children's homework at once. */
  studentNames: z.array(z.string()).optional(),
});

export type HomeworkSummary = z.infer<typeof homeworkSummarySchema>;

export const homeworkQuerySchema = z.object({
  sectionId: idSchema.optional(),
  /** Inclusive window on the due date. Defaults to the current week at the school. */
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
});

export const noticeQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
