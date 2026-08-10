const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config.js');
const { mergeOrders } = require('./merge_archive.js');
const { loadToken, saveToken, syncOrders } = require('./erp_sync.js');
const { fetchOrders } = require('./erp_fetch.js');
const { STORE_GROUPS } = require('./groups.js');

const app = express();
app.use(express.json());
const PORT = config.PORT;
const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVE_FILE = path.join(DATA_DIR, 'orders_archive.json');
const DASH_FILE = path.join(__dirname, 'public', 'dashboard_data.js');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- 同步密钥（看板写回 ERP 用）----
const SYNC_KEY_FILE = path.join(__dirname, 'sync_key.txt');
let SYNC_KEY = fs.existsSync(SYNC_KEY_FILE) ? fs.readFileSync(SYNC_KEY_FILE, 'utf8').trim() : '';
if (!SYNC_KEY) {
  SYNC_KEY = require('crypto').randomBytes(4).toString('hex');
  fs.writeFileSync(SYNC_KEY_FILE, SYNC_KEY);
}
console.log('[sync] 同步密钥: ' + SYNC_KEY);

function checkSyncKey(req, res) {
  if ((req.headers['x-sync-key'] || '') !== SYNC_KEY) {
    res.status(403).json({ ok: false, msg: '同步密钥错误' });
    return false;
  }
  return true;
}

app.post('/api/sync', async (req, res) => {
  if (!checkSyncKey(req, res)) return;
  const changes = (req.body && req.body.changes) || [];
  if (!changes.length) return res.json({ ok: false, msg: '没有需要同步的修改' });
  const token = loadToken();
  if (!token) return res.json({ ok: false, msg: '服务器未配置ERP令牌，请在本地运行 node login_erp.js 上传' });
  try {
    const results = await syncOrders(token, changes);
    res.json({ ok: results.every(function (r) { return r.ok; }), results: results });
  } catch (e) {
    res.json({ ok: false, msg: e.message });
  }
});

app.post('/api/token', (req, res) => {
  if (!checkSyncKey(req, res)) return;
  const t = (req.body && req.body.token) || '';
  if (t.indexOf('Bearer ') !== 0) return res.json({ ok: false, msg: 'token格式不对' });
  saveToken(t);
  console.log('[fetch] ERP令牌已更新');
  res.json({ ok: true });
});

// ---- 数据自动更新（纯 HTTP 轮询，无需浏览器/验证码）----
let lastData = { lastUpdate: null, totalOrders: 0, orders: [] };
let refreshing = false;

function seedArchiveFromDashboard() {
  if (!fs.existsSync(DASH_FILE)) return [];
  try {
    const t = fs.readFileSync(DASH_FILE, 'utf8');
    const m = t.match(/window\.RAW_DATA = (\[.*\]);/s);
    return m ? JSON.parse(m[1]) : [];
  } catch (e) { return []; }
}

async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  try {
    const token = loadToken();
    if (!token) {
      console.log('[fetch] 未配置 ERP 令牌，跳过更新（本地运行 node login_erp.js 上传令牌）');
      return;
    }
    const orders = await fetchOrders(token);
    let archive = [];
    if (fs.existsSync(ARCHIVE_FILE)) {
      try { archive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8')); } catch (e) { archive = []; }
    } else {
      archive = seedArchiveFromDashboard();
    }
    const allowCancel = orders.length >= 10;
    const merged = mergeOrders(archive, orders, { allowCancel: allowCancel });
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(merged.orders, null, 2), 'utf8');
    const nowStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const out = '// 服务器自动生成：请勿手改\n' +
      'window.RAW_DATA = ' + JSON.stringify(merged.orders) + ';\n' +
      'window.STORE_GROUPS = ' + JSON.stringify(STORE_GROUPS) + ';\n' +
      'window.LAST_UPDATE = ' + JSON.stringify(nowStr) + ';\n';
    fs.writeFileSync(DASH_FILE, out, 'utf8');
    lastData = { lastUpdate: new Date().toISOString(), totalOrders: merged.orders.length, orders: merged.orders };
    console.log('[fetch] 更新完成: ' + merged.orders.length + ' 单 (新增 ' + merged.added + ', 更新 ' + merged.updated + ', 取消 ' + merged.cancelled + ') @ ' + nowStr);
  } catch (e) {
    console.error('[fetch] 更新失败: ' + e.message);
  } finally {
    refreshing = false;
  }
}

app.get('/api/orders', (req, res) => res.json(lastData));
app.get('/api/update', (req, res) => { res.json({ message: 'started' }); refreshData(); });

app.get('/api/groups', (req, res) => res.json(STORE_GROUPS));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('Server: http://localhost:' + PORT);
  console.log('API: http://localhost:' + PORT + '/api/orders');
  console.log('Update: http://localhost:' + PORT + '/api/update');
});

// 启动时立即更新一次，之后按 POLL_INTERVAL 分钟轮询
const pollMs = Math.max(1, config.POLL_INTERVAL || 2) * 60000;
refreshData();
setInterval(refreshData, pollMs);
console.log('Ready. 自动刷新间隔: ' + Math.round(pollMs / 60000) + ' 分钟');
