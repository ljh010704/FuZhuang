const express = require('express');
const { chromium } = require('playwright');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const config = require('./config.js');
const { mergeOrders } = require('./merge_archive.js');

const app = express();
const PORT = config.PORT;
const DATA_FILE = path.join(__dirname, config.DATA_FILE);

if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function extractOrdersFromStatus(page, statusName) {
  const orders = [];
  try {
    let clicked = false;
    for (let ti = 0; ti < 10 && !clicked; ti++) {
      clicked = await page.evaluate(function(name) {
        const els = Array.prototype.slice.call(document.querySelectorAll('.arco-tabs-tab, .arco-tabs-tab-title, .tab-text-box'));
        const el = els.find(function(e) {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (e.textContent || '').trim() === name;
        });
        if (el) { el.click(); return true; }
        return false;
      }, statusName);
      if (!clicked) await sleep(1000);
    }
    if (!clicked) throw new Error('tab not found: ' + statusName);
    await sleep(3000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);
    const text = await page.evaluate(() => document.body.innerText);
        const productMap = await page.evaluate(() => {
          const map = {};
          document.querySelectorAll('.shop-body').forEach(function(card) {
            const m = (card.innerText || '').match(/平台订单号：\s*(\d{19})/);
            if (!m) return;
            let storeName = '';
            const shopEl = card.querySelector('.shop-header .tooltip-button');
            if (shopEl) storeName = (shopEl.textContent || '').trim();
            const products = [];
            card.querySelectorAll('img').forEach(function(im) {
              const src = im.src || '';
              if (src.indexOf('ecombdimg') === -1) return;
              const block = im.closest('[three-index]') || im.parentElement;
              let title = '';
              block.querySelectorAll('span').forEach(function(sp) {
                if (title) return;
                const a = sp.querySelector('a');
                if (a && a.textContent.indexOf('编辑简称') !== -1) title = sp.textContent.replace(a.textContent, '').trim();
              });
              if (!title) {
                let best = '';
                block.querySelectorAll('span').forEach(function(sp) {
                  const t = (sp.textContent || '').trim();
                  if (t.length > best.length && t.indexOf('商品ID') === -1 && t.indexOf('商家编码') === -1 && t.indexOf('规格') === -1) best = t;
                });
                title = best.replace(/编辑(SKU)?简称/g, '').trim();
              }
              let spec = '';
              block.querySelectorAll('div').forEach(function(d) {
                if (spec) return;
                const t = (d.textContent || '').trim();
                if (t.indexOf('规格名称') === 0) spec = t.replace(/^规格名称：?\s*/, '');
              });
              products.push({ img: src, title: title, spec: spec });
            });
            map[m[1]] = { storeName: storeName, products: products };
          });
          return map;
        });

    const sections = text.split(/\u5e73\u53f0\u8ba2\u5355\u53f7\uff1a/);
    for (let i = 1; i < sections.length; i++) {
      const sec = sections[i];
      const orderIdMatch = sec.match(/^\s*(\d{19})/);
      if (!orderIdMatch) continue;
      const orderId = orderIdMatch[1];
      const amountMatch = sec.match(/([\d.]+)\uff08\u5171\d+\u4ef6\u5546\u54c1/);
      const amount = amountMatch ? amountMatch[1] : null;
      const lines = sec.split('\n').filter(l => l.trim());
      const cardInfo = productMap[orderId] || {};
      const storeName = cardInfo.storeName || (lines.length > 1 && !/^\d{19}/.test(lines[0].trim()) ? lines[0].trim() : null);
      const buyerMatch = sec.match(/\u4e70\u5bb6\u7559\u8a00:\s*(.*?)(?=\n)/);
      const sellerMatch = sec.match(/\u5356\u5bb6\u5907\u6ce8:\s*(.*?)(?=\n)/);
      const systemMatch = sec.match(/\u7cfb\u7edf\u5907\u6ce8:\s*(.*?)(?=\n)/);
      const shipMatch = sec.match(/\u63a8\u9001\u65f6\u95f4\uff1a([\d\-:\s]+)/);
      orders.push({
        platformOrderId: orderId, amount, storeName,
        products: cardInfo.products || [],
        buyerNote: buyerMatch ? buyerMatch[1].trim() : '',
        sellerNote: sellerMatch ? sellerMatch[1].trim() : '',
        systemNote: systemMatch ? systemMatch[1].trim() : '',
        shipTime: shipMatch ? shipMatch[1].trim().substring(0, 19) : null,
        status: statusName, platform: '\u6296\u97f3',
        sellerFlag: 0, systemFlag: 0,
        sellerFlagColor: 'rgb(170, 170, 170)', systemFlagColor: 'rgb(170, 170, 170)'
      });
    }
  } catch(e) { console.log('  Error: ' + e.message); return null; }
  return orders;
}

