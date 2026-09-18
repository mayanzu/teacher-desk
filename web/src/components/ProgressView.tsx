import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, isUnauthorized } from '../api';
import type { ProgressSummaryGroup } from '../types';
import { EmptyState, ErrorState, LoadingState } from './StateViews';

interface ProgressViewProps {
  term: string;
  onUnauthorized: () => void;
}

export function ProgressView({ term, onUnauthorized }: ProgressViewProps) {
  const [groups, setGroups] = useState<ProgressSummaryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const handleError = useCallback(
    (err: unknown) => {
      if (isUnauthorized(err)) {
        onUnauthorized();
        return;
      }
      setError(errorMessage(err));
    },
    [onUnauthorized],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .progressSummary(term)
      .then((data) => {
        if (!cancelled) setGroups(data.items ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) handleError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, attempt, handleError]);

  return (
    <section className="section" aria-labelledby="progressViewTitle">
      <div className="section-heading">
        <div>
          <h2 id="progressViewTitle">查看教学进度</h2>
          <p className="sub">按上课班级分组，点击展开每周授课内容</p>
        </div>
        <div className="week-nav">
          <a className="kbtn primary" href={api.progressPdfUrl(term, { scope: 'term' })}>
            导出 PDF
          </a>
          <button className="kbtn ghost" type="button" onClick={() => setAttempt((v) => v + 1)}>
            刷新
          </button>
        </div>
      </div>

      <div className="panel-card">
        {loading && <LoadingState message="正在汇总教学进度…" />}
        {!loading && error && <ErrorState title="加载失败" message={error} onRetry={() => setAttempt((v) => v + 1)} />}
        {!loading && !error && groups.length === 0 && (
          <EmptyState title="暂无教学进度" message="本学期还没有录入任何教学进度内容。" />
        )}

        {!loading && !error && groups.length > 0 && (
          <div className="pv-list">
            {groups.map((group) => {
              const span = group.maxWeek - group.minWeek + 1 || 1;
              const percent = Math.min(100, Math.round((group.count / span) * 100));
              const open = expanded === (group.skbjdm || group.className);
              return (
                <article className="pv-card" key={group.skbjdm || group.className}>
                  <header className="pv-head">
                    <div>
                      <h3>{group.courseName || (group.courses?.length ? group.courses.join(' / ') : group.className)}</h3>
                      <p className="pv-meta">
                        {group.className}
                        {group.minWeek ? ` · 第 ${group.minWeek}-${group.maxWeek} 周` : ''}
                        {group.count ? ` · 已录入 ${group.count} 次` : ''}
                      </p>
                    </div>
                    <div className="pv-actions">
                      <button className="kbtn ghost grade-view" type="button" onClick={() => setExpanded(open ? null : group.skbjdm || group.className)}>
                        {open ? '收起' : '展开'}
                      </button>
                      <a
                        className="kbtn primary grade-view"
                        href={api.progressPdfUrl(term, {
                          kcdm: group.kcdm,
                          bjdm: group.skbjdm,
                          kcmc: group.courseName,
                          courseName: group.courseName,
                          className: group.className,
                        })}
                      >
                        导出 PDF
                      </a>
                    </div>
                  </header>
                  <div className="pv-bar" role="presentation">
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  {open && (
                    <ol className="pv-weeks">
                      {group.rows.map((row, index) => (
                        <li key={`${row.week}-${index}`}>
                          <span className="pv-week">第{row.week}周</span>
                          <span className="pv-date">{row.date}</span>
                          <span className="pv-period">{row.period} 节</span>
                          <span className="pv-content">{row.content || '（未填写）'}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
