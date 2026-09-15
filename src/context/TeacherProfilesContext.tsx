import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { BUILDING_TIMES, DEFAULT_COURSES, DEFAULT_META, DEFAULT_TIMES } from '../data/defaults';
import { downloadJson, safeFilename } from '../lib/download';
import type { ImportPayload, ScheduleMeta, TeacherProfile } from '../types/schedule';

const courseSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  day: z.number().min(1).max(7),
  slot: z.string(),
  weeks: z.string(),
  parity: z.enum(['odd', 'even']).nullable(),
  room: z.string(),
  bld: z.string().optional(),
  clazz: z.string(),
  count: z.number().nullable().optional(),
});

const metaSchema = z.object({
  teacher: z.string().default('我的课表'),
  department: z.string().default(''),
  semesterLabel: z.string().default(''),
  semesterStart: z.string(),
  totalWeeks: z.number().min(1).max(30).default(20),
});

const profileSchema = z.object({
  id: z.string(),
  meta: metaSchema,
  times: z.record(z.string(), z.tuple([z.string(), z.string()])).default({}),
  timesByBuilding: z.record(z.string(), z.record(z.string(), z.tuple([z.string(), z.string()]))).optional(),
  courses: z.array(courseSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  builtin: z.boolean().optional(),
});

const profilesSchema = z.array(profileSchema);
const PROFILE_KEY = 'kb-teacher-profiles-v1';
const ACTIVE_KEY = 'kb-active-teacher';

function uid() {
  return `teacher_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function builtinProfile(): TeacherProfile {
  const now = new Date().toISOString();
  return {
    id: 'builtin',
    meta: { ...DEFAULT_META },
    times: { ...DEFAULT_TIMES },
    timesByBuilding: structuredClone(BUILDING_TIMES),
    courses: structuredClone(DEFAULT_COURSES),
    createdAt: now,
    updatedAt: now,
    builtin: true,
  };
}

function readProfiles(): TeacherProfile[] {
  try {
    const parsed = profilesSchema.safeParse(JSON.parse(localStorage.getItem(PROFILE_KEY) || '[]'));
    if (parsed.success && parsed.data.length) return parsed.data as TeacherProfile[];
  } catch {
    // Ignore corrupt local data and seed the built-in profile.
  }
  const seed = [builtinProfile()];
  localStorage.setItem(PROFILE_KEY, JSON.stringify(seed));
  localStorage.setItem(ACTIVE_KEY, seed[0].id);
  return seed;
}

function persist(profiles: TeacherProfile[]) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
}

function normalizePayload(payload: ImportPayload): TeacherProfile {
  const now = new Date().toISOString();
  return {
    id: uid(),
    meta: metaSchema.parse({
      ...DEFAULT_META,
      ...payload.meta,
      totalWeeks: payload.meta.totalWeeks || 20,
    }),
    times: payload.times || DEFAULT_TIMES,
    timesByBuilding: payload.timesByBuilding,
    courses: payload.courses,
    createdAt: now,
    updatedAt: now,
  };
}

function sameProfile(a: TeacherProfile, b: TeacherProfile) {
  return (
    a.meta.teacher === b.meta.teacher &&
    a.meta.department === b.meta.department &&
    a.meta.semesterLabel === b.meta.semesterLabel
  );
}

interface TeacherProfilesContextValue {
  profiles: TeacherProfile[];
  activeProfile: TeacherProfile;
  activeId: string;
  upsertProfile: (payload: ImportPayload, activate?: boolean) => TeacherProfile;
  setActive: (id: string) => void;
  removeProfile: (id: string) => void;
  duplicateProfile: (id: string) => void;
  exportProfile: (id: string) => void;
  exportAll: () => void;
  importProfiles: (file: File) => Promise<number>;
  systemUrl: string;
}

const TeacherProfilesContext = createContext<TeacherProfilesContextValue | null>(null);

export function TeacherProfilesProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<TeacherProfile[]>(readProfiles);
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem(ACTIVE_KEY);
    return profiles.some((profile) => profile.id === saved) ? saved! : profiles[0].id;
  });

  const persistProfiles = useCallback((next: TeacherProfile[]) => {
    setProfiles(next);
    persist(next);
  }, []);

  const activate = useCallback((id: string) => {
    if (!profiles.some((profile) => profile.id === id)) return;
    localStorage.setItem(ACTIVE_KEY, id);
    setActiveId(id);
  }, [profiles]);

  const upsertProfile = useCallback((payload: ImportPayload, activate = true) => {
    const candidate = normalizePayload(payload);
    const index = profiles.findIndex((profile) => sameProfile(profile, candidate));
    let saved: TeacherProfile;
    const next = [...profiles];
    if (index >= 0) {
      saved = { ...candidate, id: profiles[index].id, createdAt: profiles[index].createdAt, builtin: false };
      next[index] = saved;
    } else {
      saved = candidate;
      next.push(saved);
    }
    persistProfiles(next);
    if (activate) {
      localStorage.setItem(ACTIVE_KEY, saved.id);
      setActiveId(saved.id);
    }
    return saved;
  }, [persistProfiles, profiles]);

  const removeProfile = useCallback((id: string) => {
    if (profiles.length <= 1) return;
    const next = profiles.filter((profile) => profile.id !== id);
    persistProfiles(next);
    if (activeId === id) {
      localStorage.setItem(ACTIVE_KEY, next[0].id);
      setActiveId(next[0].id);
    }
  }, [activeId, persistProfiles, profiles]);

  const duplicateProfile = useCallback((id: string) => {
    const source = profiles.find((profile) => profile.id === id);
    if (!source) return;
    const now = new Date().toISOString();
    const copy: TeacherProfile = {
      ...structuredClone(source),
      id: uid(),
      builtin: false,
      meta: { ...source.meta, teacher: `${source.meta.teacher}（副本）` },
      createdAt: now,
      updatedAt: now,
    };
    persistProfiles([...profiles, copy]);
  }, [persistProfiles, profiles]);

  const exportProfile = useCallback((id: string) => {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    downloadJson(`${safeFilename(profile.meta.teacher)}-课表档案.json`, profile);
  }, [profiles]);

  const exportAll = useCallback(() => {
    downloadJson('全部教师课表档案.json', profiles);
  }, [profiles]);

  const importProfiles = useCallback(async (file: File) => {
    const raw = JSON.parse(await file.text());
    const items = Array.isArray(raw) ? raw : [raw];
    let count = 0;
    let next = [...profiles];
    items.forEach((item) => {
      const parsed = profileSchema.safeParse(item);
      if (!parsed.success) return;
      const candidate = { ...(parsed.data as TeacherProfile), id: uid(), builtin: false };
      next = [...next.filter((profile) => !sameProfile(profile, candidate)), candidate];
      count += 1;
    });
    if (!count) throw new Error('文件中没有可导入的教师课表档案');
    persistProfiles(next);
    return count;
  }, [persistProfiles, profiles]);

  const activeProfile = profiles.find((profile) => profile.id === activeId) || profiles[0];
  const systemUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    return url.toString();
  }, []);
  const value = useMemo<TeacherProfilesContextValue>(() => ({
    profiles,
    activeProfile,
    activeId: activeProfile.id,
    upsertProfile,
    setActive: activate,
    removeProfile,
    duplicateProfile,
    exportProfile,
    exportAll,
    importProfiles,
    systemUrl,
  }), [activeProfile, activate, duplicateProfile, exportAll, exportProfile, importProfiles, profiles, removeProfile, systemUrl, upsertProfile]);

  return <TeacherProfilesContext.Provider value={value}>{children}</TeacherProfilesContext.Provider>;
}

export function useTeacherProfiles() {
  const context = useContext(TeacherProfilesContext);
  if (!context) throw new Error('useTeacherProfiles must be used within TeacherProfilesProvider');
  return context;
}

export type { ScheduleMeta };
