# 教师工作台（教务系统现代化前端）

把难看的 KINGOSOFT 教务系统换成漫画风的工作台：**喜鹊儿扫码登录**，后端代理 + 页面解析成 JSON，前端全新 UI。提供查询看板与教学进度录入；数据由所部署的服务器代理访问教务系统。

## 架构

```
web/      React + Vite + TS 前端（漫画风）
server/   Node HTTP API：扫码登录、会话保持、页面解析
```

- 登录：`GET /cas/login.action` → 本地生成二维码 → 轮询 `frame/LoginBar.jsp` → `POST cas/logon.action`（`loginmethod=xiqueer`），全程不使用账号密码。
- 会话：Cookie 按浏览器（`td_sid` Cookie）隔离，持久化到 `.sessions/<sid>.json`（已 gitignore），失效自动提示重扫。
- 多用户：同一实例支持多个老师同时使用，各自独立登录、互不可见（详见下方「多用户」）。
- 加密：不涉及前端账号密码加密逻辑。

## 在本机（电脑）上部署运行

### 0. 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20.19 或 ≥ 22.12（推荐 22 LTS） | 运行后端、构建前端 |
| npm | ≥ 10 | 随 Node 一起安装 |
| Docker（可选） | 较新版本 | 仅在使用容器方式运行/部署时需要 |

> 运行后需要浏览器 + 手机上的**喜鹊儿 App**（扫码登录）。项目不保存账号密码，也不依赖数据库。

### 1. 获取代码

```bash
git clone https://github.com/mayanzu/teacher-desk.git
cd teacher-desk
```

### 2. 安装依赖

```bash
npm install                # 根目录：后端依赖（iconv-lite、qrcode）
npm --prefix web install   # web 目录：前端依赖（React、Vite、TypeScript）
```

### 3. 配置 `.env`

复制模板并按需修改：

```bash
cp .env.example .env       # Windows PowerShell: copy .env.example .env
```

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `JWXT_BASE` | `https://jwxt.slu.edu.cn:4060` | 教务系统地址（换学校改这里） |
| `JWXT_INSECURE_TLS` | `0` | 证书不受信任导致请求失败时设 `1`（关闭 TLS 校验，仅本机调试） |
| `PORT` | `8790` | 后端监听端口 |
| `HOST` | `127.0.0.1` | 后端绑定地址；局域网访问设 `0.0.0.0` |
| `JWXT_POLL_MS` | `2000` | 扫码轮询间隔（毫秒） |
| `JWXT_QR_TIMEOUT_MS` | `300000` | 二维码有效期（毫秒） |
| `SESSION_DIR` | `<项目>/.sessions/` | 各浏览器会话的持久化目录（容器内用 `/data/sessions`） |
| `JWXT_CALENDAR` | 空 | 按学期配置真实首周周一与作息（未配置时界面标注“估算”），见下方「回归验证与校历配置」 |
| `JWXT_FETCH_CONCURRENCY` | `3` | 同一会话的上游并发上限（统一调度器；设为 `1` 完全串行） |
| `JWXT_GLOBAL_CONCURRENCY` | `8` | 同一教务源的全局并发上限（所有浏览器会话共享，防止多人叠加） |
| `JWXT_WARMUP` | `1` | 设为 `0` 关闭登录后的后台预热 |
| `JWXT_PERF_LOG` | `0` | 设为 `1` 输出每请求阶段耗时（脱敏，不记学生数据） |
| `COOKIE_SECURE` | `0` | HTTPS 部署设为 `1`，会话 Cookie 增加 `Secure` 标记 |

> 缓存字节预算、导出 TTL、文件名查询预算、会话刷盘间隔、预热重试次数等完整参数见 `.env.example`。

### 4. 运行

**方式 A：开发模式**（改代码即时生效，推荐本地开发）—— 需要两个终端：

```bash
# 终端 1：后端 API
npm run server        # http://127.0.0.1:8790

# 终端 2：前端 Vite 开发服务器
npm run dev:web       # http://127.0.0.1:5273（/api 自动代理到 8790）
```

