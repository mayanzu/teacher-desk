import { format } from 'date-fns';
import { z } from 'zod';
import { BUILDING_TIMES, DEFAULT_META, DEFAULT_TIMES } from '../../data/defaults';
import { parseHtmlTable } from '../../lib/parser';
import type { ImportPayload } from '../../types/schedule';

export const SLU_ORIGIN = 'https://jwxt.slu.edu.cn:4060';

export const sluStartSchema = z.object({
  status: z.literal('waiting'),
  session: z.string().min(16),
  qrCode: z.string().min(16),
  expiresIn: z.number().positive(),
});

export const sluStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('waiting'), message: z.string().optional() }),
  z.object({
    status: z.literal('success'),
    html: z.string().min(20),
    teacher: z.string().optional().default(''),
    semesterLabel: z.string().optional().default(''),
  }),
  z.object({ status: z.literal('error'), message: z.string() }),
  z.object({ status: z.literal('expired'), message: z.string() }),
]);

export type SluStatusResult = z.infer<typeof sluStatusSchema>;

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

export function buildSluImportPayload(result: Extract<SluStatusResult, { status: 'success' }>): ImportPayload {
  const parsed = parseHtmlTable(result.html);
  const documentNode = new DOMParser().parseFromString(result.html, 'text/html');
  const title = documentNode.body.textContent?.match(/\d{4}-\d{4}学年(?:第[一二]学期)?教学安排表/)?.[0] || '';
  return {
    meta: {
      teacher: result.teacher || parsed.teacher || '我的课表',
      department: parsed.department || '',
      semesterLabel: result.semesterLabel || title || DEFAULT_META.semesterLabel,
      semesterStart: inferSemesterStart(result.html),
      totalWeeks: Math.max(20, parsed.maxWeek || 0),
    },
    times: DEFAULT_TIMES,
    timesByBuilding: BUILDING_TIMES,
    courses: parsed.courses,
  };
}
