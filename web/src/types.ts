export type WeekParity = 'odd' | 'even' | null;

export interface Course {
  name: string;
  day: number;
  slot: string;
  weeks: string;
  parity: WeekParity;
  room: string;
  bld?: string;
  clazz: string;
  count?: number | null;
}

export interface ScheduleData {
  calendarEstimated?: boolean;
  timesEstimated?: boolean;
  xn: number;
  xq: number;
  term?: string;
  teacher: string;
  courses: Course[];
  maxWeek: number;
  totalWeeks: number;
  semesterStart?: string;
  times?: Record<string, [string, string]>;
}

export interface CourseInstance {
  course: Course;
  week: number;
  start: Date;
  end: Date;
}

export interface Term {
  value: string;
  label: string;
}

export interface TermsData {
  terms: Term[];
  current: string;
}

export interface SessionData {
  loggedIn: boolean;
  username: string;
}

export interface LoginStart {
  qrDataUrl: string;
  expiresIn: number;
}

export type LoginPhase = 'idle' | 'waiting' | 'success' | 'error';

export interface LoginState {
  status: LoginPhase;
  message: string;
  username: string;
}

export type PageKey = 'schedule' | 'tasks' | 'progress' | 'grades';

export type ModuleKey = Exclude<PageKey, 'schedule'>;

export interface ProgressClassParams {
  kcdm: string;
  bjdm: string;
  skbjdm?: string;
  kcmc: string;
  bjmc: string;
  pklb: string;
  jsdm: string;
  jsxm: string;
  lsjs: string;
}

export interface ProgressClass {
  courseRaw: string;
  className: string;
  classCode: string;
  credit: string;
  hours: string;
  audit: string;
  teacher: string;
  entryTime: string;
  params: ProgressClassParams;
}

export interface ProgressClassesData {
  items: ProgressClass[];
  xn: number;
  xq: number;
}

export interface ProgressEntryRow {
  subId: string;
  index: string;
  week: string;
  parity: string;
  weekList: string;
  weekday: string;
  date: string;
  hours: string;
  periodOfDay: string;
  periodCode: string;
  periodList: string;
  period: string;
  lectureHours: string;
  practiceHours: string;
  labHours: string;
  otherHours: string;
  classCode: string;
  content: string;
  contentZ: string;
  contentJ: string;
  requirement: string;
  homework: string;
  remark: string;
  mode: string;
  modeCode: string;
}

export interface ProgressTotals {
  lecture: number;
  lab: number;
  practice: number;
  labor: number;
  other: number;
}

export interface ProgressEntryData {
  meta: Record<string, string>;
  formFields?: Record<string, string>;
  rows: ProgressEntryRow[];
  gridTable: string;
  xqskzs?: string;
  totals?: ProgressTotals;
  xn: number;
  xq: number;
}

export interface ProgressSaveResult {
  preview?: boolean;
  payload?: unknown;
  note?: string;
  status?: number;
  text?: string;
  data?: { status?: string; message?: string } | null;
}

export interface ProgressSummaryRow {
  week: string;
  date: string;
  period: string;
  content: string;
  room: string;
}

export interface ProgressSummaryGroup {
  kcdm: string;
  skbjdm: string;
  bjdm?: string;
  bjmc?: string;
  kcmc?: string;
  teacher?: string;
  className: string;
  courseName: string;
  courses?: string[];
  count: number;
  minWeek: number;
  maxWeek: number;
  startDate?: string;
  endDate?: string;
  rows: ProgressSummaryRow[];
}

export interface ProgressSummaryFailure {
  className: string;
  message: string;
}

export interface ProgressSummaryData {
  items: ProgressSummaryGroup[];
  failures?: ProgressSummaryFailure[];
}

export interface RosterClass {
  kcdm: string;
  skbjdm: string;
  courseName: string;
  className: string;
}

export interface RosterClassListData {
  items: RosterClass[];
}

export interface RosterItem {
  index: string;
  className: string;
  studentId: string;
  name: string;
  gender: string;
  college: string;
  major: string;
  type: string;
  remark: string;
}

export interface RosterData {
  items: RosterItem[];
}

export interface ProgressCopyOption {
  code: string;
  name: string;
}

export interface ProgressCopyOptionsData {
  items: ProgressCopyOption[];
}

export interface ProgressCopyItem {
  content: string;
  mode: string;
  lectureHours: string;
  labHours: string;
  practiceHours: string;
  otherHours: string;
  requirement: string;
  homework: string;
  remark: string;
}

export interface ProgressCopyData {
  items: ProgressCopyItem[];
}

export interface CourseGradeClass {
  kcdm: string;
  bjdm: string;
  courseCode: string;
  courseName: string;
  credit: string;
  hours: string;
  className: string;
  students: string;
  category: string;
  mode: string;
  exam: string;
}

export interface CourseGradeClassesData {
  items: CourseGradeClass[];
  xn: number;
  xq: number;
}

export interface CourseGradeHeaderCell {
  text: string;
  rowSpan: number;
  colSpan: number;
}

export interface CourseGradesData {
  term: string;
  kcdm: string;
  bjdm: string;
  bjmc: string;
  flag: string;
  dyfs: string;
  meta: string[];
  header: CourseGradeHeaderCell[][];
  rows: string[][];
  empty: boolean;
}
