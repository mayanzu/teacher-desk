import { format } from 'date-fns';
import { z } from 'zod';
import { BUILDING_TIMES, DEFAULT_META, DEFAULT_TIMES } from '../../data/defaults';
import { parseHtmlTable } from '../../lib/parser';
import type { ImportPayload } from '../../types/schedule';

export const SLU_ORIGIN = 'https://jwxt.slu.edu.cn:4060';
export const SLU_LOGIN_URL = `${SLU_ORIGIN}/ahsljw/cas/login.action`;
export const SLU_SYNC_MESSAGE = 'SLU_JWXT_SYNC_V1';

export const sluSyncSchema = z.object({
  type: z.literal(SLU_SYNC_MESSAGE),
  token: z.string().min(16),
  html: z.string().min(20),
  teacher: z.string().optional().default(''),
  semesterLabel: z.string().optional().default(''),
});

export type SluSyncHandoff = z.infer<typeof sluSyncSchema>;

export function createSyncToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function openSluLoginWindow(token: string): Window | null {
  const windowName = `slu-sync:${token}|${window.location.origin}`;
  const width = 520;
  const height = 760;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  return window.open(
    SLU_LOGIN_URL,
    windowName,
    `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},resizable=yes,scrollbars=yes`,
  );
}

function inferSemesterStart(html: string): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const text = documentNode.body.textContent || '';
  const week = Number(text.match(/第(\d+)周/)?.[1] || 0);
  const year = Number(text.match(/(\d{4})-\d{4}学年/)?.[1] || 0);
  const date = text.match(/(?:^|\D)(\d{2})-(\d{2})(?:\D|$)/);
  if (!week || !year || !date) return DEFAULT_META.semesterStart;
  const firstHeaderDate = new Date(year, Number(date[1]) - 1, Number(date[2]));
  firstHeaderDate.setDate(firstHeaderDate.getDate() - (week - 1) * 7);
  return format(firstHeaderDate, 'yyyy-MM-dd');
}

export function buildSluImportPayload(handoff: SluSyncHandoff): ImportPayload {
  const parsed = parseHtmlTable(handoff.html);
  const documentNode = new DOMParser().parseFromString(handoff.html, 'text/html');
  const title = documentNode.body.textContent?.match(/\d{4}-\d{4}学年(?:第[一二]学期)?教学安排表/)?.[0] || '';
  return {
    meta: {
      teacher: handoff.teacher || parsed.teacher || '我的课表',
      department: parsed.department || '',
      semesterLabel: handoff.semesterLabel || title || DEFAULT_META.semesterLabel,
      semesterStart: inferSemesterStart(handoff.html),
      totalWeeks: Math.max(20, parsed.maxWeek || 0),
    },
    times: DEFAULT_TIMES,
    timesByBuilding: BUILDING_TIMES,
    courses: parsed.courses,
  };
}
