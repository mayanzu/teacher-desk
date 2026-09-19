/*
 * 把后端打成单文件 CJS（exe / 便携版共用）。
 * 用法：node tools/bundle-server.mjs <输出文件路径> [入口= tools/exe/main.cjs]
 *
 * 为什么不用 `npx esbuild` 直接打：
 * pdfkit 0.20 用了两样 esbuild 处理不了的写法，裸 bundling 出来的产物**启动就崩**：
 *   1) `const require$1 = createRequire(import.meta.url)` + `require$1('#standard-fonts/Helvetica')`
 *      —— package.json 的 imports 映射不会被 esbuild 解析，CJS 产物里 import.meta.url 也不是文件路径，
 *         运行时直接 "Cannot find module '#standard-fonts/Helvetica'"。
 *   2) `const ICC_PROFILE_PATH = new URL('./data/sRGB_IEC61966_2_1.icc', import.meta.url).href`
 *      —— 顶层求值，import.meta.url 不是绝对 URL 时抛 ERR_INVALID_URL，进程直接退出。
 * 这里的处理：把标准字体静态打进产物（14 个文件共 192K），ICC 路径换成不依赖文件系统的 data URL
 * （该文件只在启用色彩管理时才读取，本项目的 PDF 不读它）。
 */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [, , outfile, entry] = process.argv;
if (!outfile) {
  console.error('用法: node tools/bundle-server.mjs <输出文件路径> [入口]');
  process.exit(2);
}

const PDFKIT = join(root, 'node_modules/pdfkit');
const STANDARD_FONTS = ['Courier', 'CourierBold', 'CourierBoldOblique', 'CourierOblique', 'Helvetica', 'HelveticaBold', 'HelveticaBoldOblique', 'HelveticaOblique', 'Symbol', 'TimesBold', 'TimesBoldItalic', 'TimesItalic', 'TimesRoman', 'ZapfDingbats'];
const VIRTUAL_FONTS = 'pdfkit-standard-fonts';

const plugin = {
  name: 'pdfkit-bundle-fixes',
  setup(b) {
    // 标准字体：虚拟模块静态导入全部 14 个，导出按名字取用的函数
    b.onResolve({ filter: new RegExp(`^${VIRTUAL_FONTS}$`) }, () => ({ path: VIRTUAL_FONTS, namespace: 'pdfkit-fonts' }));
    b.onLoad({ filter: /.*/, namespace: 'pdfkit-fonts' }, () => ({
      contents: [
        ...STANDARD_FONTS.map((name, i) => `import font${i} from ${JSON.stringify(join(PDFKIT, 'js/standard-fonts', `${name}.cjs`))};`),
        `const table = { ${STANDARD_FONTS.map((name, i) => `${JSON.stringify(name)}: font${i}`).join(', ')} };`,
        'export default function standardFont(name) {',
        "  if (!Object.prototype.hasOwnProperty.call(table, name)) throw new Error('未内置的标准字体: ' + name);",
        '  return table[name];',
        '}',
      ].join('\n'),
      loader: 'js',
      resolveDir: root,
    }));

    // #fs / #zlib / #stream：package.json imports 的条件分支，直接指到 node 版实现
    b.onResolve({ filter: /^#fs$/ }, () => ({ path: join(PDFKIT, 'lib/fs/node.js') }));
    b.onResolve({ filter: /^#zlib$/ }, () => ({ path: join(PDFKIT, 'lib/zlib/node.js') }));
    b.onResolve({ filter: /^#stream$/ }, () => ({ path: join(PDFKIT, 'lib/stream/node.js') }));

    // pdfkit 主文件：改写标准字体的动态 require 与 import.meta.url
    // （require 条件走 js/pdfkit.js，import 条件走 js/pdfkit.node.mjs，两个都覆盖）
    b.onLoad({ filter: /pdfkit[\\/]js[\\/]pdfkit(\.node)?\.(mjs|cjs|js)$/ }, async (args) => {
      let src = await readFile(args.path, 'utf8');
      let hits = 0;
      src = src.replace(/require\$\d*\('#standard-fonts\/([A-Za-z]+)'\)/g, (_m, name) => {
        hits += 1;
        return `__standardFont(${JSON.stringify(name)})`;
      });
      src = src.replace(
        /const ICC_PROFILE_PATH = new URL\([^;]*?\)\.href;/,
        'const ICC_PROFILE_PATH = "data:application/octet-stream;base64,";',
      );
      src = src.replace(/createRequire\(import\.meta\.url\)/g, 'createRequire(__filename)');
      if (!hits) console.warn('[bundle] 警告：没有改写到任何 #standard-fonts 引用，pdfkit 版本可能变了');
      if (/import\.meta\.url/.test(src)) console.warn('[bundle] 警告：pdfkit 里仍残留 import.meta.url');
      return { contents: `import __standardFont from ${JSON.stringify(VIRTUAL_FONTS)};\n${src}`, loader: 'js' };
    });
  },
};

await build({
  absWorkingDir: root,
  entryPoints: [entry || 'tools/exe/main.cjs'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: resolve(root, outfile),
  plugins: [plugin],
  logLevel: 'warning',
});
console.log(`[bundle] 已生成 ${resolve(root, outfile)}`);
