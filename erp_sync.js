// 风速分销 ERP 备注同步模块（纯 HTTP，使用 fx-token 鉴权）
// 实测接口映射（/order/check 抖音）：
//   POST /trade/seller-memo  sellerType:1 = 系统备注(localMemo+localFlag)
//                            sellerType:2 = 卖家备注(sellerMemo+sellerFlag)
//                            sellerType:3 = 买家留言(buyerMessage)
const fs = require('fs');
const path = require('path');

const BASE = 'https://fsdy2.fengsutb.com';
const TOKEN_FILE = path.join(__dirname, 'erp_token.txt');
const SESSION_FILE = path.join(__dirname, '_erp_session.json');

function loadToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  }
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      for (const o of (s.origins || [])) {
        for (const it of (o.localStorage || [])) {
          if (o.origin.indexOf('fengsutb') !== -1 && it.name === 'fx-token') return it.value;
        }
      }
    } catch (e) {}
  }
  return null;
}

function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, token.trim(), 'utf8');
}

async function api(token, url, body) {
  const r = await fetch(BASE + url, {
    method: 'POST',
    headers: {
      authorization: token,
      platform: 'dy',
      'content-type': 'application/json',
      referer: 'https://fx.fengsutb.com/'
    },
    body: JSON.stringify(body)
  });
  return r.json();
}

// 状态 tab: 1待推送 2已推送待发货 3待发货退款 4已发货 5已发货退款 6交易关闭
const STATUS_KEYS = [2, 3, 1, 4, 5, 6];

function orderTypeOf(statusKey) {
  if (statusKey === 4 || statusKey === 5 || statusKey === 41) return 1;
  if (statusKey === 6) return 2;
  return 0;
}

let mapCache = { time: 0, map: null };

async function orderMap(token) {
  if (mapCache.map && Date.now() - mapCache.time < 60000) return mapCache.map;
  const map = {};
  for (const st of STATUS_KEYS) {
    const j = await api(token, '/trade/list', {
      goodType: 1, tradeStatus: st, current: 1, size: 100,
      sort: 'PAY_TIME', sortAsc: false, timeType: 0, goodsFlag: 1, searchFlag: true
    });
    if (j.code !== 0) throw new Error('查询订单列表失败: ' + (j.message || ('code ' + j.code)));
    const list = (j.data && j.data.list) || [];
    for (const o of list) map[String(o.tid)] = { order: o, statusKey: st };
  }
  mapCache = { time: Date.now(), map: map };
  return map;
}

function invalidateCache() { mapCache = { time: 0, map: null }; }

function firstThree(order) {
  const twos = order.tradeAuditTwoListVos || [];
  const threes = (twos[0] && twos[0].tradeAuditThreeListVos) || [];
  return threes[0] || {};
}

async function writeMemo(token, sellerType, orderType, flag, memo, item) {
  const body = {
    sellerType: sellerType, type: 1, orderType: orderType,
    sellerMemo: memo || ' ',
    sellerMemoRequestList: [Object.assign({ sellerMemo: memo }, item)]
  };
  if (sellerType !== 3) body.sellerFlag = flag;
  return api(token, '/trade/seller-memo', body);
}

async function syncOne(token, entry) {
  const map = await orderMap(token);
  const found = map[String(entry.orderId)];
  if (!found) return { orderId: entry.orderId, ok: false, msg: 'ERP中未找到该订单（可能不在各状态前100条内）' };
  const o = found.order;
  const three = firstThree(o);
  const ot = orderTypeOf(found.statusKey);
  const item = { bizDpAccountId: o.dpAccountId, bizShopId: o.shopId, tid: String(o.tid) };
  const results = [];

  // 卖家备注/旗色 -> sellerType:2 (sellerMemo + sellerFlag)
  if (entry.sellerNote !== undefined || entry.sellerFlag !== undefined) {
    const memo = entry.sellerNote !== undefined ? entry.sellerNote : (three.offlineMemo || three.sellerMemo || '');
    const flag = entry.sellerFlag !== undefined ? entry.sellerFlag : (three.offlineFlag != null ? three.offlineFlag : (three.sellerFlag || 0));
    const j = await writeMemo(token, 2, ot, flag, memo, item);
    results.push(j.code === 0 ? '卖家备注OK' : '卖家备注失败(' + (j.message || j.code) + ')');
  }

  // 系统备注/旗色 -> sellerType:1 (localMemo + localFlag)
  if (entry.systemNote !== undefined || entry.systemFlag !== undefined) {
    const memo = entry.systemNote !== undefined ? entry.systemNote : (three.localMemo || '');
    const flag = entry.systemFlag !== undefined ? entry.systemFlag : (three.localFlag || 0);
    const j = await writeMemo(token, 1, ot, flag, memo, item);
    results.push(j.code === 0 ? '系统备注OK' : '系统备注失败(' + (j.message || j.code) + ')');
  }

  // 买家留言 -> sellerType:3 (buyerMessage)
  if (entry.buyerNote !== undefined) {
    const j = await writeMemo(token, 3, ot, 0, entry.buyerNote, item);
    results.push(j.code === 0 ? '买家留言OK' : '买家留言失败(' + (j.message || j.code) + ')');
  }

  const ok = results.every(function (r) { return r.indexOf('OK') !== -1; });
  return { orderId: entry.orderId, ok: ok, msg: results.join('；') || '无修改内容' };
}

async function syncOrders(token, changes) {
  const out = [];
  for (const c of changes.slice(0, 50)) {
    try {
      out.push(await syncOne(token, c));
    } catch (e) {
      out.push({ orderId: c.orderId, ok: false, msg: e.message });
    }
  }
  invalidateCache();
  return out;
}

module.exports = { loadToken, saveToken, syncOrders, orderMap };
