import { Bell, Info, Layers, UsersRound, X } from 'lucide-react';
import type { Theme } from '../hooks/useTheme';
import { BUILDING_NAMES } from '../data/defaults';
import type { Course } from '../types/schedule';

interface SettingsDrawerProps {
  open: boolean;
  theme: Theme;
  motionPaused: boolean;
  reduceTransparency: boolean;
  reminderEnabled: boolean;
  courses: Course[];
  onClose: () => void;
  onToggleTheme: () => void;
  onToggleMotion: () => void;
  onToggleTransparency: () => void;
  onToggleReminder: () => void;
  onOpenTeacherManager: () => void;
}

export function SettingsDrawer({
  open,
  theme,
  motionPaused,
  reduceTransparency,
  reminderEnabled,
  courses,
  onClose,
  onToggleTheme,
  onToggleMotion,
  onToggleTransparency,
  onToggleReminder,
  onOpenTeacherManager,
}: SettingsDrawerProps) {
  const buildings = [...new Set(courses.map((course) => course.bld).filter(Boolean))].map((key) => BUILDING_NAMES[key!] || key).filter(Boolean);
  return (
    <>
      <div className={'scrim' + (open ? ' is-open' : '')} onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" aria-hidden={!open}>
        <div className="drawer-head">
          <div><h2 id="drawerTitle">设置</h2><p>外观 · 提醒 · 数据说明</p></div>
          <button className="icon-button" type="button" aria-label="关闭设置" onClick={onClose}><X /></button>
        </div>
        <div className="drawer-body">
          <section className="setting-group">
            <h3><UsersRound />教师课表管理</h3>
            <p className="field-note">在当前浏览器保存多位老师课表，随时切换。</p>
            <button className="button primary teacher-drawer-btn" type="button" onClick={onOpenTeacherManager}>打开教师管理</button>
          </section>
          <section className="setting-group">
            <h3><Layers />外观</h3>
            <div className="field"><span>深色背景<small>也可在顶部一键切换</small></span><button className="switch" type="button" role="switch" aria-checked={theme === 'dark'} onClick={onToggleTheme}><span /></button></div>
            <div className="field"><span>高对比模式<small>增强课程卡与文字边界</small></span><button className="switch" type="button" role="switch" aria-checked={reduceTransparency} onClick={onToggleTransparency}><span /></button></div>
            <div className="field"><span>暂停动态效果<small>减少动画与过渡</small></span><button className="switch" type="button" role="switch" aria-checked={motionPaused} onClick={onToggleMotion}><span /></button></div>
          </section>
          <section className="setting-group">
            <h3><Bell />课前提醒<span className="group-tag">{reminderEnabled ? '已开启' : '未开启'}</span></h3>
            <div className="field"><span>浏览器通知<small>每节课前 15 分钟提醒</small></span><button className="switch" type="button" role="switch" aria-checked={reminderEnabled} onClick={onToggleReminder}><span /></button></div>
            <p className="field-note">需要保持页面打开；浏览器后台可能限制计时器。</p>
          </section>
          <section className="setting-group">
            <h3><Info />数据</h3>
            <p className="field-note">当前课表涉及：{buildings.length ? buildings.join('、') : '暂无课程'}。教师档案只保存在本机浏览器，可导出 JSON 备份。</p>
          </section>
        </div>
      </aside>
    </>
  );
}
