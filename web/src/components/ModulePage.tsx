import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, errorMessage, isUnauthorized, isUnimplemented } from '../api';
import { downloadFile } from '../lib/download';
import { Award, ClipboardList, TrendingUp } from './Icons';
import { EmptyState, ErrorState, LoadingState, PendingState } from './StateViews';
import { ProgressEntry } from './ProgressEntry';
import { ProgressView } from './ProgressView';
import { CourseGrades } from './CourseGrades';
import type { ModuleKey, RosterClass } from '../types';

interface ModuleColumn {
  label: string;
  key: string;
}

interface ModuleConfig {
  title: string;
  sub: string;
  icon: ReactNode;
  columns: ModuleColumn[];
  placeholder: string;
}

const MODULES: Record<ModuleKey, ModuleConfig> = {
  tasks: {
    title: '教学任务',
    sub: '本学期下达的教学任务、教学班与合班信息',
    icon: <ClipboardList aria-hidden="true" />,
    columns: [
      { label: '课程名称', key: 'courseName' },
      { label: '课程号', key: 'courseCode' },
      { label: '上课班级', key: 'classNames' },
      { label: '周次', key: 'weeks' },
      { label: '学时', key: 'hours' },
      { label: '人数', key: 'students' },
      { label: '考核', key: 'exam' },
    ],
    placeholder: '任务清单将在后端解析完成后自动呈现',
  },
  progress: {
    title: '教学进度',
    sub: '按周填写的教学内容与学时安排',
    icon: <TrendingUp aria-hidden="true" />,
    columns: [
      { label: '周次', key: 'week' },
      { label: '日期', key: 'date' },
      { label: '节次', key: 'period' },
      { label: '上课班级', key: 'classNames' },
      { label: '地点', key: 'room' },
      { label: '授课内容', key: 'content' },
    ],
    placeholder: '进度表将在后端解析完成后自动呈现',
  },
  grades: {
    title: '成绩',
    sub: '成绩登记册：环节成绩 / 毕业设计（论文）成绩 / 补考成绩',
    icon: <Award aria-hidden="true" />,
    columns: [
      { label: '成绩册', key: 'type' },
      { label: '名称', key: 'name' },
      { label: '环节类别/轮次', key: 'category' },
      { label: '学分', key: 'credit' },
      { label: '周数/学时', key: 'weeks' },
      { label: '行政班级', key: 'className' },
      { label: '组次', key: 'group' },
      { label: '人数', key: 'students' },
    ],
    placeholder: '成绩数据将在后端解析完成后自动呈现',
  },
};

interface FeaturePayload {
  items?: unknown[];
  note?: string;
}

interface GenericProps {
  module: 'tasks' | 'grades';
  term: string;
  onUnauthorized: () => void;
}

