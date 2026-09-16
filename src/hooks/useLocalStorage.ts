import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

export type Validator<T> = (value: unknown) => value is T;

function readValue<T>(key: string, initialValue: T, validate?: Validator<T>): T {
  if (typeof window === 'undefined') return initialValue;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return initialValue;
    const parsed: unknown = JSON.parse(raw);
    if (validate) return validate(parsed) ? parsed : initialValue;
    if (parsed === null || typeof parsed !== typeof initialValue) return initialValue;
    return parsed as T;
  } catch {
    return initialValue;
  }
}

export function useLocalStorage<T>(key: string, initialValue: T, validate?: Validator<T>) {
  const [value, setValue] = useState<T>(() => readValue(key, initialValue, validate));
  const validateRef = useRef(validate);

  useEffect(() => {
    validateRef.current = validate;
  }, [validate]);

  const update = useCallback((next: SetStateAction<T>) => {
    setValue((previous) => (typeof next === 'function' ? (next as (value: T) => T)(previous) : next));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const serialized = JSON.stringify(value);
      if (window.localStorage.getItem(key) === serialized) return;
      window.localStorage.setItem(key, serialized);
    } catch {
      // Storage may be unavailable in private mode.
    }
  }, [key, value]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setValue(readValue(key, initialValue, validateRef.current));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [key, initialValue]);

  return [value, update] as const;
}
