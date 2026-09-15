import { useRef } from 'react';
import { Copy, Download, FileUp, Plus, Trash2, UserRound, X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import { useTeacherProfiles } from '../context/TeacherProfilesContext';
import { useToast } from '../context/ToastContext';
import { initials, joinMeta } from '../lib/format';

interface TeacherManagerDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenPaste: () => void;
}

export function TeacherManagerDialog({ open, onClose, onOpenPaste }: TeacherManagerDialogProps) {
  const ref = useDialog(open, onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const { notify } = useToast();
  const {
    profiles,
    activeProfile,
    setActive,
    removeProfile,
    duplicateProfile,
    exportProfile,
    exportAll,
    importProfiles,
    systemUrl,
  } = useTeacherProfiles();

  async function copySystemUrl() {
    try {
      await navigator.clipboard.writeText(systemUrl);
      notify('系统地址已复制');
    } catch {
      notify('复制失败，请手动复制');
    }
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      const count = await importProfiles(file);
      notify(`已导入 ${count} 个教师档案`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '导入失败');
    }
  }

  return (
    <dialog ref={ref} className="kapp teacher-app" aria-labelledby="teacherTitle">
      <header className="kapp-head">
        <div>
          <h2 id="teacherTitle">教师课表管理</h2>
          <p className="kapp-sub">系统共用一份地址，每位老师的数据独立保存在自己的浏览器中</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X /></button>
      </header>
      <div className="kapp-body">
        <div className="teacher-current-card">
          <div className="tc-avatar">{initials(activeProfile.meta.teacher)}</div>
          <div>
            <h3>{activeProfile.meta.teacher}</h3>
            <p>{joinMeta([activeProfile.meta.department, activeProfile.meta.semesterLabel, activeProfile.courses.length + ' 个课次'])}</p>
          </div>
        </div>
        <div className="teacher-share-box">
          <p>分享系统时，只发送站点地址即可。其他老师打开后粘贴自己的课表，系统会自动保存在他们本机；不会生成个人分享链接。</p>
          <button className="kbtn" type="button" onClick={copySystemUrl}><Copy size={15} />复制系统地址</button>
        </div>
        <div className="teacher-list">
          {profiles.map((profile) => {
            const current = profile.id === activeProfile.id;
            return (
              <article className={'teacher-card' + (current ? ' is-active' : '')} key={profile.id}>
                <div className="tc-avatar">{initials(profile.meta.teacher)}</div>
                <div className="teacher-card-main">
                  <div className="teacher-card-name">{profile.meta.teacher}{current && <em>当前</em>}</div>
                  <div className="teacher-card-meta">{joinMeta([profile.meta.department, profile.meta.semesterLabel, profile.courses.length + ' 个课次'])}</div>
                </div>
                <div className="teacher-card-actions">
                  <button type="button" onClick={() => setActive(profile.id)}>{current ? '重新载入' : '切换'}</button>
                  <button type="button" onClick={() => exportProfile(profile.id)}><Download size={12} />导出</button>
                  <button type="button" onClick={() => duplicateProfile(profile.id)}><Plus size={12} />复制</button>
                  <button type="button" onClick={() => { if (window.confirm(`确定删除「${profile.meta.teacher}」的本机档案吗？`)) removeProfile(profile.id); }}><Trash2 size={12} />删除</button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <footer className="kapp-foot">
        <input ref={inputRef} type="file" accept=".json,application/json" hidden onChange={(event) => importFile(event.target.files?.[0])} />
        <button className="kbtn ghost" type="button" onClick={() => inputRef.current?.click()}><FileUp size={15} />导入 JSON</button>
        <button className="kbtn ghost" type="button" onClick={exportAll}><Download size={15} />导出全部</button>
        <span className="kapp-foot-spacer" />
        <button className="kbtn primary" type="button" onClick={onOpenPaste}><UserRound size={15} />粘贴新教师课表</button>
      </footer>
    </dialog>
  );
}
