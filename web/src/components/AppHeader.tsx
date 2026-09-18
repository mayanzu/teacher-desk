import { GraduationCap, LogOut } from './Icons';
import type { PageKey, Term } from '../types';

export const PAGES: { key: PageKey; label: string }[] = [
  { key: 'schedule', label: '周课表' },
  { key: 'tasks', label: '教学任务' },
  { key: 'progress', label: '教学进度' },
  { key: 'grades', label: '成绩' },
];

interface AppHeaderProps {
  username: string;
  terms: Term[];
  term: string;
  onTermChange: (value: string) => void;
  page: PageKey;
  onPageChange: (page: PageKey) => void;
  onLogout: () => void;
  loggingOut: boolean;
}

export function AppHeader({ username, terms, term, onTermChange, page, onPageChange, onLogout, loggingOut }: AppHeaderProps) {
  return (
    <>
      <a className="skip-link" href="#main">
        跳到主内容
      </a>
      <nav className="product-nav" aria-label="页面导航">
        <div className="product-nav-inner">
          <span className="product-name">
            <GraduationCap aria-hidden="true" />
            教师工作台
          </span>
          <div className="product-links" role="group" aria-label="功能切换">
            {PAGES.map((item) => (
              <button
                key={item.key}
                className={'product-link' + (page === item.key ? ' active' : '')}
                type="button"
                aria-current={page === item.key ? 'page' : undefined}
                onClick={() => onPageChange(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="product-meta">
            <label className="term-select">
              <span className="visually-hidden">选择学期</span>
              <select value={term} onChange={(event) => onTermChange(event.target.value)} disabled={terms.length === 0}>
                {terms.length === 0 && <option value="">暂无学期数据</option>}
                {terms.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="ns-user" title={username || '教师'}>
              {username || '教师'}
            </span>
            <button className="icon-button" type="button" aria-label="退出登录" title="退出登录" disabled={loggingOut} onClick={onLogout}>
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}
