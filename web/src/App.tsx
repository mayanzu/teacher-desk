import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, isUnauthorized } from './api';
import { AppHeader } from './components/AppHeader';
import { GitHubIcon } from './components/Icons';
import { LoginPage } from './components/LoginPage';
import { ModulePage } from './components/ModulePage';
import { EmptyState, ErrorState, LoadingState } from './components/StateViews';
import { WeekSchedule } from './components/WeekSchedule';
import { fallbackTerms } from './lib/schedule';
import type { ModuleKey, PageKey, SessionData, Term } from './types';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [bootAttempt, setBootAttempt] = useState(0);
  const [session, setSession] = useState<SessionData>({ loggedIn: false, username: '' });
  const [terms, setTerms] = useState<Term[]>([]);
  const [termsError, setTermsError] = useState('');
  const [termsFallback, setTermsFallback] = useState(false);
  const [term, setTerm] = useState('');
  const [page, setPage] = useState<PageKey>('schedule');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBooting(true);
    setBootError('');
    (async () => {
      try {
        await api.health();
        const current = await api.session();
        if (!cancelled) setSession(current);
      } catch (err) {
        if (!cancelled) setBootError(errorMessage(err));
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  useEffect(() => {
    if (!session.loggedIn) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const current = await api.session();
          if (!cancelled && !current.loggedIn) setSession({ loggedIn: false, username: '' });
        } catch {
          /* 网络抖动忽略，等下次心跳 */
        }
      })();
    }, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session.loggedIn]);

  useEffect(() => {
    if (!session.loggedIn) return;
    let cancelled = false;
    setTermsError('');
    (async () => {
      try {
        const payload = await api.terms();
        if (cancelled) return;
        const fallback = payload.terms.length === 0 ? fallbackTerms() : null;
        const list = fallback ? fallback.terms : payload.terms;
        const preferred = payload.current || (fallback ? fallback.current : list[0]?.value || '');
        setTerms(list);
        setTermsFallback(Boolean(fallback));
        setTerm((previous) => (previous && list.some((item) => item.value === previous) ? previous : preferred));
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          setSession({ loggedIn: false, username: '' });
          return;
        }
        setTermsError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.loggedIn]);

  const handleLoggedIn = useCallback(async () => {
    try {
      const current = await api.session();
      setSession(current);
    } catch {
      setSession({ loggedIn: true, username: '' });
    }
  }, []);

  const handleUnauthorized = useCallback(() => {
    setSession({ loggedIn: false, username: '' });
    setTerms([]);
    setTerm('');
    setTermsFallback(false);
  }, []);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await api.logout();
    } catch {
      /* 服务端不可用时也要让本地退出 */
    }
    setSession({ loggedIn: false, username: '' });
    setTerms([]);
    setTerm('');
    setTermsError('');
    setTermsFallback(false);
    setPage('schedule');
    setLoggingOut(false);
  }, []);

  if (booting) {
    return (
      <div className="boot-screen">
        <div className="panel-card">
          <LoadingState message="正在连接教务系统…" />
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="boot-screen">
        <div className="panel-card">
          <ErrorState
            title="无法连接后端服务"
            message={`${bootError}（请确认 127.0.0.1:8790 已启动，开发环境由 Vite 代理 /api）`}
            onRetry={() => setBootAttempt((value) => value + 1)}
          />
        </div>
      </div>
    );
  }

  if (!session.loggedIn) {
    return <LoginPage onLoggedIn={handleLoggedIn} />;
  }

  return (
    <div className="app">
      <AppHeader
        username={session.username}
        terms={terms}
        term={term}
        onTermChange={setTerm}
        page={page}
        onPageChange={setPage}
        onLogout={handleLogout}
        loggingOut={loggingOut}
      />

      <main id="main" className="app-main">
        {termsFallback && (
          <p className="notice-bar" role="status">
            <b>注意</b>
            /api/terms 返回的学期列表为空，已在顶部使用本地推算的学期下拉；课表数据仍实时取自教务系统，如某学期为空请切换学期。
          </p>
        )}

        {termsError && (
          <section className="section">
            <div className="panel-card">
              <ErrorState title="学期列表加载失败" message={termsError} onRetry={() => setTerm((value) => value)} />
            </div>
          </section>
        )}

        {!termsError && !term && (
          <section className="section">
            <div className="panel-card">
              <EmptyState title="没有可用的学期" message="教务系统未返回学期列表，无法加载课表。" hint="请稍后重试，或重新登录。" />
            </div>
          </section>
        )}

        {!termsError && term && page === 'schedule' && <WeekSchedule key="schedule" term={term} onUnauthorized={handleUnauthorized} />}
        {!termsError && term && page !== 'schedule' && (
          <ModulePage key={page} module={page as ModuleKey} term={term} onUnauthorized={handleUnauthorized} />
        )}
      </main>

      <footer className="footer">
        <div>
          <p>
            数据来源：高校教务系统 · 通过本地代理 <b>/api</b> 读取，不缓存也不上传到第三方。
          </p>
          <p>扫码仅支持「喜鹊儿」App；如遇登录过期，页面会自动回到扫码登录页。</p>
          <p className="footer-github">
            <a
              className="footer-link"
              href="https://github.com/mayanzu/teacher-desk"
              target="_blank"
              rel="noreferrer noopener"
            >
              <GitHubIcon aria-hidden="true" />
              <span>mayanzu/teacher-desk</span>
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
