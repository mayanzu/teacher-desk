import { useEffect, useMemo, useState } from 'react';
import { AcademicSyncDialog } from './components/AcademicSyncDialog';
import { AppHeader } from './components/AppHeader';
import { CourseDetailDialog } from './components/CourseDetailDialog';
import { HeroSection } from './components/HeroSection';
import { PasteImportDialog } from './components/PasteImportDialog';
import { PhotoImportDialog } from './components/PhotoImportDialog';
import { ScheduleSection } from './components/ScheduleSection';
import { SettingsDrawer } from './components/SettingsDrawer';
import { TeacherManagerDialog } from './components/TeacherManagerDialog';
import { ToastViewport } from './components/ToastViewport';
import { BUILDING_TIMES, DEFAULT_TIMES } from './data/defaults';
import { useAcademicSync } from './hooks/useAcademicSync';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useMotion } from './hooks/useMotion';
import { useNow } from './hooks/useNow';
import { useReminders } from './hooks/useReminders';
import { useTheme } from './hooks/useTheme';
import { useTeacherProfiles } from './context/TeacherProfilesContext';
import { useToast } from './context/ToastContext';
import { currentWeekNumber } from './lib/date';
import { isCourseActive, nextCourseInstance } from './lib/schedule';
import type { Course, ImportPayload } from './types/schedule';

