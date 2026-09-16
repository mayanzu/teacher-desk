import type { BuildingTimes, ScheduleMeta, ScheduleTimes } from '../types/schedule';

export const DEFAULT_META: ScheduleMeta = {
  teacher: '我的课表',
  department: '',
  semesterLabel: '2026–2027 第一学期',
  semesterStart: '2026-08-31',
  totalWeeks: 20,
};

export const DEFAULT_TIMES: ScheduleTimes = {
  '1-2': ['08:15', '09:50'],
  '3-4': ['10:05', '11:40'],
  '5-6': ['13:35', '15:10'],
  '7-8': ['15:20', '16:55'],
  '9-10': ['18:00', '19:35'],
  '11-12': ['19:40', '21:15'],
};

export const BUILDING_TIMES: BuildingTimes = {
  A: {
    '1-2': ['08:15', '09:50'],
    '3-4': ['10:05', '11:40'],
    '5-6': ['13:35', '15:10'],
    '7-8': ['15:20', '16:55'],
  },
  DEHK: {
    '1-2': ['08:10', '09:45'],
    '3-4': ['10:00', '11:35'],
    '5-6': ['13:30', '15:05'],
    '7-8': ['15:15', '16:50'],
  },
  BCFG: {
    '1-2': ['08:15', '09:50'],
    '3-4': ['10:05', '11:45'],
    '5-6': ['13:40', '15:15'],
    '7-8': ['15:25', '17:00'],
  },
  KHY: {
    '1-2': ['08:10', '09:45'],
    '3-4': ['10:00', '11:35'],
    '5-6': ['13:30', '15:05'],
    '7-8': ['15:20', '16:55'],
  },
};

export const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const BUILDING_NAMES: Record<string, string> = {
  A: 'A楼',
  DEHK: 'D/E/H/K楼',
  BCFG: 'B/C/F/G楼',
  KHY: '康养1号2号楼及实验实训楼',
};
