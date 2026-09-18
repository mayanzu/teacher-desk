import { ApiError } from '../api';

export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    let message = `下载失败（HTTP ${response.status}）`;
    try {
      const payload: unknown = await response.json();
      const serverMessage = (payload as { error?: unknown } | null)?.error;
      if (typeof serverMessage === 'string' && serverMessage) message = serverMessage;
    } catch {
      /* 错误页不是 JSON 时使用默认文案 */
    }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
