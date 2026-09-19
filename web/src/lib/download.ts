import { ApiError } from '../api';

interface DownloadPayload {
  filename?: string;
  contentType?: string;
  base64?: string;
}

/**
 * 通过 JSON 通道下载文件（服务端返回 base64，前端还原成 Blob 再保存）。
 *
 * 不用直接的附件流，是为了避开 IDM 等下载管理器的拦截：
 * 附件流会被下载管理器抢一次、浏览器再存一个 0 字节文件；JSON 响应不会被识别为下载。
 * 同时保留了服务端错误提示（非 2xx 时抛 ApiError，调用方展示）。
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
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
  const payload = (await response.json().catch(() => null)) as DownloadPayload | null;
  if (!payload || typeof payload.base64 !== 'string' || !payload.base64) {
    throw new ApiError('服务器返回了无效的下载数据，请稍后重试', 502);
  }
  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const blob = new Blob([bytes], { type: payload.contentType || 'application/octet-stream' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = payload.filename || fallbackName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
