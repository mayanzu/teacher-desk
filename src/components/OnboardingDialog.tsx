import { ClipboardPaste, QrCode, X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';

interface OnboardingDialogProps {
  open: boolean;
  onClose: () => void;
  onAcademicSync: () => void;
  onPaste: () => void;
}

export function OnboardingDialog({ open, onClose, onAcademicSync, onPaste }: OnboardingDialogProps) {
  const ref = useDialog(open, onClose);
  return (
    <dialog ref={ref} className="kapp onboarding-app" aria-labelledby="onboardingTitle">
      <header className="kapp-head">
        <div>
          <h2 id="onboardingTitle">导入你的课表</h2>
          <p className="kapp-sub">选择与你手头资料对应的导入方式</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭导入方式" onClick={onClose}><X /></button>
      </header>
      <div className="kapp-body">
        <div className="onboarding-options">
          <button className="onboarding-option" type="button" onClick={onAcademicSync}>
            <QrCode aria-hidden="true" />
            <strong>扫码同步教务课表</strong>
            <span>手机扫码登录教务系统，自动读取并保存本学期课表</span>
          </button>
          <button className="onboarding-option" type="button" onClick={onPaste}>
            <ClipboardPaste aria-hidden="true" />
            <strong>粘贴课表</strong>
            <span>从教务处网页或 Excel 复制表格，粘贴即可识别</span>
          </button>
        </div>
        <p className="kapp-hint">数据只保存在本机浏览器，可随时切换、导出或重新导入。</p>
      </div>
    </dialog>
  );
}