let isUpdating = false;
async function updateData() {
  if (isUpdating) { console.log('Already updating...'); return; }
  isUpdating = true;
  console.log('[' + new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}) + '] Starting update...');
  try {
    const browser = await chromium.launch(config.HEADLESS ? {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    } : {
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    });
    const SESSION_FILE = path.join(__dirname, '_erp_session.json');
    const ctxOpts = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    };
    if (fs.existsSync(SESSION_FILE)) ctxOpts.storageState = SESSION_FILE;
    const context = await browser.newContext(ctxOpts);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    const page = await context.newPage();
    console.log('Logging in...');
    await page.goto(config.ERP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);
    if (page.url().indexOf('login') !== -1) {
      const inputs = await page.$$('input');
      if (inputs.length >= 2) { await inputs[0].fill(config.USERNAME); await inputs[1].fill(config.PASSWORD); }
      await page.keyboard.press('Enter');
      await sleep(5000);
      try { await context.storageState({ path: SESSION_FILE }); } catch(e) {}
    }
    await page.goto(config.ERP_URL + 'order/check', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    try {
      await page.locator('text=\u6296\u97f3').first().click({ timeout: 10000 });
      await sleep(2000);
    } catch(e) {
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('div,span,a')) {
          if (el.innerText === '\u6296\u97f3' && el.offsetParent) { el.click(); return; }
        }
      });
      await sleep(2000);
    }
    const tabs = ['\u5df2\u53d1\u8d27', '\u5df2\u63a8\u9001\u5f85\u53d1\u8d27', '\u5df2\u53d1\u8d27\u9000\u6b3e', '\u4ea4\u6613\u5173\u95ed'];
    let all = [];
    const failedTabs = [];
    for (const t of tabs) {
      console.log('Extracting: ' + t);
      const o = await extractOrdersFromStatus(page, t);
      if (o === null) { failedTabs.push(t); continue; }
      console.log('  Found: ' + o.length);
      all = all.concat(o);
    }
    const seen = {};
    const deduped = all.filter(o => { if (seen[o.platformOrderId]) return false; seen[o.platformOrderId] = true; return true; });
    let archive = [];
    if (fs.existsSync(DATA_FILE)) {
      try { archive = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).orders || []; } catch(e) { archive = []; }
    }
    const scrapeOk = deduped.length >= 10 && failedTabs.indexOf('\u5df2\u63a8\u9001\u5f85\u53d1\u8d27') === -1;
    const merged = mergeOrders(archive, deduped, { allowCancel: scrapeOk });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ lastUpdate: new Date().toISOString(), totalOrders: merged.orders.length, orders: merged.orders }, null, 2), 'utf8');
    console.log('Done! Total: ' + merged.orders.length + ' (added ' + merged.added + ', updated ' + merged.updated + ', cancelled ' + merged.cancelled + ')');
    await browser.close();
  } catch(err) {
    console.error('Failed: ' + err.message);
  } finally {
    isUpdating = false;
  }
}

app.get('/api/orders', (req, res) => {
  try {
    if (fs.existsSync(DATA_FILE)) res.json(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    else res.json({ lastUpdate: null, totalOrders: 0, orders: [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/update', (req, res) => { res.json({ message: 'started' }); updateData(); });

app.get('/api/groups', (req, res) => {
  res.json({
  "李1": [
    "长沙雨花区鱼乎青百货商行（个人独资）企业店",
    "苏洛寻海犹女装专卖店",
    "苏洛寻琼海服装专卖店",
    "HKML鱼乎女装专卖店",
    "苏洛寻犹定服装专卖店",
    "苏洛寻海犹服饰专卖店",
    "琼海犹定商贸行（个人独资）企业店"
  ],
  "李2": [
    "永春县塑研贸易商行（个人独资）805企业店",
    "上和隆研服饰专卖店",
    "永春县塑研贸易商行（个人独资）企业店",
    "上和隆塑研服饰专卖店",
    "上和隆塑服饰专卖店"
  ],
  "李3": [
    "吉公堂贸易服饰专卖店",
    "吉公堂里贸服饰专卖店",
    "吉公堂里贸服装专卖店",
    "吉公堂虽里女装专卖店",
    "吉公堂虽里服装专卖店"
  ]
});
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('Server: http://localhost:' + PORT);
  console.log('API: http://localhost:' + PORT + '/api/orders');
  console.log('Update: http://localhost:' + PORT + '/api/update');
});

cron.schedule('*/' + config.UPDATE_INTERVAL + ' * * * *', () => updateData());
setTimeout(() => updateData(), 10000);
console.log('Ready. HEADLESS=' + config.HEADLESS);
