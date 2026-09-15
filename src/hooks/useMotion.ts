import { useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';

export function useMotion() {
  const [paused, setPaused] = useLocalStorage('kb-motion-paused', false);

  useEffect(() => {
    document.body.classList.toggle('motion-paused', paused);
    return () => document.body.classList.remove('motion-paused');
  }, [paused]);

  return { paused, setPaused, toggle: () => setPaused((value) => !value) };
}
