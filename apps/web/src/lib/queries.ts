import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SaveRegisterRequest,
  ExamRow,
  HomeworkSummary,
  InvoiceRow,
  LocalDate,
  MarkRow,
  NoticeSummary,
  Overview,
  PaymentRow,
  Register,
  SchoolContext,
  SectionAttendance,
  StaffRow,
  StudentRow,
} from '@hamro/shared';
import { api } from './api.js';

/**
 * The reads the shell and its pages make.
 *
 * Staleness is set per query by how fast the thing behind it actually changes.
 * An academic year does not move while somebody is looking at a register; a
 * register does, and a teacher who has just saved one should not be told
 * otherwise by a cache.
 *
 * Nothing here decides what a user may see. Every one of these paths is checked
 * again on the server, per request — a page that asks for something the reader
 * does not hold gets a 403 and shows it, which is the honest outcome.
 */

function query(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
}

/**
 * The year, the term and what day it is at the school. Effectively static.
 *
 * `enabled` exists for the one role that cannot read it: a driver holds
 * `school:read` but no `academic_year:read`, and firing a request that is
 * certain to 403 on every page load is noise in the log and a red line in their
 * console for a thing they never asked for.
 */
export function useSchoolContext(enabled = true) {
  return useQuery({
    queryKey: ['school-context'],
    queryFn: () => api.get<SchoolContext>('/school/context'),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
}

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<Overview>('/overview'),
    staleTime: 60 * 1000,
  });
}

export function useAttendanceSections() {
  return useQuery({
    queryKey: ['attendance', 'sections'],
    queryFn: () => api.get<SectionAttendance[]>('/attendance/sections'),
    staleTime: 60 * 1000,
  });
}

export function useRegister(sectionId: string | null, date: LocalDate | null) {
  return useQuery({
    queryKey: ['attendance', 'register', sectionId, date],
    queryFn: () =>
      api.get<Register>(query('/attendance/register', { sectionId: sectionId!, date: date ?? undefined })),
    enabled: Boolean(sectionId),
    // A register is the one thing on these screens that changes minute to
    // minute while a teacher is working.
    staleTime: 15 * 1000,
  });
}

export function useHomework(sectionId?: string) {
  return useQuery({
    queryKey: ['homework', sectionId ?? null],
    queryFn: () => api.get<HomeworkSummary[]>(query('/homework', { sectionId })),
    staleTime: 60 * 1000,
  });
}

export function useNotices(limit = 30) {
  return useQuery({
    queryKey: ['notices', limit],
    queryFn: () => api.get<NoticeSummary[]>(query('/notices', { limit })),
    staleTime: 60 * 1000,
  });
}

export function useStudents(options: { sectionId?: string; search?: string } = {}) {
  return useQuery({
    queryKey: ['students', options.sectionId ?? null, options.search ?? ''],
    queryFn: () =>
      api.get<StudentRow[]>(
        query('/students', { sectionId: options.sectionId, search: options.search, limit: 200 }),
      ),
    staleTime: 60 * 1000,
  });
}

export function useStaff() {
  return useQuery({
    queryKey: ['staff'],
    queryFn: () => api.get<StaffRow[]>('/staff'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useExams() {
  return useQuery({
    queryKey: ['exams'],
    queryFn: () => api.get<ExamRow[]>('/exams'),
    staleTime: 5 * 60 * 1000,
  });
}

export interface ExamSubjectRow {
  id: string;
  subjectName: string;
  subjectCode: string;
  gradeLevelName: string;
  maxMarks: string;
  passMarks: string | null;
  examDate: LocalDate | null;
  marksEntered: number;
  marksExpected: number;
}

export function useExamSubjects(examId: string | null) {
  return useQuery({
    queryKey: ['exam-subjects', examId],
    queryFn: () => api.get<ExamSubjectRow[]>(`/exams/${examId}/subjects`),
    enabled: Boolean(examId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarks(examSubjectId: string | null) {
  return useQuery({
    queryKey: ['marks', examSubjectId],
    queryFn: () => api.get<MarkRow[]>(query('/marks', { examSubjectId: examSubjectId! })),
    enabled: Boolean(examSubjectId),
    staleTime: 60 * 1000,
  });
}

export interface FeeSummaryView {
  invoiced: { amountMinor: string; currency: string; minorUnits: number };
  collected: { amountMinor: string; currency: string; minorUnits: number };
  outstanding: { amountMinor: string; currency: string; minorUnits: number };
  overdue: { amountMinor: string; currency: string; minorUnits: number };
  overdueCount: number;
  invoiceCount: number;
}

export function useFeeSummary() {
  return useQuery({
    queryKey: ['fees', 'summary'],
    queryFn: () => api.get<FeeSummaryView>('/fees/summary'),
    staleTime: 60 * 1000,
  });
}

export function useInvoices(options: { overdueOnly?: boolean; search?: string } = {}) {
  return useQuery({
    queryKey: ['invoices', options.overdueOnly ?? false, options.search ?? ''],
    queryFn: () =>
      api.get<InvoiceRow[]>(
        query('/invoices', {
          overdueOnly: options.overdueOnly ? 'true' : undefined,
          search: options.search,
          limit: 200,
        }),
      ),
    staleTime: 60 * 1000,
  });
}

export function usePayments() {
  return useQuery({
    queryKey: ['payments'],
    queryFn: () => api.get<PaymentRow[]>(query('/payments', { limit: 200 })),
    staleTime: 60 * 1000,
  });
}

export interface TimetableCell {
  id: string;
  dayOfWeek: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
  periodName: string;
  periodSequence: number;
  startTime: string;
  endTime: string;
  subjectName: string;
  sectionName: string;
  teacherName: string | null;
  room: string | null;
}

export function useTimetable(sectionId?: string) {
  return useQuery({
    queryKey: ['timetable', sectionId ?? null],
    queryFn: () => api.get<TimetableCell[]>(query('/timetable', { sectionId })),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Saving a register.
 *
 * On success every view of attendance is invalidated, not just this register:
 * the section picker shows which classes still owe one, and the overview counts
 * them. A teacher who saves and then glances at the rail should not be told
 * they still owe the register they just filed.
 */
export function useSaveRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SaveRegisterRequest) =>
      api.put<{ sessionId: string; submittedAt: string; saved: number; absentees: number }>(
        '/attendance/register',
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}
