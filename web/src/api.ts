import type {
  CourseGradeClassesData,
  CourseGradesData,
  LoginStart,
  LoginState,
  ModuleKey,
  ProgressClassesData,
  ProgressCopyData,
  ProgressCopyOptionsData,
  ProgressEntryData,
  ProgressSaveResult,
  ProgressSummaryData,
  RosterClassListData,
  RosterData,
  ScheduleData,
  SessionData,
  TermsData,
} from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...((init.headers as Record<string, string> | undefined) ?? {}) },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const serverMessage = (payload as { error?: unknown } | null)?.error;
    const message = typeof serverMessage === 'string' && serverMessage ? serverMessage : `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  session: () => request<SessionData>('/api/session'),
  loginStart: () => request<LoginStart>('/api/login/start', { method: 'POST' }),
  loginStatus: () => request<LoginState>('/api/login/status'),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  terms: () => request<TermsData>('/api/terms'),
  schedule: (term: string) => request<ScheduleData>(`/api/schedule?term=${encodeURIComponent(term)}`),
  feature: (feature: ModuleKey, term: string) => request<unknown>(`/api/${feature}?term=${encodeURIComponent(term)}`),
  progressSummary: (term: string) => request<ProgressSummaryData>(`/api/progress/summary?term=${encodeURIComponent(term)}`),
  progressExportUrl: (term: string, className: string, kcdm = '', skbjdm = '') =>
    `/api/progress/export?term=${encodeURIComponent(term)}&class=${encodeURIComponent(className)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`,
  progressPdfUrl: (term: string, params: Record<string, string>) =>
    `/api/progress/export/pdf?term=${encodeURIComponent(term)}&${new URLSearchParams(params).toString()}`,
  rosterClasses: (term: string) => request<RosterClassListData>(`/api/roster/classes?term=${encodeURIComponent(term)}`),
  roster: (term: string, kcdm: string, skbjdm: string) =>
    request<RosterData>(
      `/api/roster?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`,
    ),
  rosterExportUrl: (term: string, kcdm: string, skbjdm: string) =>
    `/api/roster/export?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`,
  rosterReportUrl: (term: string, kcdm: string, skbjdm: string) =>
    `/api/roster/report?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`,
  rosterPrintUrl: (term: string, kcdm: string, skbjdm: string) =>
    `/api/roster/report?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}&format=print`,
  progressClasses: (term: string) => request<ProgressClassesData>(`/api/progress/classes?term=${encodeURIComponent(term)}`),
  progressEntry: (term: string, params: Record<string, string>) =>
    request<ProgressEntryData>(`/api/progress/entry?term=${encodeURIComponent(term)}&${new URLSearchParams(params).toString()}`),
  progressSave: (body: unknown) =>
    request<ProgressSaveResult>('/api/progress/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  progressCopyTerms: (term: string, kcdm: string, skbjdm: string) =>
    request<ProgressCopyOptionsData>(
      `/api/progress/copy-terms?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`,
    ),
  progressCopyClasses: (term: string, kcdm: string, skbjdm: string, xnxq: string) =>
    request<ProgressCopyOptionsData>(
      `/api/progress/copy-classes?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}&xnxq=${encodeURIComponent(xnxq)}`,
    ),
  progressCopy: (kcdm: string, xnxq: string, source: string) =>
    request<ProgressCopyData>(
      `/api/progress/copy?kcdm=${encodeURIComponent(kcdm)}&xnxq=${encodeURIComponent(xnxq)}&source=${encodeURIComponent(source)}`,
    ),
  courseGradeClasses: (term: string) =>
    request<CourseGradeClassesData>(`/api/course-grades/classes?term=${encodeURIComponent(term)}`),
  courseGrades: (term: string, params: Record<string, string>) =>
    request<CourseGradesData>(
      `/api/course-grades?term=${encodeURIComponent(term)}&${new URLSearchParams(params).toString()}`,
    ),
  courseGradesPdfUrl: (term: string, params: Record<string, string>) =>
    `/api/course-grades/export/pdf?term=${encodeURIComponent(term)}&${new URLSearchParams(params).toString()}`,
  courseGradesExcelUrl: (term: string, params: Record<string, string>) =>
    `/api/course-grades/export/excel?term=${encodeURIComponent(term)}&${new URLSearchParams(params).toString()}`,
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || '发生未知错误';
  return '发生未知错误';
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isUnimplemented(error: unknown): boolean {
  return error instanceof ApiError && error.status === 501;
}
