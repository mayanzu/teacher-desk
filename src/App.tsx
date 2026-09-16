import { useCallback, useEffect, useMemo, useState } from 'react';
import { AcademicSyncDialog } from './components/AcademicSyncDialog';
import { AppHeader } from './components/AppHeader';
import { CourseDetailDialog } from './components/CourseDetailDialog';
import { HeroSection } from './components/HeroSection';
import { OnboardingDialog } from './components/OnboardingDialog';
import { PasteImportDialog } from './components/PasteImportDialog';
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
import { useTeacherProfiles } from './context/TeacherProfilesContext';
import { useToastActions } from './context/ToastContext';
import { currentWeekNumber } from './lib/date';
import { isCourseActive, nextCourseInstance } from './lib/schedule';
import type { Course, ImportPayload } from './types/schedule';

export default function App() {
  const { activeProfile, profiles, upsertProfile } = useTeacherProfiles();
  const { notify } = useToastActions();
  const { paused: motionPaused, toggle: toggleMotion } = useMotion();
  const now = useNow();
  const [reduceTransparency, setReduceTransparency] = useLocalStorage('kb-reduce-transparency', false);
  const [reminderEnabled, setReminderEnabled] = useLocalStorage('kb-remind', false);
  const currentWeek = useMemo(() => currentWeekNumber(activeProfile.meta.semesterStart, activeProfile.meta.totalWeeks, now), [activeProfile.meta.semesterStart, activeProfile.meta.totalWeeks, now]);
  const [weekSelection, setWeekSelection] = useState<{ profileId: string; week: number } | null>(null);
  const rawWeek = weekSelection?.profileId === activeProfile.id ? weekSelection.week : currentWeek;
  const viewWeek = Math.min(activeProfile.meta.totalWeeks, Math.max(1, rawWeek));
  const setWeek = useCallback((week: number) => {
    setWeekSelection({ profileId: activeProfile.id, week: Math.min(activeProfile.meta.totalWeeks, Math.max(1, week)) });
  }, [activeProfile.id, activeProfile.meta.totalWeeks]);
  const goToday = useCallback(() => setWeek(currentWeek), [currentWeek, setWeek]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [academicSyncOpen, setAcademicSyncOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [selectedCourses, setSelectedCourses] = useState<Course[]>([]);
  const [onboardingClosed, setOnboardingClosed] = useState(false);
  const needsOnboarding = !onboardingClosed && profiles.length === 1 && activeProfile.courses.length === 0;

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

  const handleSaveProfile = (payload: ImportPayload, close?: () => void): boolean => {
    try {
      const saved = upsertProfile(payload, true);
      notify(`${saved.meta.teacher} 的课表已保存到本机档案`);
      close?.();
      return true;
    } catch (error) {
      notify(`保存失败：${error instanceof Error ? error.message : '数据校验未通过'}`);
      return false;
    }
  };

  const academicSync = useAcademicSync({ onImported: (payload) => handleSaveProfile(payload) });
  const syncStatus = academicSync.status;
  const startSync = academicSync.start;
  const resetSync = academicSync.reset;

  useEffect(() => {
    if (syncStatus !== 'success') return;
    const timer = window.setTimeout(() => {
      setAcademicSyncOpen(false);
      resetSync();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [resetSync, syncStatus]);

  const openImport = useCallback(() => setImportOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openTeacher = useCallback(() => setTeacherOpen(true), []);
  const closeTeacher = useCallback(() => setTeacherOpen(false), []);
  const closePaste = useCallback(() => setPasteOpen(false), []);
  const closeCourses = useCallback(() => setSelectedCourses([]), []);
  const openTeacherFromSettings = useCallback(() => { setSettingsOpen(false); setTeacherOpen(true); }, []);
  const openPasteFromTeacher = useCallback(() => { setTeacherOpen(false); setPasteOpen(true); }, []);
  const openSyncFromTeacher = useCallback(() => { setTeacherOpen(false); setAcademicSyncOpen(true); startSync(); }, [startSync]);
  const closeOnboarding = useCallback(() => { setOnboardingClosed(true); setImportOpen(false); }, []);
  const openSyncFromOnboarding = useCallback(() => { setOnboardingClosed(true); setImportOpen(false); setAcademicSyncOpen(true); startSync(); }, [startSync]);
  const openPasteFromOnboarding = useCallback(() => { setOnboardingClosed(true); setImportOpen(false); setPasteOpen(true); }, []);
  const closeSync = useCallback(() => { setAcademicSyncOpen(false); resetSync(); }, [resetSync]);

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
        onImport={openImport}
        onOpenSettings={openSettings}
      />
      <main id="main">
        <HeroSection
          meta={meta}
          week={viewWeek}
          now={now}
          next={next}
          todayCount={todayCount}
          weekCount={weekCount}
          hasCourses={courses.length > 0}
          onOpenTeacherManager={openTeacher}
        />
        <ScheduleSection
          meta={meta}
          courses={courses}
          viewWeek={viewWeek}
          now={now}
          times={times}
          buildingTimes={buildingTimes}
          onWeekChange={setWeek}
          onToday={goToday}
          onSelectCourses={setSelectedCourses}
          onImport={openImport}
        />
      </main>
      <footer className="footer" id="data">
        <div className="footer-bottom">
          <p>快捷键：← / → 切换周次 · Esc 关闭面板。</p>
          <a href="https://github.com/mayanzu/teacher-timetable" target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
      </footer>

      <SettingsDrawer
        open={settingsOpen}
        motionPaused={motionPaused}
        reduceTransparency={reduceTransparency}
        reminderEnabled={reminderEnabled}
        courses={courses}
        onClose={closeSettings}
        onToggleMotion={toggleMotion}
        onToggleTransparency={() => setReduceTransparency((value) => !value)}
        onToggleReminder={toggleReminder}
        onOpenTeacherManager={openTeacherFromSettings}
      />
      <TeacherManagerDialog
        open={teacherOpen}
        onClose={closeTeacher}
        onOpenPaste={openPasteFromTeacher}
        onOpenAcademicSync={openSyncFromTeacher}
      />
      <OnboardingDialog
        open={needsOnboarding || importOpen}
        onClose={closeOnboarding}
        onAcademicSync={openSyncFromOnboarding}
        onPaste={openPasteFromOnboarding}
      />
      <AcademicSyncDialog
        open={academicSyncOpen}
        status={academicSync.status}
        message={academicSync.message}
        qrCodeValue={academicSync.qrCodeValue}
        onStart={startSync}
        onClose={closeSync}
      />
      <PasteImportDialog
        open={pasteOpen}
        onClose={closePaste}
        onSave={handleSaveProfile}
      />
      <CourseDetailDialog
        open={selectedCourses.length > 0}
        courses={selectedCourses}
        meta={meta}
        times={times}
        buildingTimes={buildingTimes}
        onClose={closeCourses}
      />
      <ToastViewport />
    </>
  );
}
