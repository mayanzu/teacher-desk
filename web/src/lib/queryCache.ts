// Browser-memory cache: deliberately scoped to this login, never persisted to disk.
const values = new Map<string, { value: unknown; at: number }>();
const pending = new Map<string, Promise<unknown>>();
let generation = 0;
const TTL = 5 * 60_000;
const MAX = 150;

export function queryKey(path: string): string {
  const url = new URL(path, 'http://local');
  url.searchParams.delete('refresh');
  url.searchParams.sort();
  return url.pathname + url.search;
}

export function clearQueryCache(): void {
  generation++;
  values.clear();
  pending.clear();
}

export function peekQuery<T>(path: string): T | undefined {
  return values.get(queryKey(path))?.value as T | undefined;
}

export function cacheGeneration(): number { return generation; }

export async function query<T>(path: string, load: () => Promise<T>): Promise<T> {
  const key = queryKey(path);
  const force = new URL(path, 'http://local').searchParams.get('refresh') === '1';
  const hit = values.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) {
    values.delete(key);
    values.set(key, hit);
    return structuredClone(hit.value) as T;
  }
  if (!force && pending.has(key)) return structuredClone(await pending.get(key)) as T;
  const epoch = generation;
  const task = Promise.resolve().then(load).then(value => {
    if (generation === epoch && pending.get(key) === task) {
      values.set(key, { value: structuredClone(value), at: Date.now() });
      while (values.size > MAX) values.delete(values.keys().next().value!);
    }
    return value;
  }).finally(() => {
    if (pending.get(key) === task) pending.delete(key);
  });
  pending.set(key, task);
  return structuredClone(await task);
}

export function invalidateQueries(prefix: string): void {
  for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key);
  for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key);
}
