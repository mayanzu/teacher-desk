import { useCallback, useEffect, useState, type SetStateAction } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initialValue : (JSON.parse(raw) as T);
    } catch {
      return initialValue;
    }
  });

  const update = useCallback((next: SetStateAction<T>) => {
    setValue((previous) => (typeof next === 'function' ? (next as (value: T) => T)(previous) : next));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage may be unavailable in private mode.
    }
  }, [key, value]);

  return [value, update] as const;
}
