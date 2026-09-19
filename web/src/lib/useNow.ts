import { useEffect, useState } from 'react';

/** 返回一个按固定间隔刷新的“当前时间”，用于倒计时与 live/past 状态。 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => {
      // 页面不可见时不刷新，避免后台标签页持续唤醒（review R15）
      if (typeof document !== 'undefined' && document.hidden) return;
      setNow(new Date());
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
