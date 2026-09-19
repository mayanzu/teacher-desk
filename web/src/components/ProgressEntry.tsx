import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, isUnauthorized } from '../api';
import type { ProgressClass, ProgressCopyOption, ProgressEntryRow, ProgressTotals } from '../types';
import { EmptyState, ErrorState, LoadingState } from './StateViews';

import { applyTotals, sumHours, validateHours } from '../lib/progress';

interface ProgressEntryProps {
  term: string;
  onUnauthorized: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function ProgressEntry({ term, onUnauthorized, onDirtyChange }: ProgressEntryProps) {
  const requestId = useRef(0);
  const copyId = useRef(0);
  const loadedId = useRef(-1);
  const [listLoading, setListLoading] = useState(true);
  const [listAttempt, setListAttempt] = useState(0);
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
  const [noticeKind, setNoticeKind] = useState<'info' | 'success' | 'error'>('info');
  const [dirty, setDirty] = useState(false);
  const [copyTerms, setCopyTerms] = useState<ProgressCopyOption[]>([]);
  const [copyClasses, setCopyClasses] = useState<ProgressCopyOption[]>([]);
  const [copyTerm, setCopyTerm] = useState('');
  const [copyClass, setCopyClass] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);

  const showNotice = useCallback((message: string, kind: 'info' | 'success' | 'error' = 'info') => {
    setNotice(message);
    setNoticeKind(kind);
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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
    setListLoading(true);
    setClasses([]);
    setSelected(null);
    setRows([]);
    setCopyOpen(false);
    setError('');
    showNotice('');
    api
      .progressClasses(term, { refresh: listAttempt > 0 })
      .then((data) => {
        if (!cancelled) setClasses(data.items ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) handleError(err);
      })
      .finally(() => { if (!cancelled) setListLoading(false); });
    return () => {
      requestId.current += 1;
      copyId.current += 1;
      cancelled = true;
    };
  }, [term, handleError, listAttempt, showNotice]);

  const openClass = async (item: ProgressClass) => {
    if (dirty && !window.confirm('当前教学班有未提交的修改，切换后将会丢失，确定继续？')) return;
    const token = ++requestId.current;
    copyId.current += 1;
    loadedId.current = -1;
    setMeta({});
    setCopyLoading(false);
    setDirty(false);
    setSelected(item);
    setRows([]);
    setCopyOpen(false);
    setCopyTerms([]);
    setCopyClasses([]);
    setCopyTerm('');
    setCopyClass('');
    setError('');
    showNotice('');
    setLoading(true);
    try {
      const data = await api.progressEntry(term, item.params as unknown as Record<string, string>);
      if (token !== requestId.current) return;
      loadedId.current = token;
      setMeta(data.meta ?? {});
      setFormFields(data.formFields ?? {});
      setXqskzs(data.xqskzs ?? '');
      setTotals(data.totals);
      const list = applyTotals(data.rows ?? [], data.totals);
      setRows(list);
      if (!list.length) showNotice('该教学班暂无可编辑进度行，请先在教务系统检查课程安排。');
    } catch (err) {
      if (token === requestId.current) handleError(err);
    } finally {
      if (token === requestId.current) setLoading(false);
    }
  };

  const updateRow = (index: number, patch: Partial<ProgressEntryRow>) => {
    setDirty(true);
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
    if (!selected || !rows.length || saving || loading || copyLoading || loadedId.current !== requestId.current) return;
    const invalidHours = validateHours(rows, totals);
    if (invalidHours) { setError(invalidHours); return; }
    const token = requestId.current;
    if (!window.confirm(`确认提交「${selected.className}」的教学进度表到教务系统？`)) return;
    setSaving(true);
    setError('');
    showNotice('');
    try {
      const result = await api.progressSave({ term, meta, rows, formFields, xqskzs, confirm: true });
      if (token !== requestId.current) return;
      const message = (result.data as { message?: string } | null)?.message;
      const ok = (result.data as { status?: string } | null)?.status?.toString() === '200';
      if (ok) {
        setDirty(false);
        showNotice(`提交成功：${message || '教学进度已保存'}`, 'success');
      } else if (result.data) {
        showNotice(`提交失败：${message || `HTTP ${result.status}`}`, 'error');
      } else {
        showNotice('教务响应异常，请刷新页面核对是否已保存后再重试。', 'error');
      }
    } catch (err) {
      if (token === requestId.current) handleError(err);
    } finally {
      if (token === requestId.current) setSaving(false);
    }
  };

