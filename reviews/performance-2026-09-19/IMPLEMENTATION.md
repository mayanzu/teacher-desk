# 性能专项优化实施记录

对应 `REPORT.md`（审查基线 `1520bf4`）。实施基于当前工作区（含 `f0b9075` 的导出等待态），本轮只改代码与测试，未提交、未推送。`npm run verify` 通过：lint、TypeScript、106 项测试（103 通过、3 项因本机没有中文字体跳过）、生产构建。

复跑验证（`reproduce.mjs` 已同步更新到优化后的代码，并直接导入 `server/warmup.mjs` 复现会话轮换场景）：

```powershell
npm run verify
node reviews/performance-2026-09-19/reproduce.mjs
node reviews/performance-2026-09-19/reproduce-pdf-latency.mjs
```

本轮 `reproduce.mjs` 的关键对照（合成上游、20ms 延迟，与报告同口径）：

| 实验 | 报告基线 | 优化后 |
|---|---|---|
| `JWXT_FETCH_CONCURRENCY=1` 调用 `getSchedule` | 峰值并发 5 | **峰值并发 1** |
| 外层并发 3 运行三个课表任务 | 峰值并发 15 | **峰值并发 3** |
| 一班汇总后再读取该班表单 | 汇总 4 次 + 明细 3 次 | **汇总 3 次 + 明细 3 次**（汇总不再逐班取学期周数） |
| 教学进度表单（成功路径） | 3 次串行 | 3 次（编辑仍需现拉表单）；空表 7 次 |
| 浏览器命中新鲜课表缓存 | 0 次网络请求 | 0 次 |
| 保存进度后访问无关模块 | 新增 3 次网络请求 | **0 次**（定向失效） |
| 预热中轮换会话后 | 4 个旧会话任务继续启动 | **0 个**（代际校验 + abort） |

## 逐项状态

| ID | 状态 | 落地内容 |
|---|---|---|
| R01 | 已实现 | `server/jwxt/scheduler.mjs`：实际 fetch 处的统一调度（每会话 + 全局并发、优先级、有界队列、取消），`JwxtSession.request` 接入，额度覆盖响应体读取 |
| R02 | 已实现 | 课表按周缓存 + `/api/schedule/partial` 分段加载，`loadedWeeks/pendingWeeks/failedWeeks/complete` 显式标记；前端当前周先显示、后台低优先级补齐 |
| R03 | 已实现 | `server/data.mjs` 数据访问层：班级列表、学期周数、表格行、已验证表格 ID 共享缓存；汇总改为「表单 + 表格」两次/班；空表识别短路 |
| R04 | 已实现 | 会话代际 + `AbortController`：预热绑定 generation，退出/换账号取消排队与在飞请求；移除无 UI 消费的成绩登记册预热；预热失败有限重试 |
| R05 | 已实现 | 保存后只失效该学期进度汇总/明细/导出（前后端一致），课表/任务/成绩缓存保留 |
| R06 | 已实现 | 查询缓存保留写入时间；刷新失败保留已显示内容并显示非阻塞提示；`peekQueryEntry`/`readApiCacheEntry` 提供数据年龄 |
| R07 | 已实现 | `server/cache.mjs`：条数 + 字节双预算、单对象准入上限、全局预算、过期清扫；浏览器缓存同样加字节预算 |
| R08 | 已实现 | `exportCourseGradesPdf` 教师名查询与 PDF 下载并行、短预算（默认 800ms，`JWXT_FILENAME_BUDGET_MS`）；前端已看过明细时直接带 `teacher` 参数 |
| R09 | 部分实现 | 导出编码按 Buffer 记忆、gzip 结果按 Buffer 记忆；二进制/流式下载路径（保留 IDM 兼容模式）留待后续 |
| R10 | 已实现 | `downloadFile` 同文件去重（共享生成/传输/保存一次）、超时、取消信号、阶段回调；导出按钮显示「生成中/正在下载/正在保存」 |
| R11 | 已实现 | 统一 `json()` 走 `sendBody`：≥1 KiB 且客户端接受时 gzip，保留 Vary/Content-Length/no-store |
| R12 | 已实现 | `tools/precompress.mjs` 构建期生成 `.gz`，`npm run build` 自动执行；服务端优先返回预压缩文件，未预压缩文本实时压缩回退 |
| R13 | 已实现 | 会话文件时间戳按 `JWXT_SESSION_TOUCH_MS`（默认 60s）合并异步刷盘；恢复登录态只读一次磁盘 |
| R14 | 部分实现 | 编辑行抽成 memo 组件、`updateRow` 稳定引用；查询缓存少一次整表 clone。虚拟列表/按需拆包按报告要求等真实 profile 证据 |
| R15 | 部分实现 | 心跳改为「完成后再调度」、不可见暂停、失败指数退避 + 抖动、恢复可见立即校验；倒计时不可见不刷新。跨标签 BroadcastChannel 留待后续 |
| R16 | 已实现（基础） | `server/perf.mjs`：AsyncLocalStorage 采集 queue/upstream/cache 计数与阶段耗时，`JWXT_PERF_LOG=1` 输出脱敏日志，`JWXT_SERVER_TIMING=1` 输出 Server-Timing；新增请求预算测试 |
| R17 | 已实现（D0） | 忙状态（含阶段文案）、文件名脱离关键路径、编码复用、定向失效；导出任务队列/后台生成未做 |
| R18 | 已实现 | 点名册报表不再为了页眉拉整学期课表：教师字段来自教学班，缺失时只读课表缓存；教学班/学期名失败不阻塞名单 |
| R19 | 已实现 | `useRefreshRequest`：只有显式「刷新/重试」的一次请求带 `refresh=1`，普通切学期遵循缓存 |

