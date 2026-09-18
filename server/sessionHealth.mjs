export async function sessionAlive(ctx) {
  if (!ctx.session) return false;
  try {
    // SetMainInfo.jsp 会输出当前登录账号；未登录时为 kingo.guest
    const info = await ctx.session.text('/ahsljw/frame/home/js/SetMainInfo.jsp', { method: 'GET' });
    if (info.status !== 200) throw Object.assign(new Error('会话状态暂时无法验证'), { status: 503 });
    if (info.status === 200) {
      if (/kingo\.guest/i.test(info.text)) return false;
      if (/_loginid\s*=\s*'[^']+'/.test(info.text)) return true;
    }
    if (!ctx.session.landingUrl) throw Object.assign(new Error('无法识别教务会话状态'), { status: 502 });
    const res = await ctx.session.text(ctx.session.landingUrl, { method: 'GET' });
    if (res.status !== 200) throw Object.assign(new Error('会话状态暂时无法验证'), { status: 503 });
    if (/cas\/login\.action|未登录|登录超时|重新登录|会话已过期/i.test(res.text)) return false;
    return true;
  } catch (error) {
    if (error.status === 401) return false;
    throw error;
  }
}

