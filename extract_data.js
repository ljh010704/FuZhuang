const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { mergeOrders } = require('./merge_archive.js');

const OUTPUT_DIR = __dirname;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('[' + new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}) + '] \u5f00\u59cb\u66f4\u65b0...');
  
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });
  const SESSION_FILE = path.join(OUTPUT_DIR, '_erp_session.json');
  const ctxOpts = { viewport: { width: 1280, height: 800 } };
  if (fs.existsSync(SESSION_FILE)) ctxOpts.storageState = SESSION_FILE;
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  
  try {
    // Navigate to ERP
    console.log('\u6253\u5f00ERP\u7f51\u7ad9...');
    await page.goto('https://fx.fengsutb.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    console.log('\u8bf7\u5728\u6d4f\u89c8\u5668\u4e2d\u624b\u52a8\u767b\u5f55\uff0c\u767b\u5f55\u5b8c\u6210\u540e\u8fd4\u56de\u6b64\u5904\u6309\u56de\u8f66...');
    console.log('(\u81ea\u52a8\u68c0\u6d4b\u767b\u5f55\u72b6\u6001\u4e2d...)');
    
    // Wait for login to complete (URL changes from /login)
    for (let i = 0; i < 120; i++) {
      await sleep(2000);
      const url = page.url();
      if (!url.includes('login')) {
        console.log('\u767b\u5f55\u6210\u52af\uff01');
        break;
      }
      if (i % 10 === 0) {
        console.log('  \u7b49\u5f85\u767b\u5f55... (' + (i * 2) + '\u79d2)');
      }
    }
    
    try { await context.storageState({ path: SESSION_FILE }); console.log('会话已保存(_erp_session.json)'); } catch(e) {}

    // Navigate to order page
    console.log('\u8fdb\u5165\u8ba2\u5355\u9875\u9762...');
    await page.goto('https://fx.fengsutb.com/order/check', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);
    
    // Click Douyin
    console.log('\u9009\u62e9\u6296\u97f3\u5e73\u53f0...');
    try {
      const douyin = await page.locator('text=\u6296\u97f3').first();
      await douyin.click({ timeout: 10000 });
      await sleep(2000);
    } catch(e) {
      console.log('  \u6296\u97f3\u70b9\u51fb\u5931\u8d25\uff0c\u5c1d\u8bd5\u901a\u8fc7JS\u70b9\u51fb...');
      await page.evaluate(() => {
        const els = document.querySelectorAll('div, span, a');
        for (const el of els) {
          if (el.innerText === '\u6296\u97f3' && el.offsetParent !== null) {
            el.click();
            return;
          }
        }
      });
      await sleep(2000);
    }
    
    const allOrders = [];
    const failedTabs = [];
    
    const statusTabs = [
      '\u5df2\u53d1\u8d27',
      '\u5df2\u63a8\u9001\u5f85\u53d1\u8d27', 
      '\u5df2\u53d1\u8d27\u9000\u6b3e',
      '\u4ea4\u6613\u5173\u95ed'
    ];
    
    for (const tabName of statusTabs) {
      console.log('\u63d0\u53d6: ' + tabName);
      try {
        // Click status tab（等待渲染后精确点击 tab，避免点到隐藏的"已发货明细"菜单项）
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
          }, tabName);
          if (!clicked) await sleep(1000);
        }
        if (!clicked) throw new Error('tab not found: ' + tabName);
        await sleep(3000);
        
        // Scroll down to load more
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(1000);
        
        // Extract from page text
        const text = await page.evaluate(() => document.body.innerText);
        const productMap = await page.evaluate(() => {
          const map = {};
          document.querySelectorAll('.shop-body').forEach(function(card) {
            const m = (card.innerText || '').match(/平台订单号：\s*(\d{19})/);
            if (!m) return;
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
            map[m[1]] = products;
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
          const storeName = lines.length > 1 ? lines[0].trim() : null;
          
          const buyerMatch = sec.match(/\u4e70\u5bb6\u7559\u8a00:\s*(.*?)(?=\n)/);
          const sellerMatch = sec.match(/\u5356\u5bb6\u5907\u6ce8:\s*(.*?)(?=\n)/);
          const systemMatch = sec.match(/\u7cfb\u7edf\u5907\u6ce8:\s*(.*?)(?=\n)/);
          const shipMatch = sec.match(/\u63a8\u9001\u65f6\u95f4\uff1a([\d\-:\s]+)/);
          
          allOrders.push({
            platformOrderId: orderId,
            amount: amount,
            storeName: storeName,
            buyerNote: buyerMatch ? buyerMatch[1].trim() : '',
            sellerNote: sellerMatch ? sellerMatch[1].trim() : '',
            systemNote: systemMatch ? systemMatch[1].trim() : '',
            shipTime: shipMatch ? shipMatch[1].trim().substring(0, 19) : null,
            products: productMap[orderId] || [],
            status: tabName,
            platform: '\u6296\u97f3',
            sellerFlag: 0,
            systemFlag: 0,
            sellerFlagColor: 'rgb(170, 170, 170)',
            systemFlagColor: 'rgb(170, 170, 170)'
          });
        }
        
        console.log('  \u627e\u5230 ' + (sections.length - 1) + ' \u6761\u8ba2\u5355');
      } catch(e) {
        console.log('  \u9519\u8bef: ' + e.message);
        failedTabs.push(tabName);
      }
    }
    
    console.log('\u603b\u8ba1: ' + allOrders.length + ' \u6761\u8ba2\u5355');
    
    // Deduplicate
    const seen = {};
    const deduped = allOrders.filter(o => {
      if (seen[o.platformOrderId]) return false;
      seen[o.platformOrderId] = true;
      return true;
    });
    
    console.log('\u53bb\u91cd\u540e: ' + deduped.length + ' \u6761\u8ba2\u5355');
    
    // Merge with archive: keep orders that disappeared from ERP (e.g. buyer cancelled before shipping)
    const ARCHIVE_FILE = path.join(OUTPUT_DIR, 'orders_archive.json');
    let archive = [];
    if (fs.existsSync(ARCHIVE_FILE)) {
      try { archive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8')); } catch(e) { archive = []; }
    } else {
      try {
        const curHtml = fs.readFileSync(path.join(OUTPUT_DIR, 'public', 'index.html'), 'utf8');
        const dm = curHtml.match(/const RAW_DATA = (\[.*\]);/);
        if (dm) archive = JSON.parse(dm[1]);
      } catch(e) { archive = []; }
    }
    const scrapeOk = deduped.length >= 10 && failedTabs.indexOf('\u5df2\u63a8\u9001\u5f85\u53d1\u8d27') === -1;
    const merged = mergeOrders(archive, deduped, { allowCancel: scrapeOk });
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(merged.orders, null, 2), 'utf8');
    console.log('\u5408\u5e76\u5f52\u6863: \u65b0\u589e ' + merged.added + ', \u66f4\u65b0 ' + merged.updated + ', \u6807\u8bb0\u5df2\u53d6\u6d88 ' + merged.cancelled);

    // Write data file
    const dataJs = 'const RAW_DATA = ' + JSON.stringify(merged.orders) + ';\n';
    fs.writeFileSync(path.join(OUTPUT_DIR, 'dashboard_data.js'), dataJs, 'utf8');
    
    console.log('\u6570\u636e\u5df2\u4fdd\u5b58\u5230 dashboard_data.js');
    console.log('[' + new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}) + '] \u66f4\u65b0\u5b8c\u6210\uff01');
    
  } catch (err) {
    console.error('\u9519\u8bef:', err.message);
  } finally {
    console.log('\u5173\u95ed\u6d4f\u89c8\u5668...');
    await browser.close();
  }
}

main();
