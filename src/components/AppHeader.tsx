import { Download, Settings2 } from 'lucide-react';
import { formatDate } from '../lib/date';

interface AppHeaderProps {
  date: Date;
  onImport: () => void;
  onOpenSettings: () => void;
}

export function AppHeader({ date, onImport, onOpenSettings }: AppHeaderProps) {
  return (
    <>
      <a className="skip-link" href="#main">跳到主内容</a>
      <nav className="product-nav" aria-label="页面导航">
        <div className="product-nav-inner">
          <a className="product-name" href="#top">学期课表</a>
          <div className="product-links"><a href="#schedule">查看课表</a><a href="https://github.com/mayanzu/teacher-timetable" target="_blank" rel="noopener noreferrer">GitHub</a></div>
          <div className="product-meta">
            <span className="ns-date">{formatDate(date)}</span>
            <button className="nav-cta nav-import" type="button" onClick={onImport}><Download aria-hidden="true" />导入课表</button>
            <button className="icon-button" type="button" aria-label="打开设置" title="设置与提醒" onClick={onOpenSettings}><Settings2 /></button>
          </div>
        </div>
      </nav>
    </>
  );
}

