import { useCallback, useRef, useState } from 'react';

/**
 * 显式刷新语义（review R19）：
 * 只有用户主动点「刷新/重试」才会让下一次请求带 `refresh=1`；
 * 普通切换学期/重新挂载遵循缓存策略，不会被历史点击持续强制回源。
 *
 * 用法：
 *   const { token, requestRefresh } = useRefreshRequest(term);
 *   useEffect(() => { ... }, [term, token]);  // 内部决定是否携带 refresh=1
 */
export function useRefreshRequest(key: string): { token: number; requestRefresh: () => void } {
  const seq = useRef(0);
  const [state, setState] = useState<{ key: string; seq: number }>({ key, seq: 0 });

  const requestRefresh = useCallback(() => {
    seq.current += 1;
    setState({ key, seq: seq.current });
  }, [key]);

  // key（学期/页面）变化后 token 自动归零，旧刷新不会作用于新 key。
  return { token: state.key === key ? state.seq : 0, requestRefresh };
}

/** 每个 effect 自己的消费记录：同一个 token 只对首次运行生效。 */
export function useRefreshConsumer(): { forceFor: (token: number) => boolean } {
  const consumed = useRef(0);
  const forceFor = useCallback((token: number) => {
    if (token <= 0 || consumed.current === token) return false;
    consumed.current = token;
    return true;
  }, []);
  return { forceFor };
}
