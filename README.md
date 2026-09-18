# 教师工作台（教务系统现代化前端）

把难看的 KINGOSOFT 教务系统换成漫画风的工作台：**喜鹊儿扫码登录**，后端代理 + 页面解析成 JSON，前端全新 UI。只读看板优先，所有数据仅在本机流转。

## 架构

```
web/      React + Vite + TS 前端（漫画风）
server/   Node HTTP API：扫码登录、会话保持、页面解析
```

- 登录：`GET /cas/login.action` → 本地生成二维码 → 轮询 `frame/LoginBar.jsp` → `POST cas/logon.action`（`loginmethod=xiqueer`），全程不使用账号密码。
- 会话：Cookie 仅存内存，可缓存到 `.session.json`（已 gitignore），失效自动提示重扫。
- 加密：不涉及前端账号密码加密逻辑。

## 快速开始

```bash
npm install
npm --prefix web install
npm run server          # 终端 1：API 服务 http://127.0.0.1:8790
npm run dev:web         # 终端 2：前端 http://127.0.0.1:5273（/api 自动代理到 8790）
```

首次打开前端会显示二维码，用**喜鹊儿 App** 扫码（微信/相机无效）。

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
| `GET /api/tasks?term=2026,0` | 教学任务（承担理论课程） |
| `GET /api/progress?term=2026,0` | 教学进度查看（周次/日期/节次/班级/地点/授课内容） |
| `GET /api/progress/classes?term=2026,0` | 需录入进度的教学班列表（含审核状态） |
| `GET /api/progress/entry?term=&kcdm=&bjdm=…` | 某教学班的录入表单（meta + 已录入行） |
| `POST /api/progress/entry` | 提交进度到 `TeachingTaskingJxjcbAction.do`（GBK 表单编码；`confirm:true` 才提交，否则返回预览） |
| `GET /api/progress/copy-sources?term=&kcdm=&jsdm=` | 可复制的来源教学班（按录入人过滤） |
| `GET /api/progress/copy?kcdm=&source=&sourceTerm=` | 复制指定教学班的进度内容（`EnterTeachingTaskPlanByKcAction.do?hidOption=SYNSKBJ`） |
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
├── session.mjs      Cookie 会话、同源校验、GBK/UTF-8 解码
├── login.mjs        喜鹊儿扫码登录流程
└── jwxt/            教务接口适配层（按功能拆分）
    ├── common.mjs          通用解析（表格 / GBK 编码 / 学期）
    ├── schedule.mjs        周课表
    ├── tasks.mjs           教学任务
    ├── terms.mjs           学年学期列表
    ├── progress.mjs        教学进度（查看 / 录入 / 复制 / 导出）
    ├── grades-register.mjs 成绩登记册
    ├── course-grades.mjs   分课程按行政班级（查看 / 导出 PDF、Excel）
    ├── roster.mjs          学生点名册与打印
    └── index.mjs           统一出口（barrel）
web/
├── src/components/  界面组件
├── src/lib/         纯函数工具
├── src/styles/      样式
└── src/api.ts       前端 API 客户端
Dockerfile / docker-compose.yml   软路由部署
```

## 配置（.env）

```dotenv
JWXT_BASE=https://jwxt.slu.edu.cn:4060
JWXT_INSECURE_TLS=0     # 证书不受信任时设 1（仅本地调试）
PORT=8790
JWXT_POLL_MS=2000
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
- 会话持久化在卷 `timetable-session`（挂载到容器 `/data`，`SESSION_FILE=/data/.session.json`），重建容器无需重新扫码。
- 可用环境变量：`JWXT_BASE`、`JWXT_INSECURE_TLS`、`PORT`、`SESSION_FILE`、`HOST`。
- 镜像基于 `node:22-alpine`，仅安装生产依赖；前端在构建阶段产出，运行镜像不含源码与开发依赖。

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
