import type { ReactNode } from 'react';
import { AlertTriangle, Info, Wrench } from './Icons';

export function LoadingState({ message = '正在加载…' }: { message?: string }) {
  return (
    <div className="state-box is-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p className="state-message">{message}</p>
    </div>
  );
}

export function ErrorState({ title = '出错了', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div className="state-box is-error" role="alert">
      <span className="state-icon" aria-hidden="true">
        <AlertTriangle />
      </span>
      <strong className="state-title">{title}</strong>
      <p className="state-message">{message}</p>
      {onRetry && (
        <button className="kbtn primary" type="button" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  hint,
  action,
  icon,
}: {
  title: string;
  message?: string;
  hint?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="state-box is-empty" role="status">
      <span className="state-icon" aria-hidden="true">
        {icon ?? <Info />}
      </span>
      <strong className="state-title">{title}</strong>
      {message && <p className="state-message">{message}</p>}
      {hint && <p className="state-hint">{hint}</p>}
      {action}
    </div>
  );
}

export function PendingState({ title, message, hint }: { title: string; message: string; hint?: string }) {
  return (
    <div className="state-box is-pending" role="status">
      <span className="state-icon" aria-hidden="true">
        <Wrench />
      </span>
      <strong className="state-title">{title}</strong>
      <p className="state-message">{message}</p>
      {hint && <p className="state-hint">{hint}</p>}
    </div>
  );
}
