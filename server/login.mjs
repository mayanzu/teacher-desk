import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { config } from './config.mjs';
import { JwxtSession } from './session.mjs';

const FORM = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function completeQrLogin(session, qrCode, username) {
  const result = await session.postForm(
    '/ahsljw/cas/logon.action',
    { username, password: qrCode, loginmethod: 'xiqueer' },
  );
  let data = null;
  try {
    data = JSON.parse(result.text);
  } catch {
    data = null;
  }
  if (result.status !== 200 || !data) {
    const snippet = String(result.text || '').replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(`登录响应异常（HTTP ${result.status}）${snippet ? `：${snippet}` : ''}`);
  }
  if (String(data.status) !== '200') throw new Error(`登录被拒绝：${data.message || data.status}`);
  const landingUrl = data.result || '';
  const landing = landingUrl ? await session.text(landingUrl) : null;
  if (landingUrl) session.landingUrl = landingUrl;
  session.username = username;
  return { username, landingUrl, landing };
}

export function createLoginFlow() {
  let session = new JwxtSession();
  const state = { status: 'idle', message: '', username: '', qrCode: '', qrDataUrl: '', expiresAt: 0 };
  let timer = null;
  let generation = 0;

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function poll(token = generation, activeSession = session, qrCode = state.qrCode) {
    if (token !== generation) return;
    if (state.status !== 'waiting') return;
    if (Date.now() > state.expiresAt) {
      state.status = 'error';
      state.message = '二维码已过期，请重新生成';
      return stop();
    }
    try {
      const res = await activeSession.postForm('/ahsljw/frame/LoginBar.jsp', { operate: 'query', qrCode });
      if (token !== generation) return;
      const username = res.text.trim();
      if (username) {
        state.message = '已扫码，正在登录…';
        try {
          await completeQrLogin(activeSession, qrCode, username);
          if (token !== generation) return;
          state.status = 'success';
          state.username = username;
          state.message = '登录成功';
        } catch (error) {
          if (token !== generation) return;
          state.status = 'error';
          state.message = error instanceof Error ? error.message : '登录失败';
        }
        return stop();
      }
      state.message = '等待使用「喜鹊儿」App 扫码…';
    } catch (error) {
      if (token !== generation) return;
      state.message = `状态查询失败：${error instanceof Error ? error.message : error}`;
    }
    if (token === generation) timer = setTimeout(() => poll(token, activeSession, qrCode), config.pollMs);
  }

  async function start() {
    stop();
    const token = ++generation;
    state.status = 'starting';
    // 每次生成二维码都使用全新会话，避免复用上一次的登录态导致登录失败
    session = new JwxtSession();
    const activeSession = session;
    const page = await activeSession.text('/ahsljw/cas/login.action');
    if (token !== generation) throw Object.assign(new Error('登录请求已取消'), { status: 409 });
    if (page.status !== 200) throw new Error(`无法打开登录页：HTTP ${page.status}`);
    state.qrCode = `smdljwxt${randomBytes(16).toString('hex')}`;
    const qrDataUrl = await QRCode.toDataURL(state.qrCode, { margin: 1, width: 480 });
    if (token !== generation) throw Object.assign(new Error('登录请求已取消'), { status: 409 });
    state.qrDataUrl = qrDataUrl;
    state.status = 'waiting';
    state.message = '等待使用「喜鹊儿」App 扫码…';
    state.expiresAt = Date.now() + config.qrTimeoutMs;
    timer = setTimeout(() => poll(token, activeSession, state.qrCode), 1200);
    return { qrDataUrl: state.qrDataUrl, expiresIn: Math.floor(config.qrTimeoutMs / 1000) };
  }

  const reset = () => {
    ++generation;
    stop();
    session = new JwxtSession();
    state.status = 'idle';
    state.message = '';
    state.username = '';
    state.qrCode = '';
    state.qrDataUrl = '';
  };

  return { getSession: () => session, state, start, reset, stop };
}

export { FORM, sleep };
