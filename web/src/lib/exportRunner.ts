/**
 * 导出按钮的等待态：导出要等教务（PDF 1~4 秒，成绩/点名册更久），
 * 点下去必须马上有反馈，而且等待期间不能重复发起（连点会同时生成多份、白等更久）。
 *
 * 纯逻辑，不依赖 React，方便直接单测；组件侧只负责把它接到按钮上。
 */
export type ExportKey = string;

export interface ExportRunner {
  isPending: (key: ExportKey) => boolean;
  subscribe: (listener: (pending: ReadonlySet<ExportKey>) => void) => () => void;
  /** 已有同一 key 在导出时直接返回 false（连点忽略）；成功或失败都会清掉等待态 */
  run: (key: ExportKey, task: () => Promise<void>) => Promise<boolean>;
}

export function createExportRunner(): ExportRunner {
  const pending = new Set<ExportKey>();
  const listeners = new Set<(pending: ReadonlySet<ExportKey>) => void>();

  const emit = () => {
    const snapshot: ReadonlySet<ExportKey> = new Set(pending);
    for (const listener of listeners) listener(snapshot);
  };

  return {
    isPending: (key) => pending.has(key),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run(key, task) {
      if (pending.has(key)) return false;
      pending.add(key);
      emit();
      try {
        await task();
        return true;
      } finally {
        pending.delete(key);
        emit();
      }
    },
  };
}
