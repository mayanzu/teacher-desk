/*
 * 打包 Windows 便携版 ZIP（免安装 Node，解压双击即用）。
 * 用法： node tools/build-portable.mjs
 * 产物： build/teacher-desk-portable-win-x64.zip
 *
 * 组成：
 *   teacher-desk-portable/
 *     node.exe       官方原版 Node 运行时（保留官方签名，VirusTotal/SmartScreen 友好）
 *     bundle.cjs     后端（esbuild 单文件，含全部依赖）
 *     web/           前端静态资源
 *     启动.cmd        双击启动（起本地服务 + 打开浏览器）
 *     使用说明.txt
 */
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dest, entry);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = join(root, 'build', 'portable');
const bundlePath = join(outDir, 'bundle.cjs');
const distDir = join(root, 'web', 'dist');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
};

// 1) 构建前端
run('npm run build');
if (!existsSync(join(distDir, 'index.html'))) throw new Error('web/dist 构建失败');

// 2) 清空输出目录并打包后端为单文件
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
run(`npx --yes esbuild tools/exe/main.cjs --bundle --platform=node --format=cjs --target=node22 --outfile="${bundlePath}"`);

// 3) 拷贝官方 node.exe + 前端资源
copyFileSync(process.execPath, join(outDir, 'node.exe'));
copyDir(distDir, join(outDir, 'web'));

// 4) 启动脚本与说明
writeFileSync(
  join(outDir, '启动.cmd'),
  [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'set "TEACHER_DESK_DATA=%~dp0data"',
    'set "WEB_DIST=%~dp0web"',
    'set "HOST=127.0.0.1"',
    'echo 正在启动教师工作台，浏览器将自动打开…',
    '"%~dp0node.exe" "%~dp0bundle.cjs"',
    'echo.',
    'echo 服务已退出。按任意键关闭窗口。',
    'pause >nul',
  ].join('\r\n'),
  'utf8',
);
writeFileSync(
  join(outDir, '使用说明.txt'),
  [
    '教师工作台 · Windows 便携版',
    '',
    '1. 解压本压缩包到任意目录（建议不要放在 C:\\Program Files 下）。',
    '2. 双击「启动.cmd」。',
    '3. 浏览器会自动打开 http://127.0.0.1:8790（被占用时端口自动顺延）。',
    '4. 用「喜鹊儿」App 扫码登录。',
    '5. 关闭命令行窗口即退出。',
    '',
    '说明：',
    '- 免安装 Node，所有数据都在本目录的 data\\ 下，删除即重置。',
    '- 本程序仅访问学校教务系统，不联网安装任何东西。',
    '- 若首次运行弹出「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」。',
  ].join('\r\n'),
  'utf8',
);

// 5) 打包 zip（Windows 自带 tar 支持按扩展名创建 zip）
const zipPath = join(root, 'build', 'teacher-desk-portable-win-x64.zip');
rmSync(zipPath, { force: true });
console.log(`\n$ tar -a -c -f ${zipPath}`);
execFileSync('tar.exe', ['-a', '-c', '-f', zipPath, '-C', outDir, '.'], { cwd: root, stdio: 'inherit' });

console.log(`\n✅ 已生成: ${zipPath}`);
