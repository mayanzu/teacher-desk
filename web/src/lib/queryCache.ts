// Browser-memory cache: deliberately scoped to this login, never persisted to disk.
// 带条数 + 字节双预算（review R07），并保留查询时间供 UI 判断数据年龄（review R06）。
const values = new Map<string, { value: unknown; at: number; size: number }>();
const pending = new Map<string, Promise<unknown>>();
let generation = 0;
let bytes = 0;
export const QUERY_TTL_MS = 5 * 60_000;
const MAX = 150;
const MAX_BYTES = 8 * 1024 * 1024;

export interface QueryEntry<T> {
  value: T;
  at: number;
}

/** 估算缓存值的内存占用（只用于预算，不追求精确）。 */
export function estimateBytes(value: unknown, depth = 0): number {
  if (value === null || value === undefined) return 8;
  const type = typeof value;
  if (type === 'string') return (value as string).length * 2 + 24;
  if (type === 'number' || type === 'bigint') return 16;
  if (type === 'boolean') return 8;
  if (type === 'function' || type === 'symbol') return 0;
  if (type !== 'object' || depth > 6) return 64;
  if (Array.isArray(value)) {
    let size = 48;
    for (const item of value) size += estimateBytes(item, depth + 1);
    return size;
  }
  let size = 48;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    size += key.length * 2 + estimateBytes(item, depth + 1);
  }
  return size;
}

function drop(key: string): void {
  const hit = values.get(key);
  if (!hit) return;
  values.delete(key);
  bytes -= hit.size;
}

function store(key: string, value: unknown): void {
  drop(key);
  const size = estimateBytes(value);
  values.set(key, { value, at: Date.now(), size });
  bytes += size;
  while (values.size > MAX || bytes > MAX_BYTES) {
    const oldest = values.keys().next().value;
    if (oldest === undefined) break;
    drop(oldest);
  }
}

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
  bytes = 0;
}

export function peekQueryEntry<T>(path: string): QueryEntry<T> | undefined {
  const hit = values.get(queryKey(path));
  return hit ? { value: hit.value as T, at: hit.at } : undefined;
}

export function peekQuery<T>(path: string): T | undefined {
  return values.get(queryKey(path))?.value as T | undefined;
}

export function cacheGeneration(): number { return generation; }

export async function query<T>(path: string, load: () => Promise<T>): Promise<T> {
  const key = queryKey(path);
  const force = new URL(path, 'http://local').searchParams.get('refresh') === '1';
  const hit = values.get(key);
  if (!force && hit && Date.now() - hit.at < QUERY_TTL_MS) {
    values.delete(key);
    values.set(key, hit);
    return structuredClone(hit.value) as T;
  }
  if (!force && pending.has(key)) return structuredClone(await pending.get(key)) as T;
  const epoch = generation;
  const task = Promise.resolve().then(load).then(value => {
    // 存储不再额外 clone：value 只交给本函数的调用方（调用方拿到的是 clone），
    // 少一次整表复制；缓存对象对外始终只读（review R14）。
    if (generation === epoch && pending.get(key) === task) store(key, value);
    return value;
  }).finally(() => {
    if (pending.get(key) === task) pending.delete(key);
  });
  pending.set(key, task);
  return structuredClone(await task);
}

export function invalidateQueries(prefix: string): void {
  for (const key of [...values.keys()]) if (key.startsWith(prefix)) drop(key);
  for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key);
}
