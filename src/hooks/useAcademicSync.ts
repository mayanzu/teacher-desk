import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSluImportPayload, createSyncToken, openSluLoginWindow, SLU_ORIGIN, sluSyncSchema } from '../services/academic/slu';
import type { ImportPayload } from '../types/schedule';

export type AcademicSyncStatus = 'idle' | 'waiting' | 'success' | 'error';

interface AcademicSyncOptions {
  onImported: (payload: ImportPayload) => void;
}

export function useAcademicSync({ onImported }: AcademicSyncOptions) {
  const [status, setStatus] = useState<AcademicSyncStatus>('idle');
  const [message, setMessage] = useState('');
  const tokenRef = useRef('');
  const popupRef = useRef<Window | null>(null);
  const expiryRef = useRef<number | null>(null);
  const importedRef = useRef(onImported);

  useEffect(() => {
    importedRef.current = onImported;
  }, [onImported]);

  const clearTimer = () => {
    if (expiryRef.current) window.clearTimeout(expiryRef.current);
    expiryRef.current = null;
  };

  const start = useCallback(() => {
    clearTimer();
    const token = createSyncToken();
    tokenRef.current = token;
    setStatus('waiting');
    setMessage('等待手机扫码并在教务系统完成登录…');
    const popup = openSluLoginWindow(token);
    if (!popup) {
      setStatus('error');
      setMessage('浏览器阻止了登录窗口，请允许本站打开弹窗后重试。');
      return;
    }
    popupRef.current = popup;
    expiryRef.current = window.setTimeout(() => {
      if (tokenRef.current !== token) return;
      tokenRef.current = '';
      setStatus('error');
      setMessage('同步令牌已过期，请重新发起扫码登录。');
    }, 5 * 60 * 1000);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== SLU_ORIGIN) return;
      const parsed = sluSyncSchema.safeParse(event.data);
      if (!parsed.success) return;
      if (!tokenRef.current || parsed.data.token !== tokenRef.current) return;
      try {
        const payload = buildSluImportPayload(parsed.data);
        importedRef.current(payload);
        tokenRef.current = '';
        clearTimer();
        popupRef.current?.close();
        setStatus('success');
        setMessage(`已同步 ${payload.courses.length} 个课次，可继续使用。`);
      } catch (error) {
        setStatus('error');
        setMessage(error instanceof Error ? error.message : '课表数据解析失败');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimer();
    };
  }, []);

  const reset = useCallback(() => {
    tokenRef.current = '';
    clearTimer();
    popupRef.current?.close();
    setStatus('idle');
    setMessage('');
  }, []);

  return { status, message, start, reset };
}
