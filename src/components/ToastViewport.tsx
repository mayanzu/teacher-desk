import { useToastMessage } from '../context/ToastContext';

export function ToastViewport() {
  const { message } = useToastMessage();
  return <div className={'toast' + (message ? ' is-visible' : '')} role="status" aria-live="polite">{message}</div>;
}
