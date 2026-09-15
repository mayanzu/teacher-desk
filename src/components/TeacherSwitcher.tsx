import { ChevronRight } from 'lucide-react';
import { initials } from '../lib/format';

interface TeacherSwitcherProps {
  teacher: string;
  onOpen: () => void;
}

export function TeacherSwitcher({ teacher, onOpen }: TeacherSwitcherProps) {
  return (
    <button className="teacher-switcher" type="button" onClick={onOpen}>
      <span className="ts-avatar">{initials(teacher)}</span>
      <span className="ts-copy">
        <span className="ts-label">当前教师</span>
        <span className="ts-name" id="teacherSwitchName">{teacher}</span>
      </span>
      <span className="ts-action">切换 / 管理</span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  );
}
