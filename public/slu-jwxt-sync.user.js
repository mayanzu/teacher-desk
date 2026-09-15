// ==UserScript==
// @name         安徽三联学院教务课表同步
// @namespace    https://github.com/mayanzu/teacher-timetable
// @version      1.0.0
// @description  扫码登录教务系统后，将课表安全同步到通用教师课表系统
// @match        https://jwxt.slu.edu.cn:4060/ahsljw/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const MESSAGE_TYPE = 'SLU_JWXT_SYNC_V1';
  const match = String(window.name || '').match(/^slu-sync:([^|]+)\|(.+)$/);
  if (!match) return;

  const token = match[1];
  const appOrigin = match[2];
  let started = false;

  function panel(message, kind) {
    let root = document.getElementById('teacher-timetable-sync-panel');
    if (!root) {
      root = document.createElement('div');
      root.id = 'teacher-timetable-sync-panel';
      Object.assign(root.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: '2147483647',
        maxWidth: '360px',
        padding: '14px 16px',
        color: '#1c1c22',
        background: '#fffdf6',
        border: '3px solid #1c1c22',
        borderRadius: '12px',
        boxShadow: '5px 5px 0 #1c1c22',
        font: '800 13px/1.6 "Microsoft YaHei", sans-serif',
      });
      document.body.appendChild(root);
    }
    const colors = { wait: '#ffe66f', ok: '#d9f0e4', error: '#ffd9d5' };
    root.style.background = colors[kind] || colors.wait;
    root.textContent = message;
  }

  function isLoginPage() {
    return location.pathname.includes('/cas/login.action');
  }

  function isDashboard() {
    return location.pathname.includes('/frame/homes.action') || document.body.innerText.includes('教学综合管理服务平台');
  }

  function currentSemester() {
    const text = document.body.innerText || '';
    const label = text.match(/\d{4}-\d{4}学年(?:第[一二]学期)?/)?.[0] || '';
    const year = Number(label.match(/^(\d{4})-/)?.[1] || new Date().getFullYear());
    const term = label.includes('第二学期') ? 1 : 0;
    return { label, year, term };
  }

  function currentTeacher() {
    const text = document.body.innerText || '';
    return text.match(/\[[^\]]+\]\s*([^\s]+)/)?.[1] || '';
  }

  async function syncSchedule() {
    if (started) return;
    started = true;
    panel('正在读取教务系统课表…', 'wait');
    try {
      const semester = currentSemester();
      const endpoint = new URL('/ahsljw/frame/desk/showLessonScheduleInfosV14.action', location.origin);
      endpoint.searchParams.set('xn', String(semester.year));
      endpoint.searchParams.set('xq', String(semester.term));
      endpoint.searchParams.set('jxz', '3');
      const response = await fetch(endpoint.toString(), { credentials: 'include' });
      if (!response.ok) throw new Error('课表接口返回 ' + response.status);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const table = doc.querySelector('table');
      if (!table) throw new Error('没有在返回内容中找到课表表格');
      if (!window.opener) throw new Error('课表系统窗口已关闭，请重新发起扫码同步');
      window.opener.postMessage({
        type: MESSAGE_TYPE,
        token,
        html: table.outerHTML,
        teacher: currentTeacher(),
        semesterLabel: semester.label,
      }, appOrigin);
      panel('课表已同步，正在返回课表系统…', 'ok');
      setTimeout(() => window.close(), 1200);
    } catch (error) {
      panel('同步失败：' + (error && error.message ? error.message : '未知错误'), 'error');
      started = false;
    }
  }

  function waitForLogin() {
    panel('请使用手机扫码登录教务系统…', 'wait');
    const timer = setInterval(() => {
      if (isLoginPage()) return;
      if (!isDashboard()) return;
      clearInterval(timer);
      void syncSchedule();
    }, 1000);
    setTimeout(() => clearInterval(timer), 5 * 60 * 1000);
  }

  if (isDashboard() && !isLoginPage()) void syncSchedule();
  else waitForLogin();
})();