浏览器打开 <http://127.0.0.1:5273>。

**方式 B：生产模式**（单进程，前端构建后由后端一起托管）：

```bash
npm run build         # 构建前端到 web/dist
npm run server        # 后端同时提供 API 与静态页面
```

浏览器打开 <http://127.0.0.1:8790>。

### 5. 扫码登录

首次打开会显示二维码 → 用**喜鹊儿 App** 扫码（微信/相机无效）。登录态按浏览器隔离并缓存在 `.sessions/`，失效后页面会自动回到扫码页。

### 6. （可选）用 Docker 在本机运行

```bash
docker build -t teacher-desk:latest .
docker run -d --name teacher-desk \
  -p 8088:8790 \
  -v teacher-desk-session:/data \
  --restart unless-stopped \
  teacher-desk:latest
```

浏览器打开 <http://127.0.0.1:8088>。跨架构（如 arm64）见下方「部署（软路由 Docker）」。

### 7. 长期后台运行（可选）

- **Windows**：用「任务计划程序」在开机时运行 `node server/index.mjs`（工作目录设为项目根）。
- **Linux / macOS**：用 `pm2` 或 `systemd` 托管，例如 `pm2 start server/index.mjs --name teacher-desk`。

### 8. 常见问题

- **页面连不上 / `ECONNREFUSED`**：确认 `npm run server` 已启动；开发模式确认 Vite 代理端口（默认 5273）。
- **取数失败并提示证书错误**：在 `.env` 里设 `JWXT_INSECURE_TLS=1`。
- **端口被占用**：改 `.env` 的 `PORT`；前端开发端口见 `web/vite.config.ts`。
- **局域网其他设备访问**：设 `HOST=0.0.0.0`，用本机内网 IP 访问，并在防火墙放行该端口。
- **换学校**：改 `JWXT_BASE`；不同学校页面结构可能不同，解析逻辑在 `server/jwxt/`。

