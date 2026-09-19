import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, isUnauthorized } from '../api';
import { downloadFile } from '../lib/download';
import { EmptyState, ErrorState, LoadingState } from './StateViews';
import type { CourseGradeClass, CourseGradesData } from '../types';

interface CourseGradesProps {
  term: string;
  onUnauthorized: () => void;
}

interface CourseGroup {
  key: string;
  courseCode: string;
  courseName: string;
  credit: string;
  hours: string;
  exam: string;
  classes: CourseGradeClass[];
}

export function CourseGrades({ term, onUnauthorized }: CourseGradesProps) {
  const [classes, setClasses] = useState<CourseGradeClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [report, setReport] = useState<CourseGradesData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setClasses([]);
    setExpanded(null);
    setReport(null);
    api
      .courseGradeClasses(term, { refresh: attempt > 0 })
      .then((data) => {
        if (cancelled) return;
        setClasses(data.items ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          onUnauthorized();
          return;
        }
        setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, attempt, onUnauthorized]);

  // 按课程名前的课程代码分组（同一门课的多个行政班级归到一组）
  const groups = useMemo<CourseGroup[]>(() => {
    const map = new Map<string, CourseGroup>();
    for (const item of classes) {
      const key = item.courseCode || item.courseName;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          courseCode: item.courseCode,
          courseName: item.courseName,
          credit: item.credit,
          hours: item.hours,
          exam: item.exam,
          classes: [],
        };
        map.set(key, group);
      }
      group.classes.push(item);
    }
    return [...map.values()];
  }, [classes]);

  const expandedItem = expanded
    ? classes.find((item) => `${item.kcdm}|${item.bjdm}` === expanded) ?? null
    : null;

  // 展开时按需拉取原始成绩（固定「原始成绩 + 单栏」）
  useEffect(() => {
    if (!expandedItem) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setReportLoading(true);
    setReportError('');
    setReport(null);
    api
      .courseGrades(
        term,
        {
          kcdm: expandedItem.kcdm,
          bjdm: expandedItem.bjdm,
          bjmc: expandedItem.className,
          flag: '1',
          dyfs: 'dl',
          qmzhC: 'zhC',
        },
        { refresh: attempt > 0 },
      )
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          onUnauthorized();
          return;
        }
        setReportError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, expandedItem, attempt, onUnauthorized]);

  const pdfUrl = (item: CourseGradeClass) =>
    api.courseGradesPdfUrl(term, {
      kcdm: item.kcdm,
      bjdm: item.bjdm,
      bjmc: item.className,
      flag: '1',
      dyfs: 'dl',
      qmzhC: 'zhC',
      courseName: item.courseName,
      className: item.className,
      fileName: `${item.courseName}_${item.className}_原始成绩`,
      title: '分课程按行政班级查看成绩',
    });

  if (loading) {
    return (
      <div className="panel-card">
        <LoadingState message="正在拉取课程成绩列表…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-card">
        <ErrorState title="课程成绩加载失败" message={error} onRetry={() => setAttempt((value) => value + 1)} />
      </div>
    );
  }

  const download = async (url: string, name: string) => {
    setDownloadError('');
    try {
      await downloadFile(url, name);
    } catch (err) {
      if (isUnauthorized(err)) {
        onUnauthorized();
        return;
      }
      setDownloadError(errorMessage(err));
    }
  };

  return (
    <div className="panel-card">
      {downloadError && (
        <p className="notice-bar is-warn" role="alert">
          {downloadError}
        </p>
      )}
      {groups.length === 0 ? (
        <EmptyState title="本学期没有课程成绩" message="教务系统未返回本学期可查看成绩的课程。" />
      ) : (
        <div className="pv-list">
          {groups.map((group) => (
            <article className="pv-card" key={group.key}>
              <header className="pv-head">
                <div>
                  <h3>
                    {group.courseCode ? `[${group.courseCode}]` : ''}
                    {group.courseName}
                  </h3>
                  <p className="pv-meta">
                    {group.credit ? `学分 ${group.credit}` : ''}
                    {group.hours ? ` · 总学时 ${group.hours}` : ''}
                    {group.exam ? ` · 考核 ${group.exam}` : ''}
                    {` · ${group.classes.length} 个行政班级`}
                  </p>
                </div>
              </header>

              <div className="cg-classes">
                {group.classes.map((item) => {
                  const key = `${item.kcdm}|${item.bjdm}`;
                  const open = expanded === key;
                  return (
                    <div className={'cg-class' + (open ? ' is-open' : '')} key={key}>
                      <div className="cg-class-row">
                        <div className="cg-class-info">
                          <strong>{item.className || '未命名班级'}</strong>
                          <span>
                            {item.students ? `${item.students} 人` : ''}
                            {item.hours ? `${item.students ? ' · ' : ''}总学时 ${item.hours}` : ''}
                          </span>
                        </div>
                        <div className="cg-class-actions">
                          <button
                            className="kbtn ghost grade-view"
                            type="button"
                            onClick={() => setExpanded(open ? null : key)}
                          >
                            {open ? '收起' : '查看原始成绩'}
                          </button>
                          <button
                            className="kbtn primary grade-view"
                            type="button"
                            onClick={() => void download(pdfUrl(item), `${item.courseName}_${item.className}_原始成绩.pdf`)}
                          >
                            导出 PDF
                          </button>
                        </div>
                      </div>

                      {open && (
                        <div className="cg-grade">
                          {reportLoading && <LoadingState message="正在拉取成绩明细…" />}
                          {!reportLoading && reportError && (
                            <ErrorState title="成绩明细加载失败" message={reportError} />
                          )}
                          {!reportLoading && !reportError && report && (
                            <>
                              {report.rows.length === 0 ? (
                                <EmptyState title="暂无成绩记录" message="该课程/班级在此学期还没有成绩数据。" />
                              ) : (
                                <div className="grade-table-wrap" role="region" aria-label="成绩明细表，可滚动查看" tabIndex={0}>
                                  <table className="data-table grade-table">
                                    <thead>
                                      {report.header.map((row, rowIndex) => (
                                        <tr key={rowIndex}>
                                          {row.map((cell, cellIndex) => (
                                            <th key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan} scope="col">
                                              {cell.text}
                                            </th>
                                          ))}
                                        </tr>
                                      ))}
                                    </thead>
                                    <tbody>
                                      {report.rows.map((row, rowIndex) => (
                                        <tr key={rowIndex}>
                                          {row.map((cell, cellIndex) => (
                                            <td key={cellIndex}>{cell || '—'}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
