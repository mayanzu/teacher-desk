/*
 * 复现「上游串行 vs 并发」的实测数字，给性能改动留一份可复跑的基准。
 *
 * 用法：
 *   node tools/bench-upstream-concurrency.mjs                      # 本地假上游（默认，不碰教务系统）
 *   node tools/bench-upstream-concurrency.mjs --requests 6 --concurrency 3
 *   node tools/bench-upstream-concurrency.mjs --base https://jwxt.slu.edu.cn:4060   # 打真实教务（只读 GET）
 *
 * 参数：
 *   --base <url>        上游基址；不给就起一个本地假上游（最稳妥，适合验证并发收益本身）
 *   --path <path>       请求路径，默认 /ahsljw/frame/homes.action
 *   --requests <n>      每轮请求数，默认 3（教学进度汇总就是「1 + 教学班数」次往返）
 *   --concurrency <k>   并发上限，默认 3（与 JWXT_FETCH_CONCURRENCY 默认值一致）
 *   --latency <ms>      假上游的单请求延迟，默认 1200（实测教务 1~2s）
 *   --rounds <r>        轮数，默认 2（第一轮含建连，第二轮更接近稳态）
 *
 * 注意：打真实教务请保持 GET 只读路径，不要带认证参数。
 */
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const requests = Number(option('requests', 3));
const concurrency = Number(option('concurrency', 3));
const latency = Number(option('latency', 1200));
const rounds = Number(option('rounds', 2));
const path = option('path', '/ahsljw/frame/homes.action');

let fake = null;
let base = option('base', '');
if (!base) {
  fake = createServer((req, res) => {
    setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    }, latency);
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${fake.address().port}`;
}

const url = `${base.replace(/\/+$/, '')}${path}`;
const once = async () => {
  const started = Date.now();
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return { ms: Date.now() - started, status: response.status };
  } catch (error) {
    return { ms: Date.now() - started, status: `ERR ${error.message}` };
  }
};

const serial = async (count) => {
  const started = Date.now();
  const results = [];
  for (let index = 0; index < count; index += 1) results.push(await once());
  return { ms: Date.now() - started, results };
};

const parallel = async (count, limit) => {
  const started = Date.now();
  const results = [];
  for (let offset = 0; offset < count; offset += limit) {
    const batch = Array.from({ length: Math.min(limit, count - offset) }, () => once());
    results.push(...(await Promise.all(batch)));
  }
  return { ms: Date.now() - started, results };
};

const format = (result) => result.results.map((item) => `${item.ms}ms/${item.status}`).join(', ');

console.log(`上游: ${url}`);
console.log(`参数: ${requests} 个请求, 并发上限 ${concurrency}, 共 ${rounds} 轮${fake ? `, 假上游延迟 ${latency}ms` : ''}`);
console.log('');

for (let round = 1; round <= rounds; round += 1) {
  const serialRun = await serial(requests);
  const parallelRun = await parallel(requests, concurrency);
  const speedup = serialRun.ms / Math.max(1, parallelRun.ms);
  const theoretical = requests / Math.ceil(requests / Math.min(concurrency, requests));
  console.log(`第 ${round} 轮`);
  console.log(`  串行 ${requests} 次: ${serialRun.ms}ms  [${format(serialRun)}]`);
  console.log(`  并发 ${concurrency} 次: ${parallelRun.ms}ms  [${format(parallelRun)}]`);
  console.log(`  提速: ${speedup.toFixed(2)}x（理论上限 ${theoretical.toFixed(2)}x）`);
  console.log('');
}

if (fake) await new Promise((resolve) => fake.close(resolve));
