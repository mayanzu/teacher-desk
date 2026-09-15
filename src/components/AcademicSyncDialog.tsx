import { CheckCircle2, ExternalLink, QrCode, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import type { AcademicSyncStatus } from '../hooks/useAcademicSync';

interface AcademicSyncDialogProps {
  open: boolean;
  status: AcademicSyncStatus;
  message: string;
  onStart: () => void;
  onClose: () => void;
}

export function AcademicSyncDialog({ open, status, message, onStart, onClose }: AcademicSyncDialogProps) {
  const ref = useDialog(open, onClose);
  const scriptUrl = new URL('/slu-jwxt-sync.user.js', window.location.origin).toString();
  return (
    <dialog ref={ref} className="kapp academic-sync-app" aria-labelledby="academicSyncTitle">
      <header className="kapp-head">
        <div>
          <h2 id="academicSyncTitle">扫码同步教务课表</h2>
          <p className="kapp-sub">默认使用教务系统扫码登录，不保存账号密码</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X /></button>
      </header>
      <div className="kapp-body">
        <div className="academic-sync-hero">
          <div className="academic-qr-icon"><QrCode /></div>
          <div>
            <h3>手机扫码登录，自动读取本学期课表</h3>
            <p>系统会打开学校官方登录页，老师在手机上确认登录后，同步脚本读取已登录页面中的课表数据。</p>
          </div>
        </div>
        <div className="academic-sync-steps">
          <span>① 点击开始扫码</span>
          <span>② 使用手机完成官方扫码登录</span>
          <span>③ 课表自动保存到本机档案</span>
        </div>
        {status !== 'idle' && (
          <div className={'academic-sync-status is-' + status}>
            {status === 'success' ? <CheckCircle2 /> : status === 'error' ? <TriangleAlert /> : <QrCode />}
            <span>{message}</span>
          </div>
        )}
        <div className="academic-sync-help">
          <div><ShieldCheck /><span>凭据不会进入课表系统，登录会话只保留在教务系统域名内。</span></div>
          <a href={scriptUrl} target="_blank" rel="noreferrer">首次使用请安装同步脚本 <ExternalLink size={13} /></a>
        </div>
      </div>
      <footer className="kapp-foot">
        <span className="kapp-foot-spacer" />
        <button className="kbtn primary" type="button" onClick={onStart}>
          <QrCode size={15} />{status === 'waiting' ? '重新打开扫码登录' : '开始扫码登录'}
        </button>
      </footer>
    </dialog>
  );
}
