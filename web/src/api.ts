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
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(120000),
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...((init.headers as Record<string, string> | undefined) ?? {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ApiError('请求超时或已取消，请检查网络后重试', 408);
    }
    throw new ApiError('无法连接后端服务，请确认服务已启动', 0);
  }

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

  if (payload === null) throw new ApiError('服务器返回了无效数据，请稍后重试', 502);
  return payload as T;
}

/**
 * 「刷新」按钮传 refresh=true：请求带 `?refresh=1`，让服务端跳过缓存直接回源。
 *
 * 服务端查询缓存按数据变化频率分层（学期列表 12 小时、课表/教学任务/成绩 30 分钟、
 * 点名册 10 分钟、教学进度 5 分钟，见 server/cacheTtl.mjs），不带这个参数时
 * 手动刷新可能拿到 TTL 内的旧数据。
 */
export type CacheOptions = { refresh?: boolean };

function withRefresh(path: string, options: CacheOptions = {}): string {
  if (!options.refresh) return path;
  return `${path}${path.includes('?') ? '&' : '?'}refresh=1`;
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  session: () => request<SessionData>('/api/session'),
  loginStart: () => request<LoginStart>('/api/login/start', { method: 'POST' }),
  loginStatus: () => request<LoginState>('/api/login/status'),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST', signal: AbortSignal.timeout(5000) }),
  terms: (options?: CacheOptions) => request<TermsData>(withRefresh('/api/terms', options)),
  schedule: (term: string, options?: CacheOptions) =>
    request<ScheduleData>(withRefresh(`/api/schedule?term=${encodeURIComponent(term)}`, options)),
  feature: (feature: ModuleKey, term: string, options?: CacheOptions) =>
    request<unknown>(withRefresh(`/api/${feature}?term=${encodeURIComponent(term)}`, options)),
  progressSummary: (term: string, options?: CacheOptions) =>
    request<ProgressSummaryData>(withRefresh(`/api/progress/summary?term=${encodeURIComponent(term)}`, options)),
  progressExportUrl: (term: string, className: string, kcdm = '', skbjdm = '') =>
    `/api/progress/export?term=${encodeURIComponent(term)}&class=${encodeURIComponent(className)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`,
  progressPdfUrl: (term: string, params: Record<string, string>) =>
    `/api/progress/export/pdf?term=${encodeURIComponent(term)}&${new URLSearchParams(params).toString()}`,
  rosterClasses: (term: string, options?: CacheOptions) =>
    request<RosterClassListData>(withRefresh(`/api/roster/classes?term=${encodeURIComponent(term)}`, options)),
  roster: (term: string, kcdm: string, skbjdm: string, options?: CacheOptions) =>
    request<RosterData>(
      withRefresh(`/api/roster?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`, options),
    ),
  rosterExportUrl: (term: string, kcdm: string, skbjdm: string) =>
    `/api/roster/export?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`,
  rosterReportUrl: (term: string, kcdm: string, skbjdm: string) =>
    `/api/roster/report?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`,
  rosterPrintUrl: (term: string, kcdm: string, skbjdm: string) =>
    `/api/roster/report?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}&format=print`,
  progressClasses: (term: string, options?: CacheOptions) =>
    request<ProgressClassesData>(withRefresh(`/api/progress/classes?term=${encodeURIComponent(term)}`, options)),
  progressEntry: (term: string, params: Record<string, string>) =>
    request<ProgressEntryData>(`/api/progress/entry?term=${encodeURIComponent(term)}&${new URLSearchParams(params).toString()}`),
  progressSave: (body: unknown) =>
    request<ProgressSaveResult>('/api/progress/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  progressCopyTerms: (term: string, kcdm: string, skbjdm: string, options?: CacheOptions) =>
    request<ProgressCopyOptionsData>(
      withRefresh(`/api/progress/copy-terms?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}`, options),
    ),
  progressCopyClasses: (term: string, kcdm: string, skbjdm: string, xnxq: string, options?: CacheOptions) =>
    request<ProgressCopyOptionsData>(
      withRefresh(`/api/progress/copy-classes?term=${encodeURIComponent(term)}&kcdm=${encodeURIComponent(kcdm)}&skbjdm=${encodeURIComponent(skbjdm)}&xnxq=${encodeURIComponent(xnxq)}`, options),
    ),
  progressCopy: (kcdm: string, xnxq: string, source: string) =>
    request<ProgressCopyData>(
      `/api/progress/copy?kcdm=${encodeURIComponent(kcdm)}&xnxq=${encodeURIComponent(xnxq)}&source=${encodeURIComponent(source)}`,
    ),
  courseGradeClasses: (term: string, options?: CacheOptions) =>
    request<CourseGradeClassesData>(withRefresh(`/api/course-grades/classes?term=${encodeURIComponent(term)}`, options)),
  courseGrades: (term: string, params: Record<string, string>, options?: CacheOptions) =>
    request<CourseGradesData>(
      withRefresh(`/api/course-grades?term=${encodeURIComponent(term)}&${new URLSearchParams(params).toString()}`, options),
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