## API

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/session` | 登录状态 |
| `POST /api/login/start` | 生成二维码（返回 dataURL） |
| `GET /api/login/status` | 轮询扫码状态 |
| `POST /api/logout` | 退出并清除本地会话 |
| `GET /api/terms` | 学年学期列表（含当前学期） |
| `GET /api/schedule?term=2026,0` | 周课表（课程、周次、单双周、教室、班级、作息时间、开学首周周一） |
| `GET /api/schedule/partial?term=2026,0[&weeks=1,2,3][&prefetch=1]` | 分段周课表：默认当前周 ±1，返回 `loadedWeeks / pendingWeeks / failedWeeks / complete`；其余周次可用 `prefetch=1` 低优先级后台补齐 |
| `GET /api/tasks?term=2026,0` | 教学任务（承担理论课程） |
| `GET /api/progress?term=2026,0` | 教学进度查看（周次/日期/节次/班级/地点/授课内容） |
| `GET /api/progress/classes?term=2026,0` | 需录入进度的教学班列表（含审核状态） |
| `GET /api/progress/entry?term=&kcdm=&bjdm=…` | 某教学班的录入表单（meta + 已录入行） |
| `POST /api/progress/entry` | 提交进度到 `TeachingTaskingJxjcbAction.do`（GBK 表单编码；`confirm:true` 才提交，否则返回预览） |
| `GET /api/progress/copy-terms?term=&kcdm=&skbjdm=` | 可复制的来源学期 |
| `GET /api/progress/copy-classes?term=&kcdm=&skbjdm=&xnxq=` | 指定学期下可复制的来源教学班 |
| `GET /api/progress/copy?kcdm=&xnxq=&source=` | 复制指定教学班的进度内容（`EnterTeachingTaskPlanByKcAction.do?hidOption=SYNSKBJ`） |
| `GET /api/grades?term=2026,0` | 成绩登记册（合并环节成绩 / 毕业设计（论文）成绩 / 补考成绩；无记录时返回空并附提示） |
| `GET /api/course-grades/classes?term=2026,0` | 分课程按行政班级查看成绩：本学期可查看成绩的课程/班级列表 |
| `GET /api/course-grades?term=&kcdm=&bjdm=&bjmc=&flag=1&dyfs=dl` | 某课程/班级的成绩明细（`flag=1` 原始成绩、`flag=2` 有效成绩；`dyfs=dl` 单栏、`sl` 双栏） |
| `GET /api/course-grades/export/excel?…` | 导出原始成绩（原版 `.xls`，直接代理教务导出） |
| `GET /api/course-grades/export/pdf?…` | 导出 PDF（调用教务 `frame/pdf` 服务生成，格式与原版完全一致） |

## 目录

```text
server/
├── index.mjs        HTTP 服务与路由
├── config.mjs       .env 与环境参数
├── cache.mjs        带字节预算的 LRU 缓存与统一 cached()
├── data.mjs         会话隔离的数据访问层（共享班级/表格/周次缓存、定向失效）
├── warmup.mjs       登录后后台预热（会话代际、低优先级、可取消、有限重试）
├── perf.mjs         请求级阶段采集（AsyncLocalStorage，默认不输出）
├── session.mjs      Cookie 会话、同源校验、GBK/UTF-8 解码、调度器接入
├── login.mjs        喜鹊儿扫码登录流程
├── response.mjs     gzip 协商与记忆化压缩
└── jwxt/            教务接口适配层（按功能拆分）
    ├── common.mjs          通用解析（表格 / GBK 编码 / 学期）
    ├── scheduler.mjs       上游统一调度（会话/全局并发、优先级、取消）
    ├── schedule.mjs        周课表（按周缓存 / 分段加载）
    ├── tasks.mjs           教学任务
    ├── terms.mjs           学年学期列表
    ├── progress.mjs        教学进度（查看 / 录入 / 复制 / 导出）
    ├── grades-register.mjs 成绩登记册
    ├── course-grades.mjs   分课程按行政班级（查看 / 导出 PDF、Excel）
    ├── roster.mjs          学生点名册与打印
    └── index.mjs           统一出口（barrel）
