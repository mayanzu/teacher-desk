/*
 * 带内存预算的 LRU 缓存（对应 review R07）。
 *
 * 旧实现只限「条数」：每个会话 200 个查询 / 20 个导出，最多 500 个会话。
 * 单个导出没有字节上限，过期项也不会被主动清理，多用户场景下内存无法证明有界。
 *
 * 这里给每个缓存仓库加上：
 *  - 每仓库条数上限（保持旧常量）；
 *  - 每仓库字节预算（按值估算，超预算按最近最少使用淘汰）；
 *  - 单个对象准入上限（超大导出直接拒绝，避免一个文件挤爆预算）；
 *  - 所有仓库共享的全局字节预算（需要时从最久未用的仓库开始回收）；
 *  - 过期清扫（TTL 只决定命中，过期项不再无限期占着内存）。
 */
import { cacheTtlFor } from './cacheTtl.mjs';

const MB = 1024 * 1024;

function envBytes(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export const QUERY_CACHE_BYTES = envBytes('JWXT_QUERY_CACHE_BYTES', 16 * MB);
export const EXPORT_CACHE_BYTES = envBytes('JWXT_EXPORT_CACHE_BYTES', 64 * MB);
export const CACHE_TOTAL_BYTES = envBytes('JWXT_CACHE_TOTAL_BYTES', 256 * MB);
export const MAX_CACHED_OBJECT_BYTES = envBytes('JWXT_MAX_OBJECT_BYTES', 32 * MB);

/** 估算一个缓存值的近似内存占用。只用于预算，不追求精确。 */
export function estimateSize(value, depth = 0, seen = new Set()) {
  if (value === null || value === undefined) return 8;
  const type = typeof value;
  if (type === 'string') return value.length * 2 + 24;
  if (type === 'number' || type === 'bigint') return 16;
  if (type === 'boolean') return 8;
  if (type === 'function' || type === 'symbol') return 0;
  if (Buffer.isBuffer(value)) return value.byteLength + 48;
  if (value instanceof ArrayBuffer) return value.byteLength + 48;
  if (ArrayBuffer.isView(value)) return value.byteLength + 48;
  if (value instanceof Date) return 32;
  if (type !== 'object' || depth > 6) return 64;
  if (seen.has(value)) return 32;
  seen.add(value);
  let size = 48;
  if (Array.isArray(value)) {
    for (const item of value) size += estimateSize(item, depth + 1, seen);
  } else {
    for (const key of Object.keys(value)) {
      size += key.length * 2 + estimateSize(value[key], depth + 1, seen);
    }
  }
  return size;
}

// 所有活跃缓存仓库；用于全局预算回收与过期清扫。
const stores = new Set();
let totalBytes = 0;

function touch(store, key) {
  const hit = store.map.get(key);
  if (!hit) return undefined;
  // 触发 LRU：把命中的键移到队尾
  store.map.delete(key);
  store.map.set(key, hit);
  return hit;
}

export class CacheStore {
  constructor({ max = 200, maxBytes = QUERY_CACHE_BYTES, name = 'cache' } = {}) {
    this.map = new Map();
    this.max = max;
    this.maxBytes = maxBytes;
    this.name = name;
    this.bytes = 0;
    stores.add(this);
  }

  get size() {
    return this.map.size;
  }

  get(key) {
    return touch(this, key)?.value;
  }

  set(key, entry) {
    const previous = this.map.get(key);
    if (previous) {
      this.map.delete(key);
      this.bytes -= previous.size || 0;
      totalBytes -= previous.size || 0;
    }
    const size = estimateSize(entry?.value);
    if (size > MAX_CACHED_OBJECT_BYTES) {
      // 超大对象（例如异常大的导出文件）不进内存缓存，调用方按未命中处理。
      return false;
    }
    const sized = { ...entry, size };
    this.map.set(key, sized);
    this.bytes += size;
    totalBytes += size;
    this.trim();
    trimGlobal(this);
    return true;
  }

  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key);
    this.bytes -= entry.size || 0;
    totalBytes -= entry.size || 0;
    return true;
  }

  clear() {
    this.bytes = 0;
    totalBytes -= [...this.map.values()].reduce((sum, entry) => sum + (entry.size || 0), 0);
    this.map.clear();
  }

  keys() {
    return this.map.keys();
  }

  entries() {
    return this.map.entries();
  }

  /** 按插入顺序返回第一个满足条件的值。 */
  find(predicate) {
    for (const entry of this.map.values()) {
      if (predicate(entry.value)) return entry.value;
    }
    return undefined;
  }

  trim() {
    while (this.map.size > this.max) this.evictOldest();
    while (this.bytes > this.maxBytes && this.map.size > 0) this.evictOldest();
  }

  evictOldest() {
    const oldest = this.map.keys().next().value;
    if (oldest !== undefined) this.delete(oldest);
  }

  /** 删除所有满足 match(key) 的项；返回删除数量。 */
  invalidate(match) {
    let removed = 0;
    for (const key of [...this.map.keys()]) {
      if (match(key) && this.delete(key)) removed += 1;
    }
    return removed;
  }

  /** 删除超过 TTL 的项；返回删除数量。条目自带 ttl（例如导出缓存）时优先使用。 */
  sweep(ttlFor = cacheTtlFor, now = Date.now()) {
    let removed = 0;
    for (const [key, entry] of [...this.map.entries()]) {
      const ttl = Number.isFinite(entry.ttl) ? entry.ttl : ttlFor(key, entry);
      if (Number.isFinite(ttl) && now - entry.at > ttl) {
        this.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** 上下文被回收时调用，避免全局账本继续为死仓库计数。 */
  destroy() {
    this.clear();
    stores.delete(this);
  }
}

function trimGlobal(except) {
  if (totalBytes <= CACHE_TOTAL_BYTES) return;
  // 从当前仓库开始回收；仍超预算时再回收其它最久未用的仓库。
  let guard = 0;
  while (totalBytes > CACHE_TOTAL_BYTES && guard < 10000) {
    guard += 1;
    let victim = except;
    if (!victim || victim.map.size === 0) {
      let oldest = Infinity;
      victim = null;
      for (const store of stores) {
        const key = store.map.keys().next().value;
        const entry = key === undefined ? undefined : store.map.get(key);
        if (entry && entry.at < oldest) {
          oldest = entry.at;
          victim = store;
        }
      }
    }
    if (!victim || victim.map.size === 0) break;
    victim.evictOldest();
  }
}

/** 清扫所有活跃仓库的过期项（由 server/index.mjs 定时调用）。 */
export function sweepAllCaches(now = Date.now()) {
  let removed = 0;
  for (const store of stores) removed += store.sweep(cacheTtlFor, now);
  return removed;
}

/** 读取仍在 TTL 内的值（不触发 LRU 之外的副作用），过期返回 undefined。 */
export function freshEntry(store, key, ttl = cacheTtlFor(key), now = Date.now()) {
  const entry = store.map.get(key);
  if (!entry) return undefined;
  return now - entry.at < ttl ? entry.value : undefined;
}

export function cacheStats() {
  return { stores: stores.size, totalBytes, limitBytes: CACHE_TOTAL_BYTES };
}

/**
 * 统一的缓存读写：
 *  - 新鲜命中直接返回；
 *  - 同一会话内相同键的并发请求合并（force 除外）；
 *  - 若期间发生 save 淘汰（inflight 被清掉），旧结果不再写回缓存。
 */
export async function cached(ctx, key, fn, force = false, options = {}) {
  const store = options.store || ctx.cache;
  const ttl = options.ttl || cacheTtlFor(key);
  const now = Date.now();
  const hit = store.map.get(key);
  if (hit && !force && now - hit.at < ttl) {
    // 触发 LRU：把命中的键移到队尾
    store.delete(key);
    store.set(key, { at: hit.at, value: hit.value, ttl: hit.ttl });
    return hit.value;
  }
  if (hit) store.delete(key);
  // 但 ?refresh=1（force）必须真的回源，不能复用刷新前就发出的那次请求。
  if (!force && ctx.inflight.has(key)) return ctx.inflight.get(key);
  const pending = (async () => {
    try {
      const value = await fn();
      // 被 force 重发或保存失效顶替时，旧请求的结果不再写缓存，避免慢的旧结果覆盖新值
      if (ctx.inflight.get(key) === pending) {
        store.set(key, { at: Date.now(), value, ttl });
      }
      return value;
    } finally {
      // 只有自己仍是当前在飞请求时才注销，避免删掉后来者（force 重发）的登记
      if (ctx.inflight.get(key) === pending) ctx.inflight.delete(key);
    }
  })();
  ctx.inflight.set(key, pending);
  return pending;
}