## 关键机制

### 统一调度（R01/R04）

- 入口：`JwxtSession.request`（`server/session.mjs`）→ `scheduleRequest`（`server/jwxt/scheduler.mjs`）。
- 默认值：每会话 `JWXT_FETCH_CONCURRENCY=3`，全局 `JWXT_GLOBAL_CONCURRENCY=8`，队列 `JWXT_MAX_QUEUE=64`；队列排满返回 503。
- 优先级：鉴权探测与用户可见请求优先，后台预热/补齐 `prefetch=1` 低优先级；同一优先级 FIFO。
- 取消：前台请求可通过 `AbortSignal` 取消；退出/换账号会 abort 该会话的预热 controller。
- 嵌套业务函数只拆任务、不再各自占用信号量，不会死锁。

### 课表分段（R02）

- 缓存键 `scheduleWeek:<term>:<week>`（30 分钟 TTL），整学期与分段接口共用。
- `/api/schedule/partial?term=&weeks=&prefetch=1`：默认当前周 ±1；返回 `loadedWeeks/pendingWeeks/failedWeeks/complete`。
- 前端首屏只等当前周；其余周次由课表页在后台补齐，空状态只在 `complete` 后显示「没有课」。
- 完整 `/api/schedule` 保留（全有或全无），供需要整学期数据的调用。

### 进度数据复用（R03/R05）

- 汇总每班请求从「表单 + 表格 + 学期周数」（空表最多 7 次）降到「表单 + 表格」；学期周数按学期一次。
- 汇总拉过的表格行按班缓存（默认 5 分钟），随后打开编辑明细只补表单元数据（始终现拉）+ 学期周数。
- 已验证表格 ID 按学期记录：空表返回「有结构 + 明确空标记」时不再遍历其余 4 个候选。
- 保存成功只清 `progress*` 与该学期进度导出；失败信号明确时不清。

### 传输与静态资源（R11/R12）