web/
├── src/components/  界面组件
├── src/lib/         纯函数工具（查询缓存、刷新语义、下载生命周期等）
├── src/styles/      样式
└── src/api.ts       前端 API 客户端
Dockerfile / docker-compose.yml   软路由部署
```

## 部署（软路由 Docker，linux/arm64）

```bash
npm run docker:build                                   # 本地构建 arm64 镜像 teacher-desk:latest
npm run docker:save                                    # 导出 teacher-desk-arm64.tar
scp teacher-desk-arm64.tar root@<router>:/tmp/         # 上传
ssh root@<router> "docker load -i /tmp/teacher-desk-arm64.tar"
ssh root@<router> "docker compose up -d"               # 使用仓库内 docker-compose.yml
```

- 容器内为**单进程 Node**（API + 静态资源），监听 `8790`，宿主机映射 `8088`。
- 会话按浏览器隔离并持久化在卷 `timetable-session`（挂载到容器 `/data`，`SESSION_DIR=/data/sessions`），重建容器无需重新扫码。
- 可用环境变量：`JWXT_BASE`、`JWXT_INSECURE_TLS`、`PORT`、`SESSION_DIR`、`HOST`、`JWXT_FETCH_CONCURRENCY`（每会话上游并发，默认 3）、`JWXT_GLOBAL_CONCURRENCY`（全局并发，默认 8）、`JWXT_CACHE_TTL_MS`（缓存兜底 TTL，默认 5 分钟）、缓存字节预算与 `JWXT_WARMUP` 等，完整列表见 `.env.example`。
- 镜像基于 `node:22-alpine`，仅安装生产依赖；前端在构建阶段产出，运行镜像不含源码与开发依赖。

## 多用户（同一实例多老师共用）

- 部署一个实例（云服务器 / 软路由），多个老师从各自浏览器访问同一地址即可。
- 每个浏览器首次访问分配一个 `td_sid` Cookie，服务端据此维护**独立的教务会话、登录流程与缓存**；各自用喜鹊儿扫码，**互不可见**，也不会互相顶号。
- 会话文件在 `SESSION_DIR` 下按 sid 保存；退出登录或超过 7 天未活动会自动清理。
- 数据面：业务数据（课表/成绩等）不落库，实时来自教务系统；服务器上只保存各自的登录 Cookie（临时凭证），请确保部署环境可信、访问受限。

## 状态与后续

- [x] 扫码登录 / 会话保持
- [x] 学年学期列表
- [x] 周课表（课程、周次、单双周、教室、班级、作息）
- [x] 教学任务（承担理论课程）
- [x] 教学进度查看（查看学期教学进度表，含周次/日期/授课内容）
- [x] **录入学期教学进度表**（教学班按班级名称展示 → 编辑授课内容 → 一键复制往期/其他班级进度 → 直接提交）
- [x] 成绩（环节成绩 / 毕业设计（论文）成绩 / 补考成绩，按学期合并展示）
- [x] **成绩导出**（主控 > 成绩录入 > 查看学生成绩 > 查看课程成绩 > 分课程按行政班级）：选课程/班级导出原始成绩 `.xls` 与**原版格式 PDF**；成绩明细为二级菜单
- [ ] 成绩录入（占位，开发中）
- [x] Docker 部署到软路由（linux/arm64 单进程 Node 容器，宿主机 8088）

> 录入属于写操作：`POST /api/progress/entry` 默认只返回提交预览，必须显式带 `confirm: true` 才会真正提交到教务系统。

> 仅用于登录本人账号、查看本人权限内的数据。


## 回归验证与校历配置

运行 `npm test` 执行隔离回归测试，运行 `npm run build` 检查前端类型与生产构建，运行 `npm run lint` 对后端/工具/测试做 `no-undef` 静态检查（前端构建与 `node --check` 都发现不了未定义变量）。`npm run verify` 会依次执行 lint、typecheck、测试与构建；CI 在 Node 20 / 22 上运行同一套检查（见 `.github/workflows/ci.yml`）。测试使用合成数据与 HTML fixture，不向教务系统写入。

查询结果在服务端按浏览器会话缓存（条数 + 字节双预算，超预算按最近最少使用淘汰，过期项定时清扫），并合并并发相同请求；每个缓存键按数据变化频率分层 TTL：学期列表 12 小时，课表/教学任务/成绩 30 分钟，点名册 10 分钟，其余（教学进度等）5 分钟。界面上每个「刷新」按钮都会带 `?refresh=1` 绕过缓存直接回源（例如 `/api/schedule?term=2026,0&refresh=1`），所以分层 TTL 不会让手动刷新的结果变旧；该参数也可以手工调用任意取数接口。导出结果（教学进度 PDF、成绩 PDF/Excel、点名册 PDF）另有一块独立小缓存（每浏览器最多 20 份、默认 5 分钟且有 64 MiB 字节预算，`JWXT_EXPORT_TTL_MS` 可调）：一次导出要 2 次上游往返且结果几百 KB，所以重复下载直接命中；同一份导出缓存的 JSON/base64/gzip 编码会按 Buffer 记忆，热下载不再重复编码。教学进度保存成功后会**定向失效**该学期的进度汇总/明细/导出缓存（课表、教学任务、成绩等无关缓存保留），避免下载到保存前的文件。点名册 PDF（`/api/roster/export/pdf`）由本机排版生成，内容与打印预览（`/api/roster/report?format=print`）一致：完整名单、表头每页重复、没有教务报表页的页眉与页内边框，页脚标页码 —— 教务的 `frame/pdf?method=topdf` 只能转出报表页当前那一页并带着页面装饰，所以不用它。中文靠本机字体渲染：会自动探测常见的单文件 TTF/OTF（Windows 的 simhei/simkai/Deng 等，Linux 的 fonts-arphic-gbsn00lp、fonts-wqy-zenhei，macOS 的 Arial Unicode），`.ttc` 字体集合 pdfkit 读不了；也可以用 `ROSTER_PDF_FONT` 指定文件；没有任何可用字体时接口返回 500 并说明如何安装，而不是输出缺字的 PDF。CSV 仍然保留（`/api/roster/export`）。上游请求由**统一调度器**约束（每会话 `JWXT_FETCH_CONCURRENCY` 默认 3、全局 `JWXT_GLOBAL_CONCURRENCY` 默认 8、有界队列超限返回 503、鉴权/用户操作优先于后台预取），额度覆盖到响应体读完；「上游串行 vs 并发」的实测数字可以用 `node tools/bench-upstream-concurrency.mjs` 复跑（默认打本地假上游，加 `--base` 才打真实教务）。**登录后会在后台自动预热**当前周的课表（当前周 ±1，其余周次由课表页可见后低优先级补齐）、教学任务、成绩列表、点名册、教学进度（`JWXT_WARMUP=0` 可关）；预热任务绑定会话代际，退出/换账号会取消未完成的请求，失败允许有限重试、不会被永久跳过。**每次受保护请求前的会话存活检查**（会真的打一次教务，实测单次 0.4~2s）在确认存活后的 `JWXT_SESSION_PROBE_TTL_MS`（默认 45 秒）内复用结论，而不是每个请求都探一次——这是「缓存了却还在转圈」的主因；设 0 恢复旧行为，真实掉线最多晚 45 秒被发现（此时会返回 401 提示重新扫码），探测失败不记忆，上游抖动不会误判成退出登录。匿名会话 30 分钟未活动回收，已登录会话 7 天未活动回收，内存上下文总数上限 500，会话活动时间戳按 `JWXT_SESSION_TOUCH_MS`（默认 60 秒）合并异步刷盘。`POST /api/login/start` 按来源 IP 限流（5 分钟内 10 次）。写请求校验 `Origin`：无 `Origin` 或同源（含 `localhost` 不同端口）放行。登录 Cookie 持久化到会话目录。

首屏与交互侧：课表按周缓存、分段加载（`/api/schedule/partial`），当前周先显示、慢的远周不再阻塞首屏，接口显式区分「未加载」和「没有课」；刷新失败时保留已显示内容并提示更新时间/失败原因，而不是清空成错误页；「重试」把强制回源限定为一次显式操作，普通切学期不会被历史点击持续绕过缓存。导出按钮点击后立刻进入「生成中/正在下载/正在保存」的等待态，同一份文件的并发下载共享一个任务、只保存一次，并带超时与取消。普通 JSON API 在客户端接受且正文 ≥1 KiB 时使用 gzip；`npm run build` 会为构建产物生成 `.gz`（`tools/precompress.mjs`），服务端优先返回预压缩文件，同一个 hash 资源不再实时压缩。设置 `JWXT_PERF_LOG=1` 可输出每请求的 `total/queue/upstream` 阶段耗时与上游/缓存计数（只写路径形状，不记学生数据）。

导出的 CSV 会把 `=`、`+`、`-`、`@` 开头的可疑内容转为文本，并对有前导零或超长（≥15 位）的学号使用 `="…"` 形式，避免表格软件执行公式或丢失精度。

便利贴按登录账号保存在当前浏览器，旧版无账号归属的笔记仍保留在原存储键，不自动展示给新账号。

开学日期尚未对接学校校历接口。默认日期和作息会在页面明确标注为估算；可在 `.env` 使用 `JWXT_CALENDAR` 按学期覆盖，示例见 `.env.example`。`semesterStart` 必须为首周周一（YYYY-MM-DD），学期编码为 0（第一学期）和 1（第二学期）。请填写学校实际值，示例不代表学校校历。

HTTPS 部署设置 `COOKIE_SECURE=1`；本机 HTTP 开发保持 `0`。EXE 模式从用户数据目录下 `.env` 读取配置。扫码和查询需要网络，单文件 EXE 仅免去安装 Node 的步骤。
