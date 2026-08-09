# 抖音订单统计看板

## 快速启动

### 本地运行
```bash
node server.js
```
然后打开 http://localhost:3000

### 手动更新数据
访问 http://localhost:3000/api/update

### 查看API
- 订单数据: http://localhost:3000/api/orders
- 店铺分组: http://localhost:3000/api/groups

## 部署到服务器

### 环境要求
- Node.js 16+
- Playwright (已包含在 dependencies 中)

### 安装
```bash
npm install
npx playwright install chromium
```

### 启动
```bash
node server.js
```

### 使用 PM2 持久化（推荐）
```bash
npm install -g pm2
pm2 start server.js --name order-dashboard
pm2 save
pm2 startup
```

### 自动更新
- 每30分钟自动从ERP抓取最新数据
- 也可手动访问 /api/update 触发更新

## 文件结构
- `server.js` - 后端服务（Express + Playwright）
- `public/index.html` - 看板前端
- `public/dashboard_data.js` - 订单数据（由 `embed_data.js` 生成，看板运行时加载，不内嵌在 HTML 中）
- `update.bat` - 本地更新数据流程（extract_data.js 抓取 → embed_data.js 生成数据文件）
- `data/orders.json` - 订单数据缓存
- `package.json` - 依赖配置

## 配置
编辑 `server.js` 顶部：
- `PORT` - 服务端口（默认3000）
- `USERNAME` - ERP账号
- `PASSWORD` - ERP密码
