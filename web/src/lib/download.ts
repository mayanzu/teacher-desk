import { ApiError } from '../api';

interface DownloadPayload {
  filename?: string;
  contentType?: string;
  base64?: string;
}

export type DownloadPhase = 'generating' | 'downloading' | 'saving';

export interface DownloadOptions {
  /** 阶段回调：服务端还没回响应头 = 正在生成；读到响应体 = 正在下载；解码保存前 = 正在保存。 */
  onPhase?: (phase: DownloadPhase) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * 通过 JSON 通道下载文件（服务端返回 base64，前端还原成 Blob 再保存）。
 *
 * 不用直接的附件流，是为了避开 IDM 等下载管理器的拦截：
 * 附件流会被下载管理器抢一次、浏览器再存一个 0 字节文件；JSON 响应不会被识别为下载。
 * 同时保留了服务端错误提示（非 2xx 时抛 ApiError，调用方展示）。
 *
 * 生命周期（review R10）：
 *  - 同一文件的生成/传输/保存只跑一次，多个按钮/连续点击共享同一任务；
 *  - 有明确超时与取消信号，失败可重试；
 *  - 阶段回调只用于 UI 文案，不代表服务端精确进度。
 */
const pendingDownloads = new Map<string, Promise<void>>();

export function downloadFile(url: string, fallbackName: string, options: DownloadOptions = {}): Promise<void> {
  const key = `${url}\u0000${fallbackName}`;
  const existing = pendingDownloads.get(key);
  if (existing) return existing;
  const task = performDownload(url, fallbackName, options).finally(() => {
    if (pendingDownloads.get(key) === task) pendingDownloads.delete(key);
  });
  pendingDownloads.set(key, task);
  return task;
}

function timeoutSignal(ms: number, external?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), ms);
  const forward = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) forward();
    else external.addEventListener('abort', forward, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', forward);
    },
  };
}

async function performDownload(url: string, fallbackName: string, options: DownloadOptions): Promise<void> {
  const { signal, cleanup } = timeoutSignal(options.timeoutMs ?? 180000, options.signal);
  try {
    options.onPhase?.('generating');
    let response: Response;
    try {
      response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new ApiError('下载超时或已取消，请重试', 408);
      }
      throw new ApiError('无法连接后端服务，请确认服务已启动', 0);
    }
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
    options.onPhase?.('downloading');
    const payload = (await response.json().catch(() => null)) as DownloadPayload | null;
    if (!payload || typeof payload.base64 !== 'string' || !payload.base64) {
      throw new ApiError('服务器返回了无效的下载数据，请稍后重试', 502);
    }
    options.onPhase?.('saving');
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
  } finally {
    cleanup();
  }
}
