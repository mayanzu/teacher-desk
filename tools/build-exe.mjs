/*
 * 打包免安装 Node 的单文件 exe（Node SEA / Single Executable Application）。
 * 用法： node tools/build-exe.mjs
 * 产物： build/exe/teacher-desk.exe
 *
 * 只免除安装 Node；扫码登录与查询仍需网络。
 * 步骤：构建前端 → esbuild 打成单文件 CJS → 生成 SEA blob → 注入 node.exe。
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const exeDir = join(root, 'build', 'exe');
const bundlePath = join(exeDir, 'bundle.cjs');
const configPath = join(exeDir, 'sea-config.json');
const blobPath = join(exeDir, 'sea-prep.blob');
const outExe = join(exeDir, 'teacher-desk.exe');
const distDir = join(root, 'web', 'dist');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
};

// 1) 构建前端
run('npm run build');
if (!existsSync(join(distDir, 'index.html'))) throw new Error('web/dist 构建失败');

// 2) 打包服务端为单文件 CJS（tools/bundle-server.mjs：处理 pdfkit 的包内 imports 与 ICC 顶层 URL，
//    裸 esbuild 打出来的产物会启动即崩）
mkdirSync(exeDir, { recursive: true });
run(`node tools/bundle-server.mjs "${bundlePath}" tools/exe/main.cjs`);

// 3) 收集 web/dist 作为内嵌资源
const assets = {};
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else assets[`dist/${relative(distDir, full).split('\\').join('/')}`] = full;
  }
})(distDir);

writeFileSync(
  configPath,
  JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true, assets }, null, 2),
);

// 4) 生成 SEA blob
run(`node --experimental-sea-config "${configPath}"`);

// 5) 拷贝当前 node 并注入 blob
copyFileSync(process.execPath, outExe);
run(`npx --yes postject "${outExe}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse ${FUSE}`);

console.log(`\n✅ 已生成: ${outExe}`);
