import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { TeacherProfilesProvider, useTeacherProfiles } from './TeacherProfilesContext';

const PROFILE_KEY = 'kb-teacher-profiles-v1';

function validProfile(id: string, teacher: string, courses: unknown[] = []) {
  return {
    id,
    meta: { teacher, department: '', semesterLabel: '', semesterStart: '2026-08-31', totalWeeks: 20 },
    times: {},
    courses,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const sampleCourse = { name: '示例课程A', day: 2, slot: '1-2', weeks: '2-17', parity: null, room: 'A楼101', clazz: '示例一班' };

function Probe() {
  const { profiles, activeProfile } = useTeacherProfiles();
  return <div>{`${profiles.length}|${activeProfile.meta.teacher}`}</div>;
}

describe('TeacherProfilesContext storage recovery', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('keeps valid profiles when a sibling entry is corrupt', () => {
    const good = validProfile('p1', '张三');
    const bad = validProfile('p2', '李四');
    bad.meta.totalWeeks = 999;
    localStorage.setItem(PROFILE_KEY, JSON.stringify([good, bad]));

    render(
      <TeacherProfilesProvider>
        <Probe />
      </TeacherProfilesProvider>,
    );

    expect(screen.getByText('1|张三')).toBeInTheDocument();
    expect(localStorage.getItem(PROFILE_KEY)).not.toContain('999');
  });

  it('seeds an empty profile and backs up when every entry is corrupt', () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify([{ id: 'broken' }]));

    render(
      <TeacherProfilesProvider>
        <Probe />
      </TeacherProfilesProvider>,
    );

    expect(screen.getByText('1|我的课表')).toBeInTheDocument();
    const backups = Object.keys(localStorage).filter((key) => key.includes('-corrupt-'));
    expect(backups).toHaveLength(1);
  });

  it('seeds an empty profile on a fresh install', () => {
    render(
      <TeacherProfilesProvider>
        <Probe />
      </TeacherProfilesProvider>,
    );

    expect(screen.getByText('1|我的课表')).toBeInTheDocument();
  });

  it('replaces the empty placeholder when the first timetable is imported', () => {
    function ImportProbe() {
      const { profiles, activeProfile, upsertProfile } = useTeacherProfiles();
      return (
        <>
          <span>{`${profiles.length}|${activeProfile.meta.teacher}|${activeProfile.courses.length}`}</span>
          <button
            type="button"
            onClick={() => upsertProfile({ meta: { teacher: '示例教师', semesterStart: '2026-08-31', totalWeeks: 20 }, courses: [sampleCourse] })}
          >
            导入
          </button>
        </>
      );
    }

    render(
      <TeacherProfilesProvider>
        <ImportProbe />
      </TeacherProfilesProvider>,
    );

    expect(screen.getByText('1|我的课表|0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('1|示例教师|1')).toBeInTheDocument();
  });

  it('clears the last profile into a blank one instead of ignoring the delete', () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify([validProfile('p1', '示例教师', [sampleCourse])]));

    function DeleteProbe() {
      const { profiles, activeProfile, removeProfile } = useTeacherProfiles();
      return (
        <>
          <span>{`${profiles.length}|${activeProfile.meta.teacher}|${activeProfile.courses.length}`}</span>
          <button type="button" onClick={() => removeProfile(profiles[0].id)}>删除</button>
        </>
      );
    }

    render(
      <TeacherProfilesProvider>
        <DeleteProbe />
      </TeacherProfilesProvider>,
    );

    expect(screen.getByText('1|示例教师|1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('1|我的课表|0')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].courses).toHaveLength(0);
  });

  it('removes one of several profiles and keeps the rest', () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify([validProfile('p1', '张三'), validProfile('p2', '李四')]));

    function DeleteProbe() {
      const { profiles, activeProfile, removeProfile } = useTeacherProfiles();
      return (
        <>
          <span>{`${profiles.length}|${activeProfile.meta.teacher}`}</span>
          <button type="button" onClick={() => removeProfile('p1')}>删除</button>
        </>
      );
    }

    render(
      <TeacherProfilesProvider>
        <DeleteProbe />
      </TeacherProfilesProvider>,
    );

    expect(screen.getByText('2|张三')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('1|李四')).toBeInTheDocument();
  });

  it('clamps out-of-range and empty payload metadata instead of throwing', () => {
    function SaveProbe() {
      const { upsertProfile, activeProfile } = useTeacherProfiles();
      return (
        <button
          type="button"
          onClick={() => upsertProfile({ meta: { semesterStart: '', totalWeeks: 40 }, courses: [] })}
        >
          {`${activeProfile.meta.totalWeeks}|${activeProfile.meta.semesterStart}`}
        </button>
      );
    }

    render(
      <TeacherProfilesProvider>
        <SaveProbe />
      </TeacherProfilesProvider>,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('30|2026-08-31');
  });

  it('surfaces a storage write failure instead of silently dropping the import', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    function FailureProbe() {
      const { profiles, upsertProfile } = useTeacherProfiles();
      const [message, setMessage] = useState('');
      return (
        <>
          <span>{`${profiles.length}|${message}`}</span>
          <button
            type="button"
            onClick={() => {
              try {
                upsertProfile({ meta: { teacher: '示例教师', semesterStart: '2026-08-31', totalWeeks: 20 }, courses: [sampleCourse] });
              } catch (error) {
                setMessage(error instanceof Error ? error.message : '未知错误');
              }
            }}
          >
            导入
          </button>
        </>
      );
    }

    render(
      <TeacherProfilesProvider>
        <FailureProbe />
      </TeacherProfilesProvider>,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('1|本机存储空间不足，请清理后重试')).toBeInTheDocument();
  });
});