- JSON：≥1 KiB 且 `Accept-Encoding` 允许时 gzip（`server/response.mjs`），小响应/错误响应不压缩。
- 静态：`npm run build` 生成 `.gz`，服务端按 `Accept-Encoding` 返回，ETag/304/HEAD/Vary 语义不变。

### 下载生命周期（R08/R10/R17）

- 服务端：文件名元数据查询与 PDF 下载并行、0.8s 预算；同一导出缓存 Buffer 的 JSON/base64/gzip 只编码一次。
- 前端：同一 URL 的生成/传输/保存共享一个任务；180s 超时；失败可重试；按钮即时反馈并显示阶段。

## 新增测试与验收映射

| 报告验收点 | 测试 |
|---|---|
| R01 设每会话额度 1，真实 fetch 峰值必须为 1 | `tests/scheduler.test.mjs`（`JWXT_FETCH_CONCURRENCY=1` + 真实 `fetchScheduleWeek`） |
| R01 全局上限/有界队列/取消释放额度 | `tests/scheduler.test.mjs` |
| R02 远周延迟 5 秒不阻塞当前周；部分失败显式标记 | `tests/schedule-partial.test.mjs` |
| R03 首表单成功路径请求预算；汇总后编辑不重复回源；空表识别 | `tests/progress-data.test.mjs` |
| R04 退出后未完成的预热不再发请求 | `tests/session-warmup.test.mjs`（新增用例） |
| R05 保存后无关缓存保留、进度导出失效 | `tests/progress-data.test.mjs` + `tests/export-cache.test.mjs`（既有） |
| R06 刷新失败保留内容并提示 | `tests/review-regressions.test.mjs`（新增用例） |
| R07 字节/条数预算、过期清扫、长 TTL 导出不被误清 | `tests/cache-budget.test.mjs` |
| R08 元数据延迟 30 秒不阻塞已生成的 PDF | `tests/export-filename.test.mjs` |
| R10 5 次连点只保存一次、超时与阶段 | `tests/download-lifecycle.test.mjs` |
| R11 JSON gzip、R12 预压缩静态 | `tests/transport.test.mjs` |
| R18 教师信息完整时课表请求为 0、慢课表不阻塞 | `tests/roster-report.test.mjs` |
| R19 仅显式重试携带 `refresh=1` | `tests/review-regressions.test.mjs`（新增用例） |

## 新增/变更环境变量

完整列表见 `.env.example`：`JWXT_GLOBAL_CONCURRENCY`、`JWXT_MAX_QUEUE`、`JWXT_REQUEST_TIMEOUT_MS`、`JWXT_QUERY_CACHE_BYTES`、`JWXT_EXPORT_CACHE_BYTES`、`JWXT_CACHE_TOTAL_BYTES`、`JWXT_MAX_OBJECT_BYTES`、`JWXT_FILENAME_BUDGET_MS`、`JWXT_SESSION_TOUCH_MS`、`JWXT_WARMUP_ATTEMPTS`、`JWXT_PERF_LOG`、`JWXT_SERVER_TIMING`。

## 未实施（有明确前置条件）

- R09 二进制/流式下载与编码缓存复用之外的替代通道：需要单独交付并逐项验证 IDM 开/关、Range/续传与鉴权，保留现有 JSON 兼容路径。
- R14 虚拟列表、代码拆包：报告要求先有 20/100/500 行真实浏览器 profile 证据。
- R15 多标签 `BroadcastChannel` 协调、跨页共享缓存：先保证退出隔离，属于后续能力。
- R16 真实浏览器 LCP/INP 与线上 p95：需要基准设备与可复现环境；当前提供 Server-Timing/阶段日志与请求预算测试作为基础。
- R17 长时导出的任务创建/状态查询/完成后下载：需要教务侧兼容性验证；当前先消除「点击没反应」与可选元数据阻塞。
- 课表整学期接口若教务提供单次全量返回：报告建议先验证上游能力，本轮未假设存在。
