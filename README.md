# 通用教师课表

GitHub: <https://github.com/mayanzu/teacher-timetable>

现代化的教师课表管理应用，支持多教师本机档案、教务处课表粘贴导入、照片识别、教学周导航、课前提醒和随时导出备份。

在线地址（局域网）：<http://192.168.31.3:8088/>

![桌面端界面](docs/app-home.png)

![移动端界面](docs/app-mobile.png)

## 功能

- 多教师档案：同一浏览器保存多位老师课表，随时切换
- 粘贴导入：识别教务处 Markdown、网页表格和 Excel 制表符格式
- 自动解析部门、教师、星期、节次、周次、单双周、人数、教室和班级
- 照片识别：通过 Tesseract.js 在浏览器中识别纸质或截图课表
- 教学周导航：自动计算当前周，支持上一周、下一周和回到本周
- 下一节课倒计时、今日课程和本周课次概览
- 课前浏览器通知提醒
- 教师档案 JSON 导入与导出备份
- 桌面端、移动端和深色漫画主题
- Docker + Nginx 部署

## 技术栈

- React 19
- TypeScript
- Vite 8
- Vitest + Testing Library
- ESLint + Prettier
- Zod
- date-fns
- Lucide React
- Tesseract.js
- Docker + Nginx

## 本地开发

```bash
npm install
npm run dev
```

默认访问 <http://localhost:5173>。

## 质量检查

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Docker

```bash
docker compose up -d --build
```

默认映射到宿主机 `8088` 端口。

软路由或国内环境可以复制环境变量示例并使用镜像代理：

```bash
cp .env.example .env
```

```dotenv
NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine
NGINX_IMAGE=docker.m.daocloud.io/library/nginx:alpine
```

## 数据模型

教师档案保存在浏览器 `localStorage`：

- `kb-teacher-profiles-v1`
- `kb-active-teacher`

每份档案包含：

- 教师、部门、学期和第一周日期
- 课程数据
- 默认作息时间
- 分楼栋作息时间

课表数据不会上传到服务器。分享系统时只需发送站点地址，其他老师在自己的浏览器粘贴一次课表即可。

## 目录结构

```text
src/
├── components/        React UI 组件
├── context/           教师档案和 Toast 状态
├── data/              默认课表、作息和示例
├── hooks/             主题、提醒、本地存储等 Hooks
├── lib/               日期、课表算法、导入解析
├── services/          Tesseract 照片识别服务
├── styles/            模块化漫画主题样式
└── types/             TypeScript 类型
```

旧版单文件应用保留在 `legacy/课表.html`，仅用于迁移对照，不参与构建和部署。

## License

MIT
