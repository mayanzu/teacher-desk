import { Camera, Moon, Pause, Play, Settings2, Sun } from 'lucide-react';
import { formatClock, formatDate } from '../lib/date';
import type { Theme } from '../hooks/useTheme';

interface AppHeaderProps {
  date: Date;
  week: number;
  theme: Theme;
  motionPaused: boolean;
  onToggleTheme: () => void;
  onToggleMotion: () => void;
  onPhotoImport: () => void;
  onOpenSettings: () => void;
  onToday: () => void;
}

export function AppHeader({
  date,
  week,
  theme,
  motionPaused,
  onToggleTheme,
  onToggleMotion,
  onPhotoImport,
  onOpenSettings,
  onToday,
}: AppHeaderProps) {
  return (
    <nav className="product-nav" aria-label="页面导航">
      <div className="product-nav-inner">
        <a className="product-name" href="#top">学期课表</a>
        <div className="product-links">
          <a href="#schedule">本周课表</a>
          <a href="#data">数据说明</a>
        </div>
        <div className="product-meta">
          <span className="ns-date">{formatDate(date)}</span>
          <span className="ns-clock">{formatClock(date)}</span>
          <span className="nav-pill">第 {week} 教学周</span>
          <button className="nav-cta" type="button" onClick={onToday}>回到本周</button>
          <button className="icon-button" type="button" aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <button className="icon-button" id="motionToggle" type="button" aria-label={motionPaused ? '恢复动态效果' : '暂停动态效果'} onClick={onToggleMotion}>
            {motionPaused ? <Play /> : <Pause />}
          </button>
          <button className="icon-button" type="button" aria-label="用照片导入课表" onClick={onPhotoImport}>
            <Camera />
          </button>
          <button className="icon-button" type="button" aria-label="打开设置" onClick={onOpenSettings}>
            <Settings2 />
          </button>
        </div>
      </div>
    </nav>
  );
}
