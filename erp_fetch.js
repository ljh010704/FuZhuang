// 风速分销 ERP 订单拉取（纯 HTTP API，使用 fx-token 鉴权，无需浏览器）
const BASE = 'https://fsdy2.fengsutb.com';
const { STORE_GROUPS } = require('./groups.js');

// 与本地提取一致的状态页签（key = /trade/list 的 tradeStatus）
// 状态优先级（去重时先到先得）：退款优先展示，与看板单状态模型一致
const STATUS_TABS = [
  { key: 2, name: '已推送待发货' },
  { key: 5, name: '已发货退款' },
  { key: 4, name: '已发货' },
  { key: 6, name: '交易关闭' }
];

// ERP 旗帜色（0-10）与看板 6 色盘（用于旗色编号映射，保持与 extract_data.js 一致）
const ERP_FLAG_COLORS = ['#aaaaaa', '#fd0000', '#ffc107', '#00fd28', '#0051fd', '#e000fc', '#F48804', '#41B4FA', '#E5B6B6', '#9BA217', '#E4248E'];
const DASH_PALETTE = [[170,170,170],[244,67,54],[255,152,0],[255,193,7],[0,253,40],[224,0,252]];

function hexToRgb(hex) {
  const h = String(hex || '#aaaaaa').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}
function nearestPalette(rgb) {
  let best = 0, bd = 1e9;
  DASH_PALETTE.forEach(function (p, i) {
    const d = (p[0]-rgb[0])*(p[0]-rgb[0]) + (p[1]-rgb[1])*(p[1]-rgb[1]) + (p[2]-rgb[2])*(p[2]-rgb[2]);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function rgbStr(hex) {
  const c = hexToRgb(hex);
  return 'rgb(' + c[0] + ', ' + c[1] + ', ' + c[2] + ')';
}
function parseSku(s) {
  if (!s) return '';
  try { const o = JSON.parse(s); return Object.keys(o).map(function (k) { return o[k]; }).join(';'); }
  catch (e) { return String(s); }
}

async function api(token, url, body) {
  const r = await fetch(BASE + url, {
    method: 'POST',
    headers: { authorization: token, platform: 'dy', 'content-type': 'application/json', referer: 'https://fx.fengsutb.com/' },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function fetchShopMap(token) {
  const r = await fetch(BASE + '/user/list', {
    method: 'GET',
    headers: { authorization: token, platform: 'dy', 'content-type': 'application/json', referer: 'https://fx.fengsutb.com/' }
  });
  const j = await r.json();
  const map = {};
  (j.data || []).forEach(function (s) {
    if (s.shopId) map[s.shopId] = s.shopName || s.nick || s.shopId;
  });
  return map;
}

function mapOrder(o, statusName, shopMap) {
  const threes = [];
  (o.tradeAuditTwoListVos || []).forEach(function (tw) {
    (tw.tradeAuditThreeListVos || []).forEach(function (th) { threes.push(th); });
  });
  const first = threes[0] || {};
  const sFlag = first.offlineFlag != null ? first.offlineFlag : (first.sellerFlag || 0);
  const lFlag = first.localFlag || 0;
  return {
    platformOrderId: String(o.tid),
    amount: ((o.payment || 0) / 100).toFixed(2),
    storeName: shopMap[o.shopId] || o.shopId || '',
    buyerNote: first.buyerMessage || '',
    sellerNote: first.offlineMemo || first.sellerMemo || '',
    systemNote: first.localMemo || '',
    shipTime: String(first.consignTime || o.createTime || '').slice(0, 19),
    products: threes.map(function (th) { return { img: th.picUrl || '', title: th.goodsTitle || '', spec: parseSku(th.skuProp) }; }),
    status: statusName,
    platform: '抖音',
    sellerFlag: nearestPalette(hexToRgb(ERP_FLAG_COLORS[sFlag] || '#aaaaaa')),
    systemFlag: nearestPalette(hexToRgb(ERP_FLAG_COLORS[lFlag] || '#aaaaaa')),
    sellerFlagColor: rgbStr(ERP_FLAG_COLORS[sFlag] || '#aaaaaa'),
    systemFlagColor: rgbStr(ERP_FLAG_COLORS[lFlag] || '#aaaaaa')
  };
}

async function fetchOrders(token) {
  const shopMap = await fetchShopMap(token);
  const out = [];
  for (const tab of STATUS_TABS) {
    let current = 1, total = Infinity;
    while ((current - 1) * 100 < total) {
      let j = null, list = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        j = await api(token, '/trade/list', {
          goodType: 1, tradeStatus: tab.key, current: current, size: 100,
          sort: 'PAY_TIME', sortAsc: false, timeType: 0, goodsFlag: 1, searchFlag: true
        });
        if (j.code !== 0) throw new Error('查询' + tab.name + '失败: ' + (j.message || ('code ' + j.code)));
        total = (j.data && j.data.total) || 0;
        list = (j.data && j.data.list) || [];
        if (list.length > 0 || total === 0) break; // total>0 但列表为空视为瞬时故障，重试
        await new Promise(function (r) { setTimeout(r, 2000); });
      }
      list.forEach(function (o) { out.push(mapOrder(o, tab.name, shopMap)); });
      await new Promise(function (r) { setTimeout(r, 500); }); // 避免触发ERP限流
      current++;
      if (list.length < 100) break;
    }
  }
  const seen = {}, dedup = [];
  out.forEach(function (o) {
    if (seen[o.platformOrderId]) return;
    seen[o.platformOrderId] = 1;
    dedup.push(o);
  });
  return dedup;
}

module.exports = { fetchOrders, fetchShopMap };
