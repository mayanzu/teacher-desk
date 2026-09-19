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


// Share only in-flight probes, never cache a successful authentication result.
const probes = new WeakMap();
export async function sessionAlive(ctx) {
  const session = ctx.session;
  if (!session) return false;
  let pending = probes.get(session);
  if (!pending) {
    pending = checkSession(session).finally(() => probes.delete(session));
    probes.set(session, pending);
  }
  const alive = await pending;
  return ctx.session === session && alive;
}
