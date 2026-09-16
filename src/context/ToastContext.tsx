import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastMessageValue {
  message: string;
}

interface ToastActionsValue {
  notify: (message: string) => void;
}

const ToastMessageContext = createContext<ToastMessageValue | null>(null);
const ToastActionsContext = createContext<ToastActionsValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<number | null>(null);
  const notify = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(''), 2600);
  }, []);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const messageValue = useMemo<ToastMessageValue>(() => ({ message }), [message]);
  const actionsValue = useMemo<ToastActionsValue>(() => ({ notify }), [notify]);

  return (
    <ToastActionsContext.Provider value={actionsValue}>
      <ToastMessageContext.Provider value={messageValue}>{children}</ToastMessageContext.Provider>
    </ToastActionsContext.Provider>
  );
}

export function useToastMessage(): ToastMessageValue {
  const context = useContext(ToastMessageContext);
  if (!context) throw new Error('useToastMessage must be used within ToastProvider');
  return context;
}

export function useToastActions(): ToastActionsValue {
  const context = useContext(ToastActionsContext);
  if (!context) throw new Error('useToastActions must be used within ToastProvider');
  return context;
}

export function useToast() {
  const message = useToastMessage();
  const actions = useToastActions();
  return { message: message.message, notify: actions.notify };
}
