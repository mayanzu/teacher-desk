import { useToast } from '../context/ToastContext';

export function ToastViewport() {
  const { message } = useToast();
  return <div className={'toast' + (message ? ' show' : '')} role="status" aria-live="polite">{message}</div>;
}