export default function App() {
  const { activeProfile, upsertProfile } = useTeacherProfiles();
  const { notify } = useToast();
  const { theme, toggleTheme } = useTheme();
  const { paused: motionPaused, toggle: toggleMotion } = useMotion();
  const now = useNow();
  const [reduceTransparency, setReduceTransparency] = useLocalStorage('kb-reduce-transparency', false);
  const [reminderEnabled, setReminderEnabled] = useLocalStorage('kb-remind', false);
  const currentWeek = useMemo(() => currentWeekNumber(activeProfile.meta.semesterStart, activeProfile.meta.totalWeeks, now), [activeProfile.meta.semesterStart, activeProfile.meta.totalWeeks, now]);
  const [weekSelection, setWeekSelection] = useState<{ profileId: string; week: number } | null>(null);
  const viewWeek = weekSelection?.profileId === activeProfile.id ? weekSelection.week : currentWeek;
  const setWeek = (week: number) => setWeekSelection({ profileId: activeProfile.id, week: Math.min(activeProfile.meta.totalWeeks, Math.max(1, week)) });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [academicSyncOpen, setAcademicSyncOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [selectedCourses, setSelectedCourses] = useState<Course[]>([]);

  const times = useMemo(() => ({ ...DEFAULT_TIMES, ...activeProfile.times }), [activeProfile.times]);
  const buildingTimes = useMemo(() => ({ ...BUILDING_TIMES, ...activeProfile.timesByBuilding }), [activeProfile.timesByBuilding]);
  const courses = activeProfile.courses;
  const meta = activeProfile.meta;

  useEffect(() => {
    document.body.classList.toggle('reduce-transparency', reduceTransparency);
    return () => document.body.classList.remove('reduce-transparency');
  }, [reduceTransparency]);

  useEffect(() => {
    document.body.classList.toggle('drawer-open', settingsOpen);
    return () => document.body.classList.remove('drawer-open');
  }, [settingsOpen]);

  const next = useMemo(
    () => nextCourseInstance(courses, meta.semesterStart, meta.totalWeeks, currentWeek, times, buildingTimes, now),
    [buildingTimes, courses, currentWeek, meta, now, times],
  );

  const todayCount = useMemo(() => {
    const week = currentWeekNumber(meta.semesterStart, meta.totalWeeks, now);
    const day = now.getDay() || 7;
    return courses.filter((course) => course.day === day && isCourseActive(course, week, meta.totalWeeks)).length;
  }, [courses, meta, now]);

  const weekCount = useMemo(() => {
    return courses.filter((course) => isCourseActive(course, viewWeek, meta.totalWeeks)).length;
  }, [courses, meta.totalWeeks, viewWeek]);

  const handleSaveProfile = (payload: ImportPayload, close?: () => void) => {
    try {
      const saved = upsertProfile(payload, true);
      notify(`${saved.meta.teacher} 的课表已保存到本机档案`);
      close?.();
    } catch (error) {
      notify(`保存失败：${error instanceof Error ? error.message : '数据校验未通过'}`);
    }
  };

  const academicSync = useAcademicSync({ onImported: (payload) => handleSaveProfile(payload) });

  const toggleReminder = async () => {
    if (reminderEnabled) {
      setReminderEnabled(false);
      notify('课前提醒已关闭');
      return;
    }
    if (!('Notification' in window)) {
      notify('当前浏览器不支持通知');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      notify('通知权限未开启');
      return;
    }
    setReminderEnabled(true);
    notify('课前提醒已开启');
  };

  useReminders({
    enabled: reminderEnabled,
    courses,
    meta,
    times,
    buildingTimes,
    onWarning: notify,
  });

  return (
    <>
      <AppHeader
        date={now}
        week={viewWeek}
        theme={theme}
        motionPaused={motionPaused}
        onToggleTheme={toggleTheme}
        onToggleMotion={toggleMotion}
        onPhotoImport={() => setPhotoOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onToday={() => setWeek(currentWeek)}
      />
      <main id="main">
        <HeroSection
          meta={meta}
          week={viewWeek}
          now={now}
          next={next}
          todayCount={todayCount}
          weekCount={weekCount}
          onOpenTeacherManager={() => setTeacherOpen(true)}
          onOpenAcademicSync={() => { setAcademicSyncOpen(true); academicSync.start(); }}
          onOpenPasteImport={() => setPasteOpen(true)}
        />
        <ScheduleSection
          meta={meta}
          courses={courses}
          viewWeek={viewWeek}
          now={now}
          times={times}
          buildingTimes={buildingTimes}
          onWeekChange={setWeek}
          onToday={() => setWeek(currentWeek)}
          onSelectCourses={setSelectedCourses}
        />
      </main>
      <footer className="footer" id="data">
        <div>
          <p>作息依据安徽三联学院主校区时间表，已按课程教室所在楼栋自动匹配打铃时间。</p>
          <p>数据保存在当前浏览器的教师档案中，可随时切换、导出或重新导入。</p>
          <p>快捷键：← / → 切换周次 · Esc 关闭面板。</p>
          <div className="footer-bottom"><span>学期课表 · {meta.teacher}</span><a href="#top">回到顶部 ↑</a></div>
        </div>
      </footer>

      <SettingsDrawer
        open={settingsOpen}
        theme={theme}
        motionPaused={motionPaused}
        reduceTransparency={reduceTransparency}
        reminderEnabled={reminderEnabled}
        courses={courses}
        onClose={() => setSettingsOpen(false)}
        onToggleTheme={toggleTheme}
        onToggleMotion={toggleMotion}
        onToggleTransparency={() => setReduceTransparency((value) => !value)}
        onToggleReminder={toggleReminder}
        onOpenTeacherManager={() => { setSettingsOpen(false); setTeacherOpen(true); }}
      />
      <TeacherManagerDialog
        open={teacherOpen}
        onClose={() => setTeacherOpen(false)}
        onOpenPaste={() => { setTeacherOpen(false); setPasteOpen(true); }}
        onOpenAcademicSync={() => { setTeacherOpen(false); setAcademicSyncOpen(true); academicSync.start(); }}
      />
      <AcademicSyncDialog
        open={academicSyncOpen}
        status={academicSync.status}
        message={academicSync.message}
        qrCodeValue={academicSync.qrCodeValue}
        onStart={academicSync.start}
        onClose={() => { setAcademicSyncOpen(false); academicSync.reset(); }}
      />
      <PasteImportDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onSave={(payload) => handleSaveProfile(payload)}
      />
      <PhotoImportDialog
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        onSave={(payload) => handleSaveProfile(payload)}
      />
      <CourseDetailDialog
        open={selectedCourses.length > 0}
        courses={selectedCourses}
        meta={meta}
        times={times}
        buildingTimes={buildingTimes}
        onClose={() => setSelectedCourses([])}
      />
      <ToastViewport />
    </>
  );
}
