import { useCallback, useEffect, useRef, useState } from 'react';
import { createExportRunner } from '../lib/exportRunner';
import type { DownloadPhase } from '../lib/download';

interface ExportButtonProps {
  /** 传给 button 的 class（沿用 kbtn primary / kbtn ghost 等既有样式） */
  className?: string;
  label: string;
  /** 生成/下载中的文案，默认「导出中…」 */
  pendingLabel?: string;
  title?: string;
  onExport: (report: (phase: DownloadPhase) => void) => Promise<void>;
}

/**
 * 导出按钮：点击后立刻切成「转圈 + 导出中…」并禁用，直到文件真正落地。
 * 等待期间重复点击会被忽略（同一份导出不重复发起），成功或失败都会恢复。
 * report 回调用于区分「正在生成 / 正在下载 / 正在保存」，不是精确进度。
 */
export function ExportButton({ className = 'kbtn', label, pendingLabel = '导出中…', title, onExport }: ExportButtonProps) {
  const runner = useRef(createExportRunner()).current;
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<DownloadPhase | null>(null);

  useEffect(() => {
    // 每个按钮各管各的等待态，所以固定一个 key
    return runner.subscribe((keys) => {
      const active = keys.has('self');
      setPending(active);
      if (!active) setPhase(null);
    });
  }, [runner]);

  const handleClick = useCallback(() => {
    void runner.run('self', () => onExport(setPhase));
  }, [runner, onExport]);

  const text = phase === 'downloading' ? '正在下载…' : phase === 'saving' ? '正在保存…' : pendingLabel;

  return (
    <button
      type="button"
      className={`${className}${pending ? ' is-exporting' : ''}`}
      disabled={pending}
      aria-busy={pending}
      aria-live="polite"
      title={title}
      onClick={handleClick}
    >
      {pending && <span className="export-spinner" aria-hidden="true" />}
      {pending ? text : label}
    </button>
  );
}
