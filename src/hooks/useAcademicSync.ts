import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSluImportPayload, sluStartSchema, sluStatusSchema } from '../services/academic/slu';
import type { ImportPayload } from '../types/schedule';

export type AcademicSyncStatus = 'idle' | 'waiting' | 'success' | 'error';

interface AcademicSyncOptions {
  onImported: (payload: ImportPayload) => void;
}

export function useAcademicSync({ onImported }: AcademicSyncOptions) {
  const [status, setStatus] = useState<AcademicSyncStatus>('idle');
  const [message, setMessage] = useState('');
  const [qrCodeValue, setQrCodeValue] = useState('');
  const sessionRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const pollRef = useRef<(sessionId: string) => void>(() => {});
  const mountedRef = useRef(true);
  const importedRef = useRef(onImported);

  useEffect(() => {
    importedRef.current = onImported;
  }, [onImported]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const poll = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/slu/qr/status?session=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
      const parsed = sluStatusSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('扫码状态响应格式异常');
      if (!mountedRef.current || sessionRef.current !== sessionId) return;
      const result = parsed.data;
      if (result.status === 'waiting') {
        setMessage(result.message || '等待手机扫码…');
        timerRef.current = window.setTimeout(() => void pollRef.current(sessionId), 1500);
        return;
      }
      if (result.status === 'success') {
        const payload = buildSluImportPayload(result);
        importedRef.current(payload);
        sessionRef.current = '';
        clearTimer();
        setQrCodeValue('');
        setStatus('success');
        setMessage(`已同步 ${payload.courses.length} 个课次并保存到本机档案。`);
        return;
      }
      sessionRef.current = '';
      clearTimer();
      setQrCodeValue('');
      setStatus('error');
      setMessage(result.message || '扫码会话已失效，请刷新二维码');
    } catch (error) {
      if (!mountedRef.current) return;
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '扫码状态查询失败');
    }
  }, [clearTimer]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const start = useCallback(async () => {
    clearTimer();
    sessionRef.current = '';
    setStatus('waiting');
    setMessage('正在生成教务系统二维码…');
    setQrCodeValue('');
    try {
      const response = await fetch('/api/slu/qr/start', { method: 'POST' });
      const parsed = sluStartSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('无法创建教务扫码会话');
      const data = parsed.data;
      if (!mountedRef.current) return;
      sessionRef.current = data.session;
      setQrCodeValue(data.qrCode);
      setMessage('请使用手机扫码并在教务系统确认登录…');
      timerRef.current = window.setTimeout(() => void pollRef.current(data.session), 1200);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '扫码服务暂不可用');
    }
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    sessionRef.current = '';
    setQrCodeValue('');
    setStatus('idle');
    setMessage('');
  }, [clearTimer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  return { status, message, qrCodeValue, start, reset };
}
