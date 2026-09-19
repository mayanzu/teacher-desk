/*
 * 构建后为文本静态资源生成预压缩 .gz（review R12）。
 * 服务端（server/index.mjs serveStatic）优先返回同名 .gz，避免同一个 hash 资源
 * 在每次 200 响应里重复 readFile + gzip。
 *
 * 用法：node tools/precompress.mjs（npm run build 已自动调用）
 * 可用 WEB_DIST 指定 dist 目录。
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = process.env.WEB_DIST || join(root, 'web', 'dist');
const EXTENSIONS = new Set(['.js', '.css', '.html', '.svg', '.json', '.webmanifest']);
const MIN_BYTES = 1024;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

let missing = false;
try {
  await stat(dist);
} catch {
  missing = true;
}

if (missing) {
  console.warn(`[precompress] 跳过：未找到 ${dist}`);
} else {
  let count = 0;
  let saved = 0;
  for (const file of await walk(dist)) {
    if (file.endsWith('.gz')) continue;
    if (!EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const info = await stat(file);
    if (info.size < MIN_BYTES) continue;
    const body = await readFile(file);
    const compressed = gzipSync(body, { level: 9 });
    if (compressed.length >= body.length) continue;
    await writeFile(`${file}.gz`, compressed);
    count += 1;
    saved += body.length - compressed.length;
  }
  console.log(`[precompress] ${count} 个文件，节省 ${(saved / 1024).toFixed(1)} KiB`);
}
