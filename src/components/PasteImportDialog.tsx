import { useState } from 'react';
import { X } from 'lucide-react';
import { DAY_NAMES, BUILDING_TIMES, DEFAULT_TIMES } from '../data/defaults';
import { SAMPLE_TABLE } from '../data/sample';
import { useDialog } from '../hooks/useDialog';
import { parseScheduleText } from '../lib/parser';
import type { ImportPayload, ParsedSchedule } from '../types/schedule';

interface PasteImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (payload: ImportPayload) => void;
}

export function inferSemesterStart() {
  const now = new Date();
  const base = now.getMonth() >= 7 ? new Date(now.getFullYear(), 7, 31) : new Date(now.getFullYear(), 1, 24);
  const day = (base.getDay() + 6) % 7;
  base.setDate(base.getDate() - day);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

export function currentSemesterLabel() {
  const year = new Date().getFullYear();
  return new Date().getMonth() >= 7 ? `${year}–${year + 1} 第一学期` : `${year - 1}–${year} 第二学期`;
}

export function clampWeeks(value: unknown, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(30, Math.max(1, Math.round(parsed)));
}

export function PasteImportDialog({ open, onClose, onSave }: PasteImportDialogProps) {
  const ref = useDialog(open, onClose);
  const [step, setStep] = useState(1);
  const [source, setSource] = useState('');
  const [parsed, setParsed] = useState<ParsedSchedule | null>(null);
  const [error, setError] = useState('');
  const [teacher, setTeacher] = useState('');
  const [department, setDepartment] = useState('');
  const [semesterLabel, setSemesterLabel] = useState(currentSemesterLabel);
  const [semesterStart, setSemesterStart] = useState(inferSemesterStart);
  const [totalWeeks, setTotalWeeks] = useState(20);
  const [savedTeacher, setSavedTeacher] = useState('');

  function applySource(value: string) {
    setError('');
    if (!value.trim()) {
      setError('请先粘贴教务处导出的课表表格。');
      return;
    }
    try {
      const result = parseScheduleText(value);
      const withIds = { ...result, courses: result.courses.map((course, index) => ({ ...course, id: `import-${Date.now()}-${index}` })) };
      setSource(value.includes('<table') ? '已读取剪贴板 HTML 表格结构' : value);
      setParsed(withIds);
      setTeacher(result.teacher || '');
      setDepartment(result.department || '');
      setTotalWeeks(Math.max(20, result.maxWeek || 0));
      setStep(2);
    } catch (cause) {
      setParsed(null);
      setError(cause instanceof Error ? cause.message : '解析失败');
    }
  }

  function parse() {
    applySource(source);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = event.clipboardData.getData('text/html');
    if (html && /<table[\s>]/i.test(html)) {
      event.preventDefault();
      applySource(html);
    }
  }

  async function readClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const htmlType = item.types.find((type) => type === 'text/html');
        if (htmlType) return applySource(await (await item.getType(htmlType)).text());
        const textType = item.types.find((type) => type === 'text/plain');
        if (textType) return applySource(await (await item.getType(textType)).text());
      }
      setError('剪贴板中没有可读取的课表内容');
    } catch {
      setError('浏览器未授权读取剪贴板，请直接使用 Ctrl+V 粘贴');
    }
  }

  function updateCourseDay(id: string | undefined, day: number) {
    if (!id || !parsed) return;
    setParsed({ ...parsed, courses: parsed.courses.map((course) => course.id === id ? { ...course, day } : course) });
  }

  function save() {
    if (!parsed || !parsed.courses.length) return;
    if (!semesterStart) {
      setError('请填写第一周周一日期');
      return;
    }
    const payload: ImportPayload = {
      meta: {
        teacher: teacher.trim() || '我的课表',
        department: department.trim(),
        semesterLabel: semesterLabel.trim() || currentSemesterLabel(),
        semesterStart,
        totalWeeks,
      },
      times: DEFAULT_TIMES,
      timesByBuilding: BUILDING_TIMES,
      courses: parsed.courses,
    };
    onSave(payload);
    setSavedTeacher(payload.meta.teacher || '我的课表');
    setStep(3);
  }

  return (
    <dialog ref={ref} className="kapp paste-app" aria-labelledby="pasteTitle">
      <header className="kapp-head">
        <div>
          <h2 id="pasteTitle">粘贴教务处课表</h2>
          <p className="kapp-sub">{step === 1 ? '粘贴表格 → 自动识别 → 保存本机教师档案' : step === 2 ? '校对导入结果' : '保存完成'}</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X /></button>
      </header>
      <div className="kapp-body">
        {step === 1 && (
          <section className="kapp-step">
            <div className="paste-guideline">
              <span>① 从教务处网页或 Excel 复制表格</span>
              <span>② 保持「星期 + 节次 + 课程」结构</span>
              <span>③ 直接粘贴到下方，无需删表头</span>
            </div>
            <textarea
              className="paste-source"
              aria-label="粘贴教务处课表"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              onPaste={handlePaste}
              placeholder="在这里粘贴教务处课表，支持 Markdown 表格和 Excel 制表符格式。"
            />
            <p className="paste-error">{error}</p>
            <div className="paste-actions">
              <button className="kbtn ghost" type="button" onClick={() => setSource(SAMPLE_TABLE)}>填入示例</button>
              <button className="kbtn ghost" type="button" onClick={readClipboard}>读取剪贴板</button>
              <button className="kbtn ghost" type="button" onClick={() => setSource('')}>清空</button>
              <span className="spacer" />
              <button className="kbtn primary" type="button" onClick={parse}>解析课表</button>
            </div>
          </section>
        )}
        {step === 2 && parsed && (
          <section className="kapp-step">
            <div className="kmeta paste-meta">
              <label>教师姓名<input value={teacher} onChange={(event) => setTeacher(event.target.value)} placeholder="如：张老师" /></label>
              <label>部门 / 学院<input value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="如：信息工程学院" /></label>
              <label>学期标签<input value={semesterLabel} onChange={(event) => setSemesterLabel(event.target.value)} /></label>
              <label>第一周周一<input type="date" value={semesterStart} onChange={(event) => setSemesterStart(event.target.value)} /></label>
              <label>总教学周<input type="number" min={1} max={30} value={totalWeeks} onChange={(event) => setTotalWeeks(clampWeeks(event.target.value))} /></label>
            </div>
            <div className="paste-summary"><span>已识别</span><b>{parsed.courses.length}</b><span>个课次 · {new Set(parsed.courses.map((course) => course.day)).size} 个上课日</span></div>
            {parsed.warnings.length > 0 && <div className="paste-warnings">以下内容需要留意：<br />{parsed.warnings.slice(0, 8).map((warning) => <span key={warning}>{warning}<br /></span>)}</div>}
            <div className="paste-preview">
              {parsed.courses.map((course, index) => (
                <div className="paste-course" key={course.id || `${course.name}-${index}`}>
                  <label className="paste-day-select">
                    <span>星期</span>
                    <select value={course.day} onChange={(event) => updateCourseDay(course.id, Number(event.target.value))}>
                      {[1, 2, 3, 4, 5, 6, 7].map((day) => <option value={day} key={day}>{DAY_NAMES[day]}</option>)}
                    </select>
                  </label>
                  <span className="paste-course-slot">{course.slot} 节</span>
                  <div>
                    <div className="paste-course-name">{course.name}</div>
                    <div className="paste-course-meta">{[course.room, course.clazz, course.count ? `${course.count} 人` : ''].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="paste-course-weeks">{course.weeks}周{course.parity === 'odd' ? ' · 单周' : course.parity === 'even' ? ' · 双周' : ''}</span>
                </div>
              ))}
            </div>
            <p className="paste-error">{error}</p>
          </section>
        )}
        {step === 3 && (
          <section className="kapp-step">
            <div className="paste-summary"><span>已保存教师</span><b>{savedTeacher}</b><span>{parsed?.courses.length || 0} 个课次 · 本机档案</span></div>
            <p className="kapp-hint">课表已保存在当前浏览器。以后无需重新粘贴，可在教师管理中直接切换。</p>
          </section>
        )}
      </div>
      <footer className="kapp-foot">
        <button className="kbtn ghost" type="button" hidden={step === 1} onClick={() => setStep(step === 3 ? 2 : 1)}>上一步</button>
        <span className="kapp-foot-spacer" />
        {step === 2 && <button className="kbtn primary" type="button" onClick={save}>保存并打开</button>}
        {step === 3 && <button className="kbtn primary" type="button" onClick={onClose}>完成</button>}
      </footer>
    </dialog>
  );
}
