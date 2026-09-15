import type { BuildingTimes, Course, ScheduleMeta, ScheduleTimes } from '../types/schedule';

export const DEFAULT_META: ScheduleMeta = {
  teacher: '马仲军',
  department: '智慧交通现代产业学院',
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

export const DEFAULT_COURSES: Course[] = [
  { name: '计算机组成原理', day: 2, slot: '1-2', weeks: '2-17', parity: null, room: 'F楼404（多）', bld: 'BCFG', clazz: '2025级本科网络工程班', count: 19 },
  { name: '计算机程序设计及应用', day: 4, slot: '1-2', weeks: '9-12', parity: null, room: 'F楼302交通仿真实验室', bld: 'BCFG', clazz: '2025级本科机械电子工程班', count: 53 },
  { name: '计算机程序设计及应用', day: 1, slot: '3-4', weeks: '2-5,7,9-17', parity: null, room: 'F楼302交通仿真实验室', bld: 'BCFG', clazz: '2025级本科机械电子工程班', count: 53 },
  { name: '计算机程序设计及应用', day: 5, slot: '3-4', weeks: '14-15,17', parity: null, room: 'F楼302交通仿真实验室', bld: 'BCFG', clazz: '2025级本科车辆工程班', count: 33 },
  { name: '计算机组成原理', day: 4, slot: '5-6', weeks: '2-4,6', parity: null, room: 'D楼208(多)', bld: 'DEHK', clazz: '2025级本科网络工程班', count: 19 },
  { name: '计算机组成原理实验', day: 2, slot: '7-8', weeks: '7-17', parity: 'odd', room: 'D楼408计算机组成结构实验室', bld: 'DEHK', clazz: '2025级本科网络工程班', count: 19 },
  { name: '计算机程序设计及应用', day: 4, slot: '7-8', weeks: '2-4,6-17', parity: null, room: 'F楼302交通仿真实验室', bld: 'BCFG', clazz: '2025级本科车辆工程班', count: 33 },
];

export const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const BUILDING_NAMES: Record<string, string> = {
  A: 'A楼',
  DEHK: 'D/E/H/K楼',
  BCFG: 'B/C/F/G楼',
  KHY: '康养1号2号楼及实验实训楼',
};
