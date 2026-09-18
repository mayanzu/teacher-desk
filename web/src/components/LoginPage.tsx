import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import type { LoginState } from '../types';
import { AlertTriangle, CheckCircle2, QrCodeIcon, RefreshCw, ScanLine } from './Icons';

const POLL_INTERVAL = 1500;

type Phase = 'starting' | 'waiting' | 'success' | 'error';

interface LoginPageProps {
  onLoggedIn: () => void;
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [message, setMessage] = useState('正在生成二维码…');
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const loggedInRef = useRef(onLoggedIn);
  loggedInRef.current = onLoggedIn;

  const start = useCallback(async () => {
    setPhase('starting');
    setError('');
    setMessage('正在生成二维码…');
    setQrDataUrl('');
    setRemaining(0);
    try {
      const payload = await api.loginStart();
      setQrDataUrl(payload.qrDataUrl);
      setRemaining(Math.max(0, Math.round(payload.expiresIn)));
      setPhase('waiting');
      setMessage('等待使用「喜鹊儿」App 扫码…');
    } catch (err) {
      setPhase('error');
      setError(errorMessage(err));
      setMessage('二维码生成失败');
    }
  }, []);

  useEffect(() => {
    void start();
  }, [attempt, start]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      let next: LoginState | null = null;
      try {
        next = await api.loginStatus();
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setError(errorMessage(err));
        return;
      }
      if (cancelled || !next) return;
      if (next.message) setMessage(next.message);
      if (next.status === 'success') {
        setPhase('success');
        setMessage(next.message || '登录成功');
        return;
      }
      if (next.status === 'error') {
        setPhase('error');
        setError(next.message || '登录失败，请重新生成二维码');
        return;
      }
      timer = window.setTimeout(tick, POLL_INTERVAL);
    };

    timer = window.setTimeout(tick, POLL_INTERVAL);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [phase, attempt]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const timer = window.setInterval(() => {
      setRemaining((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === 'waiting' && remaining === 0) {
      setPhase('error');
      setError('二维码已过期，请重新生成');
    }
  }, [phase, remaining]);

  useEffect(() => {
    if (phase === 'success') loggedInRef.current();
  }, [phase]);

  const expired = phase === 'error';

  return (
    <div className="login-page">
      <div className="login-hero">
        <span className="comic-kicker">JWXT · TEACHER CONSOLE</span>
        <h1 className="login-title">
          教师<span>工作台</span>
        </h1>
        <p className="login-sub">扫码一次，课表、任务、进度、成绩，一屏搞定。</p>
        <ul className="login-bullets">
          <li>只认「喜鹊儿」App 扫一扫</li>
          <li>微信 / 相机 / 其他扫码器识别无效</li>
          <li>登录态过期会自动回到本页</li>
        </ul>
      </div>

      <div className="panel-card login-card">
        <div className="qr-frame" aria-live="polite">
          {qrDataUrl ? (
            <img className="qr-image" src={qrDataUrl} alt="喜鹊儿 App 登录二维码" width={260} height={260} />
          ) : (
            <div className="qr-placeholder">
              {expired ? <AlertTriangle aria-hidden="true" /> : <QrCodeIcon aria-hidden="true" />}
              <span>{expired ? '二维码已失效' : '二维码生成中…'}</span>
            </div>
          )}
          {phase === 'waiting' && <span className="qr-scanline" aria-hidden="true" />}
        </div>

        <div className={`login-status${phase === 'error' ? ' is-error' : ''}${phase === 'success' ? ' is-ok' : ''}`} role="status">
          {phase === 'success' ? <CheckCircle2 aria-hidden="true" /> : <ScanLine aria-hidden="true" />}
          <span>{phase === 'success' ? '登录成功，正在进入工作台…' : message}</span>
        </div>

        {phase === 'error' && error && (
          <p className="login-error" role="alert">
            <AlertTriangle aria-hidden="true" />
            {error}
          </p>
        )}

        {phase === 'waiting' && remaining > 0 && <p className="login-countdown">二维码剩余有效期 {remaining} 秒</p>}

        <div className="login-actions">
          <button className="kbtn primary" type="button" disabled={phase === 'starting' || phase === 'success'} onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw aria-hidden="true" />
            重新生成二维码
          </button>
        </div>

        <ol className="login-steps">
          <li>打开手机上的「喜鹊儿」App</li>
          <li>进入扫一扫，对准上方二维码</li>
          <li>在手机上确认登录，本页会自动跳转</li>
        </ol>
      </div>
    </div>
  );
}
