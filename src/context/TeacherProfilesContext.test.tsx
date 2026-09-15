import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TeacherProfilesProvider, useTeacherProfiles } from './TeacherProfilesContext';

const PROFILE_KEY = 'kb-teacher-profiles-v1';

function validProfile(id: string, teacher: string) {
  return {
    id,
    meta: { teacher, department: '', semesterLabel: '', semesterStart: '2026-08-31', totalWeeks: 20 },
    times: {},
    courses: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function Probe() {
  const { profiles, activeProfile } = useTeacherProfiles();
  return <div>{`${profiles.length}|${activeProfile.meta.teacher}`}</div>;
}

describe('TeacherProfilesContext storage recovery', () => {
  beforeEach(() => localStorage.clear());

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

  it('seeds the built-in profile and backs up when every entry is corrupt', () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify([{ id: 'broken' }]));

    render(
      <TeacherProfilesProvider>
        <Probe />
      </TeacherProfilesProvider>,
    );

    expect(screen.getByText('1|马仲军')).toBeInTheDocument();
    const backups = Object.keys(localStorage).filter((key) => key.includes('-corrupt-'));
    expect(backups).toHaveLength(1);
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
});
