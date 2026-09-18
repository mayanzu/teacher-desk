export async function getTerms(session) {
  // Ms_XNXQ 为全量学年学期字典（历史 + 未来），而 Ms_FBAP_XNXQ(kgmc=kb_fbxqlljxrw)
  // 只返回课表/教学任务相关的学期，会漏掉有成绩等历史数据的学期。
  const res = await session.postForm(
    '/ahsljw/frame/droplist/getDropLists.action',
    {
      comboBoxName: 'Ms_XNXQ',
      paramValue: '',
      isYXB: '0',
      isCDDW: '0',
      isXQ: '0',
      isDJKSLB: '0',
      isZY: '0',
    },
    { headers: { 'X-Requested-With': 'XMLHttpRequest' } },
  );
  const list = (() => {
    try {
      const parsed = JSON.parse(res.text);
      if (!Array.isArray(parsed)) throw new Error('invalid terms');
      return parsed;
    } catch {
      throw Object.assign(new Error('学期列表响应异常，请重试'), { status: 502 });
    }
  })();
  let terms = list
    .map((item) => {
      const code = String(item.code ?? '').trim();
      // Ms_XNXQ 的 code 形如 "20241"，统一成 "2024,1"
      const value = /^\d{5}$/.test(code) ? `${code.slice(0, 4)},${code.slice(4)}` : code;
      return { value, label: String(item.name ?? '') };
    })
    .filter((item) => /^\d{4},\d$/.test(item.value));

  // 当前学期以教务返回为准：过滤掉尚未开始的未来学期，并把当前学期置顶
  let current = '';
  try {
    const cur = await session.text('/ahsljw/jw/common/showYearTerm.action', { method: 'POST' });
    const data = JSON.parse(cur.text);
    if (data?.xn && data?.xqM !== undefined) current = `${data.xn},${data.xqM}`;
  } catch {
    /* 忽略：保留全部学期 */
  }

  if (/^\d{4},\d$/.test(current)) {
    const [curXn, curXq] = current.split(',').map(Number);
    terms = terms.filter((item) => {
      const [xn, xq] = item.value.split(',').map(Number);
      return xn < curXn || (xn === curXn && xq <= curXq);
    });
    const index = terms.findIndex((item) => item.value === current);
    if (index > 0) terms.unshift(terms.splice(index, 1)[0]);
  }
  return terms;
}

