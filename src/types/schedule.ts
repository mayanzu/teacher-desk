export type WeekParity = 'odd' | 'even' | null;

export interface Course {
  id?: string;
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

export type ScheduleTimes = Record<string, [string, string]>;
export type BuildingTimes = Record<string, ScheduleTimes>;

export interface ScheduleMeta {
  teacher: string;
  department: string;
  semesterLabel: string;
  semesterStart: string;
  totalWeeks: number;
}

export interface TeacherProfile {
  id: string;
  meta: ScheduleMeta;
  times: ScheduleTimes;
  timesByBuilding?: BuildingTimes;
  courses: Course[];
  createdAt: string;
  updatedAt: string;
  builtin?: boolean;
}

export interface ImportPayload {
  meta: Partial<ScheduleMeta>;
  times?: ScheduleTimes;
  timesByBuilding?: BuildingTimes;
  courses: Course[];
}

export interface ParsedCourse extends Course {
  warning?: string;
}

export interface ParsedSchedule {
  source?: 'structured' | 'plain' | 'html';
  teacher: string;
  department: string;
  courses: ParsedCourse[];
  warnings: string[];
  maxWeek: number;
}

export interface CourseInstance {
  course: Course;
  week: number;
  start: Date;
  end: Date;
}

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  x2: number;
  y2: number;
}
