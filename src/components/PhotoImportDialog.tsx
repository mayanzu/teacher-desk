import { useState } from 'react';
import { Camera, X } from 'lucide-react';
import { BUILDING_TIMES, DEFAULT_TIMES } from '../data/defaults';
import { useDialog } from '../hooks/useDialog';
import { clampWeeks, currentSemesterLabel, inferSemesterStart } from './PasteImportDialog';
import type { ImportPayload, ParsedSchedule } from '../types/schedule';

interface PhotoImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (payload: ImportPayload) => void;
}

export function PhotoImportDialog({ open, onClose, onSave }: PhotoImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSchedule | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [highAccuracy, setHighAccuracy] = useState(false);
  const [teacher, setTeacher] = useState('');
  const [department, setDepartment] = useState('');
  const [semesterLabel, setSemesterLabel] = useState(currentSemesterLabel);
  const [semesterStart, setSemesterStart] = useState(inferSemesterStart);
  const [totalWeeks, setTotalWeeks] = useState(20);

  function reset() {
    setFile(null);
    setParsed(null);
    setProgress(0);
    setMessage('');
    setError('');
  }

  function close() {
    reset();
    onClose();
  }

  const ref = useDialog(open, close);

  async function recognize(selected?: File) {
    const target = selected || file;
    if (!target) return;
    setFile(target);
    setError('');
    setParsed(null);
    try {
      const { recognizeScheduleImage } = await import('../services/ocr');
      const result = await recognizeScheduleImage(target, (value, text) => {
        setProgress(value);
        setMessage(text);
      }, { highAccuracy, totalWeeks });
      setParsed(result);
      setTeacher(result.teacher || '');
      setDepartment(result.department || '');
      setMessage('识别完成，请校对后保存');
      setProgress(100);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '识别失败');
      setMessage('');
      setProgress(0);
    }
  }

  function retry() {
    reset();
  }

  function save() {
    if (!parsed) return;
    if (!semesterStart) {
      setError('请填写第一周周一日期');
      return;
    }
    onSave({
      meta: { teacher: teacher || '我的课表', department, semesterLabel, semesterStart, totalWeeks: clampWeeks(totalWeeks) },
      times: DEFAULT_TIMES,
      timesByBuilding: BUILDING_TIMES,
      courses: parsed.courses.map((course) => ({ ...course, weeks: `1-${clampWeeks(totalWeeks)}` })),
    });
    reset();
    onClose();
  }

  return (
    <dialog ref={ref} className="kapp" aria-labelledby="photoTitle">
      <header className="kapp-head">
        <div><h2 id="photoTitle">照片导入课表</h2><p className="kapp-sub">上传照片 → 浏览器识别 → 校对并保存本机档案</p></div>
        <button className="icon-button" type="button" aria-label="关闭" onClick={close}><X /></button>
      </header>
      <div className="kapp-body">
        {!parsed && (
          <>
            <label className="kdrop">
              <input type="file" accept="image/*" hidden onChange={(event) => recognize(event.target.files?.[0])} />
              <Camera aria-hidden="true" />
              <strong>点击选择或拖入课表照片</strong>
              <span>要求表格完整、正对镜头、无反光；识别后请核对教师和学期信息。</span>
            </label>
            <label className="kopt"><input type="checkbox" checked={highAccuracy} onChange={(event) => setHighAccuracy(event.target.checked)} />高精度模式</label>
            {(progress > 0 || message) && <><div className="kprogress"><div className="kprogress-bar" style={{ width: `${progress}%` }} /></div><p className="kprogress-txt">{message}</p></>}
          </>
        )}
        {parsed && (
          <section className="kapp-step">
            <div className="kmeta">
              <label>教师姓名<input value={teacher} onChange={(event) => setTeacher(event.target.value)} /></label>
              <label>部门 / 学院<input value={department} onChange={(event) => setDepartment(event.target.value)} /></label>
              <label>学期标签<input value={semesterLabel} onChange={(event) => setSemesterLabel(event.target.value)} /></label>
              <label>第一周周一<input type="date" value={semesterStart} onChange={(event) => setSemesterStart(event.target.value)} /></label>
              <label>总教学周<input type="number" min={1} max={30} value={totalWeeks} onChange={(event) => setTotalWeeks(clampWeeks(event.target.value))} /></label>
            </div>
            <div className="paste-summary"><span>已识别</span><b>{parsed.courses.length}</b><span>个课次</span></div>
            <div className="paste-preview">
              {parsed.courses.map((course, index) => (
                <div className="paste-course" key={`${course.name}-${index}`}>
                  <span className="paste-course-slot">{course.slot} 节</span>
                  <div><div className="paste-course-name">{course.name}</div><div className="paste-course-meta">{[course.room, course.clazz].filter(Boolean).join(' · ')}</div></div>
                  <span className="paste-course-weeks">{course.weeks}周</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <p className="paste-error">{error}</p>
      </div>
      <footer className="kapp-foot">
        {parsed && <button className="kbtn ghost" type="button" onClick={retry}>重新选择照片</button>}
        <span className="kapp-foot-spacer" />
        {parsed && <button className="kbtn primary" type="button" onClick={save}>保存本机档案</button>}
      </footer>
    </dialog>
  );
}
