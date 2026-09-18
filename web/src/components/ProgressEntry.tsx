import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, isUnauthorized } from '../api';
import type { ProgressClass, ProgressCopyOption, ProgressEntryRow, ProgressTotals } from '../types';
import { EmptyState, ErrorState, LoadingState } from './StateViews';

const HOUR_KEYS = ['lectureHours', 'labHours', 'practiceHours', 'otherHours'] as const;

function formatHours(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function sumHours(row: ProgressEntryRow): string {
  const total = HOUR_KEYS.reduce((sum, key) => sum + (Number(row[key]) || 0), 0);
  return total ? formatHours(total) : row.hours;
}

function applyTotals(list: ProgressEntryRow[], totals?: ProgressTotals): ProgressEntryRow[] {
  if (!totals) return list;
  const count = list.length || 1;
  const perRow: Record<(typeof HOUR_KEYS)[number], number> = {
    lectureHours: totals.lecture / count,
    labHours: totals.lab / count,
    practiceHours: totals.practice / count,
    otherHours: totals.other / count,
  };
  return list.map((row) => {
    const next = { ...row };
    HOUR_KEYS.forEach((key) => {
      if (!next[key] && perRow[key] > 0) next[key] = formatHours(perRow[key]);
    });
    next.hours = sumHours(next);
    return next;
  });
}

interface ProgressEntryProps {
  term: string;
  onUnauthorized: () => void;
}

export function ProgressEntry({ term, onUnauthorized }: ProgressEntryProps) {
  const [classes, setClasses] = useState<ProgressClass[]>([]);
  const [selected, setSelected] = useState<ProgressClass | null>(null);
  const [rows, setRows] = useState<ProgressEntryRow[]>([]);
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const [xqskzs, setXqskzs] = useState('');
  const [totals, setTotals] = useState<ProgressTotals | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyTerms, setCopyTerms] = useState<ProgressCopyOption[]>([]);
  const [copyClasses, setCopyClasses] = useState<ProgressCopyOption[]>([]);
  const [copyTerm, setCopyTerm] = useState('');
  const [copyClass, setCopyClass] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);

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
    setClasses([]);
    setSelected(null);
    setRows([]);
    setCopyOpen(false);
    setError('');
    setNotice('');
    api
      .progressClasses(term)
      .then((data) => {
        if (!cancelled) setClasses(data.items ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) handleError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [term, handleError]);

  const openClass = async (item: ProgressClass) => {
    setSelected(item);
    setRows([]);
    setCopyOpen(false);
    setCopyTerms([]);
    setCopyClasses([]);
    setCopyTerm('');
    setCopyClass('');
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const data = await api.progressEntry(term, item.params as unknown as Record<string, string>);
      setMeta(data.meta ?? {});
      setFormFields(data.formFields ?? {});
      setXqskzs(data.xqskzs ?? '');
      setTotals(data.totals);
      const list = applyTotals(data.rows ?? [], data.totals);
      setRows(list);
      if (!list.length) setNotice('该教学班暂无进度行，可直接提交生成。');
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (index: number, patch: Partial<ProgressEntryRow>) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        next.hours = sumHours(next);
        return next;
      }),
    );
  };

  const submit = async () => {
    if (!selected || !rows.length) return;
    if (!window.confirm(`确认提交「${selected.className}」的教学进度表到教务系统？`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await api.progressSave({ term, meta, rows, formFields, xqskzs, confirm: true });
      const message = (result.data as { message?: string } | null)?.message;
      const ok = (result.data as { status?: string } | null)?.status === '200';
      setNotice(`${ok ? '提交成功' : '提交失败'}：${message || `HTTP ${result.status}`}`);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const loadCopyClasses = async (xnxq: string) => {
    if (!selected) return;
    setCopyLoading(true);
    setError('');
    try {
      const data = await api.progressCopyClasses(term, selected.params.kcdm, selected.classCode, xnxq);
      const items = data.items ?? [];
      setCopyClasses(items);
      setCopyClass(items[0]?.code ?? '');
      if (!items.length) setNotice('该学期没有可复制的上课班级。');
    } catch (err) {
      handleError(err);
    } finally {
      setCopyLoading(false);
    }
  };

  const openCopy = async () => {
    if (!selected) return;
    setNotice('');
    setCopyOpen(true);
    setCopyLoading(true);
    try {
      const data = await api.progressCopyTerms(term, selected.params.kcdm, selected.classCode);
      const items = data.items ?? [];
      setCopyTerms(items);
      const current = `${term.split(',')[0]}${term.split(',')[1] ?? '0'}`;
      const preferred = items.find((item) => item.code === current) ?? items[0];
      setCopyTerm(preferred?.code ?? '');
      if (preferred) {
        await loadCopyClasses(preferred.code);
      } else {
        setCopyClasses([]);
        setCopyClass('');
      }
    } catch (err) {
      handleError(err);
    } finally {
      setCopyLoading(false);
    }
  };

  const applyCopy = async () => {
    if (!selected || !copyTerm || !copyClass) return;
    setCopyLoading(true);
    setError('');
    try {
      const data = await api.progressCopy(selected.params.kcdm, copyTerm, copyClass);
      const items = data.items ?? [];
      if (!items.length) {
        setNotice('该来源没有可复制的进度内容。');
        return;
      }
      setRows((prev) =>
        prev.map((row, index) => {
          const item = items[index];
          if (!item) return row;
          return {
            ...row,
            content: item.content || row.content,
            requirement: item.requirement || row.requirement,
            homework: item.homework || row.homework,
            remark: item.remark || row.remark,
            lectureHours: item.lectureHours || row.lectureHours,
            labHours: item.labHours || row.labHours,
            practiceHours: item.practiceHours || row.practiceHours,
            otherHours: item.otherHours || row.otherHours,
          };
        }),
      );
      setNotice(`已复制 ${items.length} 条进度内容，请核对后提交。`);
      setCopyOpen(false);
    } catch (err) {
      handleError(err);
    } finally {
      setCopyLoading(false);
    }
  };

  return (
    <section className="section" aria-labelledby="progressEntryTitle">
      <div className="section-heading">
        <div>
          <h2 id="progressEntryTitle">录入学期教学进度表</h2>
          <p className="sub">选择教学班 → 编辑每周授课内容 → 提交（可先复制往期/其他班级的进度表）</p>
        </div>
      </div>

      <div className="panel-card">
        <div className="entry-classes">
          {classes.map((item) => {
            const active = selected?.classCode === item.classCode;
            return (
              <button
                key={item.classCode}
                type="button"
                className={'entry-class' + (active ? ' is-active' : '')}
                onClick={() => void openClass(item)}
              >
                <strong>{item.courseRaw}</strong>
                <span>{item.className || '未命名班级'} · {item.hours || '—'} 学时 · {item.audit || '未审核'}</span>
              </button>
            );
          })}
          {classes.length === 0 && !error && <EmptyState title="暂无教学进度录入任务" message="本学期没有需要录入的教学班。" />}
        </div>

        {error && <ErrorState title="录入数据加载失败" message={error} onRetry={() => selected && void openClass(selected)} />}
        {loading && <LoadingState message="正在载入录入表单…" />}

        {!loading && selected && rows.length > 0 && (
          <div className="table-skeleton">
            <div className="entry-toolbar">
              <button className="kbtn ghost" type="button" disabled={copyLoading} onClick={() => void openCopy()}>
                复制教学进度表[按上课班级]
              </button>
              <span className="entry-toolbar-label">{selected.className}</span>
            </div>

            {copyOpen && (
              <div className="entry-copy-panel">
                <label className="entry-copy-term">
                  复制来源学期
                  <select
                    value={copyTerm}
                    disabled={copyLoading}
                    onChange={(event) => {
                      setCopyTerm(event.target.value);
                      void loadCopyClasses(event.target.value);
                    }}
                  >
                    {copyTerms.length === 0 && <option value="">（无）</option>}
                    {copyTerms.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="entry-copy-term">
                  复制来源班级
                  <select
                    value={copyClass}
                    disabled={copyLoading || copyClasses.length === 0}
                    onChange={(event) => setCopyClass(event.target.value)}
                  >
                    {copyClasses.length === 0 && <option value="">（无）</option>}
                    {copyClasses.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="kbtn primary"
                  type="button"
                  disabled={copyLoading || !copyTerm || !copyClass}
                  onClick={() => void applyCopy()}
                >
                  复制到本教学班
                </button>
                {copyLoading && <p className="entry-copy-empty">正在查询…</p>}
              </div>
            )}

            {totals && (
              <p className="entry-totals">
                课程学时：讲授 {totals.lecture} · 实践 {totals.practice} · 实验 {totals.lab} · 其它 {totals.other}
                （已按周次自动均分，无需填写）
              </p>
            )}

            <table className="data-table entry-table">
              <thead>
                <tr>
                  <th scope="col">周次</th>
                  <th scope="col">日期</th>
                  <th scope="col">节次</th>
                  <th scope="col">授课内容</th>
                  <th scope="col">备注</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.subId || index}>
                    <td>{row.week}</td>
                    <td>{row.date}</td>
                    <td>{row.period}</td>
                    <td>
                      <textarea
                        className="entry-input"
                        value={row.content}
                        rows={2}
                        onChange={(event) => updateRow(index, { content: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="entry-input"
                        value={row.remark}
                        onChange={(event) => updateRow(index, { remark: event.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="entry-actions">
              <button className="kbtn primary" type="button" disabled={saving} onClick={() => void submit()}>
                提交到教务系统
              </button>
            </div>
          </div>
        )}

        {notice && <p className="entry-notice">{notice}</p>}
      </div>
    </section>
  );
}
