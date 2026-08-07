// 订单归档合并模块
// 作用：每次抓数后与历史归档合并，订单只增不删；
// 原本处于"已推送待发货"的订单如果从ERP消失（顾客发货前取消），标记为"已取消"保留在看板中。

const CANCELLED_STATUS = '已取消';
const PENDING_STATUS = '已推送待发货';

function mergeOrders(archiveOrders, scrapedOrders, options) {
  const opts = options || {};
  const allowCancel = opts.allowCancel !== false;
  const now = new Date().toISOString();
  const byId = new Map();
  for (const o of archiveOrders || []) {
    if (o && o.platformOrderId) byId.set(o.platformOrderId, o);
  }
  let added = 0;
  let updated = 0;
  const seenIds = new Set();
  for (const s of scrapedOrders || []) {
    if (!s || !s.platformOrderId || seenIds.has(s.platformOrderId)) continue;
    seenIds.add(s.platformOrderId);
    const existing = byId.get(s.platformOrderId);
    if (existing) {
      existing.status = s.status;
      if (s.amount != null) existing.amount = s.amount;
      if (s.storeName) existing.storeName = s.storeName;
      if (s.buyerNote != null) existing.buyerNote = s.buyerNote;
      if (s.sellerNote != null) existing.sellerNote = s.sellerNote;
      if (s.systemNote != null) existing.systemNote = s.systemNote;
      if (s.shipTime) existing.shipTime = s.shipTime;
      if (s.products && s.products.length) existing.products = s.products;
      if (s.sellerFlag) {
        existing.sellerFlag = s.sellerFlag;
        existing.sellerFlagColor = s.sellerFlagColor;
      }
      if (s.systemFlag) {
        existing.systemFlag = s.systemFlag;
        existing.systemFlagColor = s.systemFlagColor;
      }
      delete existing.cancelledAt;
      updated++;
    } else {
      byId.set(s.platformOrderId, s);
      added++;
    }
  }
  let cancelled = 0;
  if (allowCancel) {
    for (const o of byId.values()) {
      if (o.status === PENDING_STATUS && !seenIds.has(o.platformOrderId)) {
        o.status = CANCELLED_STATUS;
        o.cancelledAt = now;
        cancelled++;
      }
    }
  }
  return { orders: Array.from(byId.values()), added, updated, cancelled };
}

module.exports = { mergeOrders, CANCELLED_STATUS, PENDING_STATUS };