  const loadCopyClasses = async (xnxq: string) => {
    if (!selected) return;
    const token = requestId.current;
    const copyToken = ++copyId.current;
    const current = () => token === requestId.current && copyToken === copyId.current;
    setCopyLoading(true);
    setError('');
    try {
      const data = await api.progressCopyClasses(term, selected.params.kcdm, selected.classCode, xnxq);
      if (!current()) return;
      const items = data.items ?? [];
      setCopyClasses(items);
      setCopyClass(items[0]?.code ?? '');
      if (!items.length) showNotice('该学期没有可复制的上课班级。');
    } catch (err) {
      if (current()) handleError(err);
    } finally {
      if (current()) setCopyLoading(false);
    }
  };

  const openCopy = async () => {
    if (!selected) return;
    showNotice('');
    setCopyOpen(true);
    const token = requestId.current;
    const copyToken = ++copyId.current;
    const current = () => token === requestId.current && copyToken === copyId.current;
    setCopyLoading(true);
    try {
      const data = await api.progressCopyTerms(term, selected.params.kcdm, selected.classCode);
      if (!current()) return;
      const items = data.items ?? [];
      setCopyTerms(items);
      const currentTerm = `${term.split(',')[0]}${term.split(',')[1] ?? '0'}`;
      const preferred = items.find((item) => item.code === currentTerm) ?? items[0];
      setCopyTerm(preferred?.code ?? '');
      if (preferred) {
        await loadCopyClasses(preferred.code);
      } else {
        setCopyClasses([]);
        setCopyClass('');
      }
    } catch (err) {
      if (current()) handleError(err);
    } finally {
      if (current()) setCopyLoading(false);
    }
  };

  const applyCopy = async () => {
    if (!selected || !copyTerm || !copyClass) return;
    const token = requestId.current;
    const copyToken = ++copyId.current;
    const current = () => token === requestId.current && copyToken === copyId.current;
    setCopyLoading(true);
    setError('');
    try {
      const data = await api.progressCopy(selected.params.kcdm, copyTerm, copyClass);
      if (!current()) return;
      const items = data.items ?? [];
      if (!items.length) {
        showNotice('该来源没有可复制的进度内容。');
        return;
      }
      setRows((prev) =>
        prev.map((row, index) => {
          const item = items[index];
          if (!item) return row;
          const copied = {
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
          return { ...copied, hours: sumHours(copied) };
        }),
      );
      setDirty(true);
      showNotice(`已复制 ${items.length} 条进度内容，请核对后提交。`, 'success');
      setCopyOpen(false);
    } catch (err) {
      if (current()) handleError(err);
    } finally {
      if (current()) setCopyLoading(false);
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
                disabled={saving}
                onClick={() => void openClass(item)}
              >
                <strong>{item.courseRaw}</strong>
                <span>{item.className || '未命名班级'} · {item.hours || '—'} 学时 · {item.audit || '未审核'}</span>
              </button>
            );
          })}
          {listLoading && <LoadingState message="正在加载教学班…" />}
          {classes.length === 0 && !listLoading && !error && <EmptyState title="暂无教学进度录入任务" message="本学期没有需要录入的教学班。" />}
        </div>

        {error && <ErrorState title="录入数据加载失败" message={error} onRetry={() => selected ? void openClass(selected) : setListAttempt((v) => v + 1)} />}
        {loading && <LoadingState message="正在载入录入表单…" />}

        {!loading && selected && rows.length > 0 && (
          <div>
            <div className="entry-toolbar">
              <button className="kbtn ghost" type="button" disabled={copyLoading || saving} onClick={() => void openCopy()}>
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
                    disabled={copyLoading || saving}
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
                课程学时：讲授 {totals.lecture} · 实践 {totals.practice} · 实验 {totals.lab} · 劳动 {totals.labor} · 其它 {totals.other}
                （保留已有学时，仅将剩余学时分配至空行）
              </p>
            )}

            <div className="table-skeleton" role="region" aria-label="教学进度录入表，可横向滚动" tabIndex={0}>
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
                          disabled={saving || copyLoading}
                          aria-label={`第 ${row.week} 周授课内容`}
                          value={row.content}
                          rows={2}
                          onChange={(event) => updateRow(index, { content: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="entry-input"
                          disabled={saving || copyLoading}
                          aria-label={`第 ${row.week} 周备注`}
                          value={row.remark}
                          onChange={(event) => updateRow(index, { remark: event.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="entry-actions">
              <button className="kbtn primary" type="button" disabled={saving || copyLoading || loading} onClick={() => void submit()}>
                提交到教务系统
              </button>
            </div>
          </div>
        )}

        {notice && (
          <p className={`entry-notice is-${noticeKind}`} role={noticeKind === 'error' ? 'alert' : 'status'}>
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
