import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { BUILDING_TIMES, DEFAULT_META, DEFAULT_TIMES } from '../data/defaults';
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

const PROFILE_KEY = 'kb-teacher-profiles-v1';
const ACTIVE_KEY = 'kb-active-teacher';

function uid() {
  return `teacher_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blankProfile(): TeacherProfile {
  const now = new Date().toISOString();
  return {
    id: uid(),
    meta: { teacher: '我的课表', department: '', semesterLabel: '', semesterStart: DEFAULT_META.semesterStart, totalWeeks: DEFAULT_META.totalWeeks },
    times: structuredClone(DEFAULT_TIMES),
    timesByBuilding: structuredClone(BUILDING_TIMES),
    courses: [],
    createdAt: now,
    updatedAt: now,
  };
}

function writeProfiles(profiles: TeacherProfile[]): boolean {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
    return true;
  } catch {
    return false;
  }
}

function writeActive(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // Storage unavailable; the active profile still works for this session.
  }
}

function readActive(fallback: string): string {
  try {
    const saved = localStorage.getItem(ACTIVE_KEY);
    return saved ?? fallback;
  } catch {
    return fallback;
  }
}

interface StoredProfiles {
  profiles: TeacherProfile[];
  needsWrite: boolean;
  activeToWrite: string | null;
  backupRaw: string | null;
}

function readStoredProfiles(): StoredProfiles {
  let backupRaw: string | null = null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const items: unknown = JSON.parse(raw);
      if (Array.isArray(items) && items.length) {
        const valid: TeacherProfile[] = [];
        items.forEach((item) => {
          const result = profileSchema.safeParse(item);
          if (result.success) valid.push(result.data);
        });
        if (valid.length) {
          return { profiles: valid, needsWrite: valid.length !== items.length, activeToWrite: null, backupRaw: null };
        }
        backupRaw = raw;
      }
    }
  } catch {
    // Ignore corrupt local data and seed an empty profile.
  }
  const seed = [blankProfile()];
  return { profiles: seed, needsWrite: true, activeToWrite: seed[0].id, backupRaw };
}

function normalizePayload(payload: ImportPayload): TeacherProfile {
  const now = new Date().toISOString();
  const totalWeeks = Math.min(30, Math.max(1, Math.round(Number(payload.meta.totalWeeks) || DEFAULT_META.totalWeeks)));
  return {
    id: uid(),
    meta: metaSchema.parse({
      ...DEFAULT_META,
      ...payload.meta,
      semesterStart: payload.meta.semesterStart || DEFAULT_META.semesterStart,
      totalWeeks,
    }),
    times: payload.times ? structuredClone(payload.times) : structuredClone(DEFAULT_TIMES),
    timesByBuilding: structuredClone(payload.timesByBuilding || BUILDING_TIMES),
    courses: payload.courses,
    createdAt: now,
    updatedAt: now,
  };
}

function sameProfile(a: TeacherProfile, b: TeacherProfile) {
  return (
    a.meta.teacher === b.meta.teacher &&
    a.meta.department === b.meta.department &&
    a.meta.semesterLabel === b.meta.semesterLabel &&
    a.meta.semesterStart === b.meta.semesterStart
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
}

const TeacherProfilesContext = createContext<TeacherProfilesContextValue | null>(null);

export function TeacherProfilesProvider({ children }: { children: ReactNode }) {
  const [stored] = useState(readStoredProfiles);
  const [profiles, setProfiles] = useState<TeacherProfile[]>(stored.profiles);
  const [activeId, setActiveId] = useState(() => {
    const saved = readActive(stored.profiles[0].id);
    return stored.profiles.some((profile) => profile.id === saved) ? saved : stored.profiles[0].id;
  });

  useEffect(() => {
    if (stored.backupRaw) {
      try {
        localStorage.setItem(`${PROFILE_KEY}-corrupt-${Date.now()}`, stored.backupRaw);
      } catch {
        // Keep going even if the backup cannot be written.
      }
    }
    if (stored.needsWrite) writeProfiles(stored.profiles);
    if (stored.activeToWrite) writeActive(stored.activeToWrite);
  }, [stored]);

  const persistProfiles = useCallback((next: TeacherProfile[]) => {
    if (!writeProfiles(next)) throw new Error('本机存储空间不足，请清理后重试');
    setProfiles(next);
  }, []);

  const activate = useCallback((id: string) => {
    if (!profiles.some((profile) => profile.id === id)) return;
    writeActive(id);
    setActiveId(id);
  }, [profiles]);

  const upsertProfile = useCallback((payload: ImportPayload, activate = true) => {
    const candidate = normalizePayload(payload);
    const placeholder = profiles.length === 1 && profiles[0].courses.length === 0 && !profiles[0].builtin;
    const index = placeholder ? 0 : profiles.findIndex((profile) => sameProfile(profile, candidate));
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
      writeActive(saved.id);
      setActiveId(saved.id);
    }
    return saved;
  }, [persistProfiles, profiles]);

  const removeProfile = useCallback((id: string) => {
    if (!profiles.some((profile) => profile.id === id)) return;
    const remaining = profiles.filter((profile) => profile.id !== id);
    const next = remaining.length ? remaining : [blankProfile()];
    persistProfiles(next);
    if (activeId === id || !next.some((profile) => profile.id === activeId)) {
      writeActive(next[0].id);
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
      const candidate: TeacherProfile = { ...parsed.data, id: uid(), builtin: false };
      next = [...next.filter((profile) => !sameProfile(profile, candidate)), candidate];
      count += 1;
    });
    if (!count) throw new Error('文件中没有可导入的教师课表档案');
    persistProfiles(next);
    return count;
  }, [persistProfiles, profiles]);

  const activeProfile = profiles.find((profile) => profile.id === activeId) || profiles[0];
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
  }), [activeProfile, activate, duplicateProfile, exportAll, exportProfile, importProfiles, profiles, removeProfile, upsertProfile]);

  return <TeacherProfilesContext.Provider value={value}>{children}</TeacherProfilesContext.Provider>;
}

export function useTeacherProfiles() {
  const context = useContext(TeacherProfilesContext);
  if (!context) throw new Error('useTeacherProfiles must be used within TeacherProfilesProvider');
  return context;
}

export type { ScheduleMeta };