function GenericFeatureTable({ module, term, onUnauthorized }: GenericProps) {
  const config = MODULES[module];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [note, setNote] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [rosterClasses, setRosterClasses] = useState<RosterClass[]>([]);
  const [downloadError, setDownloadError] = useState('');

  const download = async (url: string, name: string) => {
    setDownloadError('');
    try {
      await downloadFile(url, name);
    } catch (err) {
      setDownloadError(errorMessage(err));
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPending(false);
    setPendingMessage('');
    setRows([]);
    setNote('');
    api
      .feature(module, term, { refresh: attempt > 0 })
      .then((payload) => {
        if (cancelled) return;
        const items = (payload as FeaturePayload | null)?.items;
        setRows(Array.isArray(items) ? (items as Record<string, unknown>[]) : []);
        setNote((payload as FeaturePayload | null)?.note ?? '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          onUnauthorized();
          return;
        }
        if (isUnimplemented(err)) {
          setPending(true);
          setPendingMessage(errorMessage(err));
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
  }, [module, term, attempt, onUnauthorized]);

  useEffect(() => {
    if (module !== 'tasks') return;
    let cancelled = false;
    setRosterClasses([]);
    api
      .rosterClasses(term, { refresh: attempt > 0 })
      .then((data) => {
        if (!cancelled) setRosterClasses(data.items ?? []);
      })
      .catch(() => {
        /* 点名册不可用时静默忽略 */
      });
    return () => {
      cancelled = true;
    };
  }, [module, term, attempt]);

  return (
    <section className="section" aria-labelledby={`${module}Title`}>
      <div className="section-heading">
        <div>
          <h2 id={`${module}Title`}>
            {config.icon}
            {config.title}
          </h2>
          <p className="sub">{config.sub}</p>
        </div>
        <div className="week-nav">
          <span className={'status-pill' + (pending ? ' is-warn' : ' is-ok')}>{pending ? '开发中' : loading ? '加载中' : '已连接'}</span>
          <button className="kbtn ghost" type="button" onClick={() => setAttempt((value) => value + 1)}>
            刷新
          </button>
        </div>
      </div>

      <div className="panel-card">
        {loading && <LoadingState message={`正在拉取${config.title}数据…`} />}

        {!loading && error && (
          <ErrorState title={`${config.title}加载失败`} message={error} onRetry={() => setAttempt((value) => value + 1)} />
        )}

        {!loading && !error && pending && (
          <>
            <PendingState
              title="该模块解析开发中"
              message={pendingMessage || `${config.title}的解析功能还在开发中。`}
              hint="页面骨架与样式已就绪，接口接通后即可直接展示真实数据。"
            />
            <div className="table-skeleton" aria-hidden="true">
              <table className={'data-table' + (module === 'tasks' ? ' task-table' : '')}>
                <thead>
                  <tr>
                    {config.columns.map((column) => (
                      <th key={column.key} scope="col">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map((row) => (
                    <tr key={row} className="is-placeholder">
                      {config.columns.map((column) => (
                        <td key={column.key}>{row === 0 ? '待接入' : '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="grid-hint">{config.placeholder}</p>
            </div>
          </>
        )}

        {!loading && !error && !pending && rows.length === 0 && (
          <EmptyState title={`暂无${config.title}数据`} message={note || '接口已就绪，但本次没有返回任何记录。'} />
        )}

        {!loading && !error && !pending && rows.length > 0 && (
          <div className="table-skeleton" role="region" aria-label={`${config.title}表格，可滚动查看`} tabIndex={0}>
            <table className={'data-table' + (module === 'tasks' ? ' task-table' : '')}>
              <thead>
                <tr>
                  {config.columns.map((column) => (
                    <th key={column.key} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {config.columns.map((column) => (
                      <td key={column.key}>{String(row[column.key] ?? '—') || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {module === 'tasks' && rosterClasses.length > 0 && (
          <div className="roster-block">
            <h3 className="roster-title">学生点名册</h3>
            {downloadError && (
              <p className="notice-bar is-warn" role="alert">
                {downloadError}
              </p>
            )}
            <div className="roster-grid">
              {rosterClasses.map((item) => (
                <div className="roster-item" key={item.skbjdm}>
                  <div>
                    <strong>{item.courseName}</strong>
                    <span>{item.className}</span>
                  </div>
                  <button
                    className="kbtn primary"
                    type="button"
                    onClick={() => void download(api.rosterReportUrl(term, item.kcdm, item.skbjdm), `点名册-${item.skbjdm}.xls`)}
                  >
                    导出点名册
                  </button>
                  <button
                    className="kbtn ghost"
                    type="button"
                    onClick={() => void download(api.rosterExportUrl(term, item.kcdm, item.skbjdm), `点名册-${item.skbjdm}.csv`)}
                  >
                    CSV
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

interface ModulePageProps {
  module: ModuleKey;
  term: string;
  onUnauthorized: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function ModulePage({ module, term, onUnauthorized, onDirtyChange }: ModulePageProps) {
  const [progressTab, setProgressTab] = useState<'entry' | 'view'>('entry');
  const [gradeTab, setGradeTab] = useState<'export' | 'entry'>('export');
  const [progressDirty, setProgressDirty] = useState(false);

  const switchProgressTab = (next: 'entry' | 'view') => {
    if (next === progressTab) return;
    if (next === 'view' && progressDirty && !window.confirm('录入的教学进度尚未提交，切换后将丢失，确定继续？')) return;
    if (next === 'view') {
      setProgressDirty(false);
      onDirtyChange?.(false);
    }
    setProgressTab(next);
  };

  if (module === 'progress') {
    return (
      <div className="subpage">
        <div className="subtabs">
          <button
            type="button"
            className={'subtab' + (progressTab === 'entry' ? ' is-active' : '')}
            aria-pressed={progressTab === 'entry'}
            onClick={() => switchProgressTab('entry')}
          >
            录入教学进度
          </button>
          <button
            type="button"
            className={'subtab' + (progressTab === 'view' ? ' is-active' : '')}
            aria-pressed={progressTab === 'view'}
            onClick={() => switchProgressTab('view')}
          >
            查看教学进度
          </button>
        </div>
        {progressTab === 'entry' ? (
          <ProgressEntry term={term} onUnauthorized={onUnauthorized} onDirtyChange={(dirty) => { setProgressDirty(dirty); onDirtyChange?.(dirty); }} />
        ) : (
          <ProgressView term={term} onUnauthorized={onUnauthorized} />
        )}
      </div>
    );
  }

  if (module === 'grades') {
    return (
      <div className="subpage">
        <div className="subtabs">
          <button
            type="button"
            className={'subtab' + (gradeTab === 'export' ? ' is-active' : '')}
            aria-pressed={gradeTab === 'export'}
            onClick={() => setGradeTab('export')}
          >
            成绩导出
          </button>
          <button
            type="button"
            className={'subtab' + (gradeTab === 'entry' ? ' is-active' : '')}
            aria-pressed={gradeTab === 'entry'}
            onClick={() => setGradeTab('entry')}
          >
            成绩录入
          </button>
        </div>
        {gradeTab === 'export' ? (
          <CourseGrades term={term} onUnauthorized={onUnauthorized} />
        ) : (
          <div className="panel-card">
            <PendingState
              title="成绩录入开发中"
              message="该功能正在开发中，敬请期待。"
              hint="后续将支持按课程/行政班级录入成绩。"
            />
          </div>
        )}
      </div>
    );
  }

  return <GenericFeatureTable module={module} term={term} onUnauthorized={onUnauthorized} />;
}
