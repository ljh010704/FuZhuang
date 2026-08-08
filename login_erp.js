// ERP 登录助手：打开浏览器让用户登录（账号密码+验证码，勾选七天免登录），
// 登录成功后保存本地会话 _erp_session.json，并把 fx-token 上传到服务器（供 /api/sync 使用）。
// 用法: node login_erp.js   （首次会询问服务器地址和同步密钥，之后回车沿用）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SESSION_FILE = path.join(__dirname, '_erp_session.json');
const CFG_FILE = path.join(__dirname, 'sync_config.json');

function ask(rl, q) { return new Promise(function (resolve) { rl.question(q, function (a) { resolve(a.trim()); }); }); }

(async function () {
  let cfg = {};
  if (fs.existsSync(CFG_FILE)) { try { cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (e) {} }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const server = await ask(rl, '服务器地址(如 http://1.2.3.4:3000)' + (cfg.server ? ' [' + cfg.server + ']' : '') + ': ');
  const key = await ask(rl, '同步密钥(pm2 logs order-dashboard 可查)' + (cfg.syncKey ? ' [已保存]' : '') + ': ');
  rl.close();
  cfg.server = server || cfg.server || '';
  cfg.syncKey = key || cfg.syncKey || '';
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const ctxOpts = { viewport: null };
  if (fs.existsSync(SESSION_FILE)) ctxOpts.storageState = SESSION_FILE;
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  await page.goto('https://fx.fengsutb.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('请在浏览器中登录（选“账号密码登录”，勾选“七天免登录”），最多等待5分钟...');
  let token = null;
  for (let i = 0; i < 150; i++) {
    await new Promise(function (r) { setTimeout(r, 2000); });
    try {
      const t = await page.evaluate(function () { return localStorage.getItem('fx-token'); });
      if (t && page.url().indexOf('login') === -1) { token = t; break; }
    } catch (e) {}
  }
  if (!token) { console.log('等待登录超时'); await browser.close(); process.exit(1); }

  await context.storageState({ path: SESSION_FILE });
  console.log('已保存本地会话: _erp_session.json');

  if (cfg.server && cfg.syncKey) {
    try {
      const r = await fetch(cfg.server.replace(/\/+$/, '') + '/api/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-key': cfg.syncKey },
        body: JSON.stringify({ token: token })
      });
      const j = await r.json();
      console.log(j.ok ? '令牌已上传到服务器，同步功能已就绪 ✓' : '上传失败: ' + (j.msg || ''));
    } catch (e) {
      console.log('上传失败: ' + e.message + '（本地会话已保存，可稍后重试）');
    }
  } else {
    console.log('未配置服务器地址/密钥，仅保存了本地会话');
  }
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
