import { CheckCircle2, QrCode, RefreshCw, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useDialog } from '../hooks/useDialog';
import type { AcademicSyncStatus } from '../hooks/useAcademicSync';

interface AcademicSyncDialogProps {
  open: boolean;
  status: AcademicSyncStatus;
  message: string;
  qrCodeValue: string;
  onStart: () => void;
  onClose: () => void;
}

export function AcademicSyncDialog({ open, status, message, qrCodeValue, onStart, onClose }: AcademicSyncDialogProps) {
  const ref = useDialog(open, onClose);
  return (
    <dialog ref={ref} className="kapp academic-sync-app" aria-labelledby="academicSyncTitle">
      <header className="kapp-head">
        <div>
          <h2 id="academicSyncTitle">扫码同步教务课表</h2>
          <p className="kapp-sub">无需安装插件，不保存账号密码</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X /></button>
      </header>
      <div className="kapp-body">
        <div className="academic-sync-layout">
          <div className="academic-qr-panel">
            {qrCodeValue ? <QRCodeSVG value={qrCodeValue} size={250} level="M" bgColor="#fffdf6" fgColor="#1c1c22" marginSize={1} /> : <div className="academic-qr-placeholder"><QrCode /></div>}
            <span>{status === 'waiting' ? '二维码有效期约 5 分钟' : '点击下方按钮生成二维码'}</span>
          </div>
          <div className="academic-sync-copy">
            <h3>手机扫码，自动同步本学期课表</h3>
            <p>使用学校教务系统支持的手机端扫码登录。后端会在教务域名内完成会话轮询，成功后将课表安全传给课表系统。</p>
            <div className="academic-sync-steps">
              <span>① 手机扫码</span>
              <span>② 教务端确认登录</span>
              <span>③ 自动保存教师档案</span>
            </div>
            {status !== 'idle' && (
              <div className={'academic-sync-status is-' + status}>
                {status === 'success' ? <CheckCircle2 /> : status === 'error' ? <TriangleAlert /> : <QrCode />}
                <span>{message}</span>
              </div>
            )}
            <div className="academic-sync-help"><ShieldCheck /><span>课表系统的前端与业务数据库不会接触登录密码，扫码会话保存在软路由内存中并自动过期。</span></div>
          </div>
        </div>
      </div>
      <footer className="kapp-foot">
        <span className="kapp-foot-spacer" />
        <button className="kbtn primary" type="button" onClick={onStart}>
          {status === 'waiting' ? <RefreshCw size={15} /> : <QrCode size={15} />}
          {status === 'waiting' ? '刷新二维码' : '生成扫码登录二维码'}
        </button>
      </footer>
    </dialog>
  );
}
