async function checkSession(session) {
  try {
    // SetMainInfo.jsp 会输出当前登录账号；未登录时为 kingo.guest
    const info = await session.text('/ahsljw/frame/home/js/SetMainInfo.jsp', { method: 'GET' });
    if (info.status !== 200) throw Object.assign(new Error('会话状态暂时无法验证'), { status: 503 });
    if (info.status === 200) {
      if (/kingo\.guest/i.test(info.text)) return false;
      if (/_loginid\s*=\s*'[^']+'/.test(info.text)) return true;
    }
    if (!session.landingUrl) throw Object.assign(new Error('无法识别教务会话状态'), { status: 502 });
    const res = await session.text(session.landingUrl, { method: 'GET' });
    if (res.status !== 200) throw Object.assign(new Error('会话状态暂时无法验证'), { status: 503 });
    if (/cas\/login\.action|未登录|登录超时|重新登录|会话已过期/i.test(res.text)) return false;
    return true;
  } catch (error) {
    if (error.status === 401) return false;
    throw error;
  }
}

/**
 * 会话存活探测：每次调用都会真的打一次教务（SetMainInfo.jsp，实测单次 0.4~2s）。
 * 每个受保护接口前面都会先 ensureSession() 探测一次，于是数据缓存即使命中，
 * 老师每切一次 tab 仍要先等一轮上游往返——表现就是「明明缓存了还在转圈」。
 *
 * 所以在「已确认存活」后极短记忆（JWXT_SESSION_PROBE_TTL_MS，默认 45 秒）内直接复用结论：
 * 上游调用从「每请求 1 次」降到「每 45 秒 1 次」。
 * 代价是真实掉线最多晚这么多秒被发现，那时探测会重新回源并返回 401（前端照旧提示重新扫码）；
 * 探测失败一律不记忆，所以教务抖动不会把用户误判成退出登录。
 */
const PROBE_TTL_DEFAULT = 45_000;

function probeTtl() {
  const raw = process.env.JWXT_SESSION_PROBE_TTL_MS;
  if (raw === undefined || raw === '') return PROBE_TTL_DEFAULT;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : PROBE_TTL_DEFAULT;
}

// Share only in-flight probes, never cache a successful authentication result.
const probes = new WeakMap();
// session -> 上次确认存活的时间戳（WeakMap 按会话对象记，登录态轮换后自动失效，不会跨会话串味）
const lastAlive = new WeakMap();

export async function sessionAlive(ctx) {
  const session = ctx.session;
  if (!session) return false;
  const ttl = probeTtl();
  if (ttl > 0) {
    const seen = lastAlive.get(session);
    if (seen !== undefined && Date.now() - seen < ttl) return ctx.session === session;
  }
  let pending = probes.get(session);
  if (!pending) {
    pending = checkSession(session)
      .then((alive) => {
        if (alive) lastAlive.set(session, Date.now());
        return alive;
      })
      .finally(() => probes.delete(session));
    probes.set(session, pending);
  }
  const alive = await pending;
  return ctx.session === session && alive;
}
