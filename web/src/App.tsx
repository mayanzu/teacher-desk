import { useCallback, useEffect, useState } from 'react';
import { api, clearApiCache, preloadTerm, errorMessage, isUnauthorized } from './api';
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
  const [termsAttempt, setTermsAttempt] = useState(0);
  const [termsError, setTermsError] = useState('');
  const [termsFallback, setTermsFallback] = useState(false);
  const [term, setTerm] = useState('');
  const [page, setPage] = useState<PageKey>('schedule');
  const [loggingOut, setLoggingOut] = useState(false);
  const [termsLoading, setTermsLoading] = useState(false);
  const [progressDirty, setProgressDirty] = useState(false);

  const resetSessionState = useCallback(() => {
    clearApiCache();
    setSession({ loggedIn: false, username: '' });
    setTerms([]);
    setTerm('');
    setTermsError('');
    setTermsFallback(false);
    setProgressDirty(false);
    setPage('schedule');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBooting(true);
    setBootError('');
    (async () => {
      try {
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

  // 心跳：前一次完成后才安排下一次；不可见时暂停；失败指数退避 + 抖动（review R15）。
  useEffect(() => {
    if (!session.loggedIn) return;
    let cancelled = false;
    let timer = 0;
    let failures = 0;
    const hidden = () => typeof document !== 'undefined' && document.hidden === true;
    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = window.setTimeout(tick, delay);
    };
    const tick = async () => {
      if (cancelled) return;
      if (hidden()) {
        schedule(60000);
        return;
      }
      try {
        const current = await api.session();
        if (cancelled) return;
        failures = 0;
        if (!current.loggedIn || current.username !== session.username) {
          resetSessionState();
          return;
        }
        schedule(60000);
      } catch {
        // 失败退避并加抖动，避免多标签在同一时刻重试
        failures = Math.min(failures + 1, 4);
        schedule(Math.min(30000 * 2 ** failures, 300000) + Math.floor(Math.random() * 5000));
      }
    };
    const onVisible = () => {
      if (hidden()) return;
      window.clearTimeout(timer);
      void tick();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    schedule(60000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session.loggedIn, session.username, resetSessionState]);

  useEffect(() => {
    if (!session.loggedIn) return;
    let cancelled = false;
    setTermsError('');
    setTermsLoading(true);
    (async () => {
      try {
        const payload = await api.terms({ refresh: termsAttempt > 0 });
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
          resetSessionState();
          return;
        }
        setTermsError(errorMessage(err));
      } finally {
        if (!cancelled) setTermsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.loggedIn, termsAttempt, resetSessionState]);

  useEffect(() => {
    if (!session.loggedIn || !term) return;
    return preloadTerm(term, resetSessionState);
  }, [session.loggedIn, term, resetSessionState]);

  const handleLoggedIn = useCallback(async () => {
    clearApiCache();
    try {
      const current = await api.session();
      setSession(current);
    } catch {
      setSession({ loggedIn: true, username: '' });
    }
  }, []);

  const handleUnauthorized = useCallback(() => {
    resetSessionState();
  }, [resetSessionState]);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await api.logout();
    } catch {
      /* 服务端不可用时也要让本地退出 */
    }
    resetSessionState();
    setLoggingOut(false);
  }, [resetSessionState]);

  const handleTermChange = useCallback(
    (next: string) => {
      if (next === term) return;
      if (progressDirty && !window.confirm('教学进度有未提交的修改，切换学期后将丢失，确定继续？')) return;
      setProgressDirty(false);
      setTerm(next);
    },
    [progressDirty, term],
  );

  const handlePageChange = useCallback(
    (next: PageKey) => {
      if (next === page) return;
      if (progressDirty && !window.confirm('教学进度有未提交的修改，切换页面后将丢失，确定继续？')) return;
      setProgressDirty(false);
      setPage(next);
    },
    [progressDirty, page],
  );

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
        onTermChange={handleTermChange}
        page={page}
        onPageChange={handlePageChange}
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
              <ErrorState title="学期列表加载失败" message={termsError} onRetry={() => setTermsAttempt((value) => value + 1)} />
            </div>
          </section>
        )}

        {!termsError && !term && termsLoading && (
          <section className="section">
            <div className="panel-card">
              <LoadingState message="正在加载学期列表…" />
            </div>
          </section>
        )}

        {!termsError && !term && !termsLoading && (
          <section className="section">
            <div className="panel-card">
              <EmptyState title="没有可用的学期" message="教务系统未返回学期列表，无法加载课表。" hint="请稍后重试，或重新登录。" />
            </div>
          </section>
        )}

        {!termsError && term && page === 'schedule' && <WeekSchedule key={`schedule:${session.username}`} userId={session.username} term={term} onUnauthorized={handleUnauthorized} />}
        {!termsError && term && page !== 'schedule' && (
          <ModulePage key={`${page}:${term}`} module={page as ModuleKey} term={term} onUnauthorized={handleUnauthorized} onDirtyChange={setProgressDirty} />
        )}
      </main>

      <footer className="footer">
        <div>
          <p>
            数据来源：高校教务系统 · 通过本地代理 <b>/api</b> 读取；服务端短暂缓存查询结果，便利贴保存在当前浏览器。
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
