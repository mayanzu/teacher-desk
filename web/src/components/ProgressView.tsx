import { useCallback, useEffect, useState } from 'react';
import { api, readApiCache, errorMessage, isUnauthorized } from '../api';
import { downloadFile, type DownloadPhase } from '../lib/download';
import { useRefreshRequest, useRefreshConsumer } from '../lib/useRefreshRequest';
import { ExportButton } from './ExportButton';
import type { ProgressSummaryData, ProgressSummaryFailure, ProgressSummaryGroup } from '../types';
import { EmptyState, ErrorState, LoadingState } from './StateViews';

interface ProgressViewProps {
  term: string;
  onUnauthorized: () => void;
}

export function ProgressView({ term, onUnauthorized }: ProgressViewProps) {
  const cached = readApiCache<ProgressSummaryData>('progress/summary', term);
  const [groups, setGroups] = useState<ProgressSummaryGroup[]>(cached?.items ?? []);
  const [failures, setFailures] = useState<ProgressSummaryFailure[]>(cached?.failures ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { token: refreshToken, requestRefresh } = useRefreshRequest(`progress:${term}`);
  const { forceFor } = useRefreshConsumer();
  const [downloadError, setDownloadError] = useState('');

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
    const force = forceFor(refreshToken);
    const snapshot = readApiCache<ProgressSummaryData>('progress/summary', term);
    setLoading(!snapshot);
    // 有缓存快照才覆盖；刷新失败时保留已显示的汇总（review R06）
    if (snapshot) {
      setGroups(snapshot.items ?? []);
      setFailures(snapshot.failures ?? []);
    }
    setError('');
    setWarning('');
    api
      .progressSummary(term, { refresh: force })
      .then((data) => {
        if (cancelled) return;
        setGroups(data.items ?? []);
        setFailures(data.failures ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          onUnauthorized();
          return;
        }
        // 已有汇总时保留内容并提示（review R06）
        if (snapshot || groups.length) setWarning(`刷新失败（${errorMessage(err)}），正在显示上一次汇总的数据。`);
        else handleError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, refreshToken, handleError, onUnauthorized, forceFor]);

  const download = async (url: string, name: string, onPhase?: (phase: DownloadPhase) => void) => {
    setDownloadError('');
    try {
      await downloadFile(url, name, { onPhase });
    } catch (err) {
      if (isUnauthorized(err)) {
        onUnauthorized();
        return;
      }
      setDownloadError(errorMessage(err));
    }
  };

  return (
    <section className="section" aria-labelledby="progressViewTitle">
      <div className="section-heading">
        <div>
          <h2 id="progressViewTitle">查看教学进度</h2>
          <p className="sub">按上课班级分组，点击展开每周授课内容</p>
        </div>
        <div className="week-nav">
          <ExportButton
            className="kbtn primary"
            label="导出 PDF"
            pendingLabel="正在生成 PDF…"
            onExport={(report) => download(api.progressPdfUrl(term, { scope: 'term' }), '学期教学进度表.pdf', report)}
          />
          <button className="kbtn ghost" type="button" onClick={requestRefresh}>
            刷新
          </button>
        </div>
      </div>

      <div className="panel-card">
        {warning && (
          <p className="notice-bar is-warn" role="status">
            <b>注意</b>
            {warning}
            <button className="kbtn ghost" type="button" onClick={requestRefresh}>
              重试
            </button>
          </p>
        )}
        {downloadError && (
          <p className="notice-bar is-warn" role="alert">
            {downloadError}
          </p>
        )}
        {loading && <LoadingState message="正在汇总教学进度…" />}
        {!loading && error && <ErrorState title="加载失败" message={error} onRetry={requestRefresh} />}
        {!loading && !error && failures.length > 0 && (
          <p className="notice-bar is-warn" role="status">
            <b>部分教学班未能读取</b>
            以下班级的进度汇总失败，其余结果仍然有效，可稍后刷新重试：
            {failures.map((item) => `${item.className}（${item.message}）`).join('、')}
          </p>
        )}
        {!loading && !error && groups.length === 0 && failures.length === 0 && (
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
                      <ExportButton
                        className="kbtn primary grade-view"
                        label="导出 PDF"
                        pendingLabel="正在生成 PDF…"
                        onExport={(report) =>
                          download(
                            api.progressPdfUrl(term, {
                              kcdm: group.kcdm,
                              bjdm: group.bjdm || group.skbjdm,
                              skbjdm: group.skbjdm,
                              bjmc: group.bjmc || group.className,
                              teacher: group.teacher || '',
                              kcmc: group.kcmc || group.courseName,
                              courseName: group.courseName,
                              className: group.className,
                            }),
                            `${[
                              group.teacher || '',
                              (group.courseName || '').replace(/^\[[^\]]*\]\s*/, ''),
                              group.className,
                            ].filter(Boolean).join('_')}.pdf`,
                            report,
                          )
                        }
                      />
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
