/*
 * 单文件 exe 入口（Node SEA）。
 * 也可直接用 node 运行（需 Node ≥20.19 或 ≥22.12）：node tools/exe/main.cjs
 *
 * 运行时把内嵌的 web/dist 释放到用户数据目录，把后端（API + 静态资源）起在
 * 127.0.0.1，并自动打开浏览器。无需安装 Node；扫码登录和查询仍需要网络。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

const dataDir = process.env.TEACHER_DESK_DATA || path.join(os.homedir(), '.teacher-desk');
const distDir = process.env.WEB_DIST || path.join(dataDir, 'web-dist');

function extractAssets() {
  try {
    const sea = require('node:sea');
    if (typeof sea.isSea !== 'function' || !sea.isSea()) return;
    const keys = typeof sea.getAssetKeys === 'function' ? sea.getAssetKeys() : [];
    for (const key of keys) {
      if (!key.startsWith('dist/')) continue;
      const rel = key.slice('dist/'.length).replace(/\\/g, '/');
      const out = path.join(distDir, rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(sea.getAsset(key)));
    }
  } catch {
    /* 非 SEA 运行，忽略 */
  }
}

fs.mkdirSync(dataDir, { recursive: true });
extractAssets();

process.env.APP_ROOT = process.env.APP_ROOT || dataDir;
process.env.WEB_DIST = distDir;
process.env.SESSION_DIR = process.env.SESSION_DIR || path.join(dataDir, 'sessions');
process.env.HOST = process.env.HOST || '127.0.0.1';

function pickPort(port, cb) {
  if (port > 65535) return cb(8790);
  const probe = net.createServer();
  probe.once('error', () => pickPort(port + 1, cb));
  probe.once('listening', () => {
    const chosen = probe.address().port;
    probe.close(() => cb(chosen));
  });
  probe.listen(port, '127.0.0.1');
}

pickPort(Number(process.env.PORT) || 8790, (port) => {
  process.env.PORT = String(port);
  require('../../server/index.mjs');
  console.log('');
  console.log(`  教师工作台已启动： http://127.0.0.1:${port}`);
  console.log(`  数据目录： ${dataDir}`);
  console.log('  关闭此窗口即退出服务。');
  console.log('');
  setTimeout(() => {
    try {
      spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${port}`], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* 打不开浏览器时忽略 */
    }
  }, 1200);
});
