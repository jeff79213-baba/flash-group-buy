// 剩餘數量；limit=0 表示不限量，回傳 -1
export function calculateRemaining(limit, sold) {
  if (!limit) return -1;
  return limit - (sold || 0);
}

// 驗證下單數量是否在活動/品項限制內
// limits 格式：{ itemId: limit }，其中 __total 表示活動總量
export function validateOrderQty(orderItems, counters, limits) {
  const total = orderItems.reduce((s, i) => s + i.qty, 0);
  for (const item of orderItems) {
    const sold = counters[item.itemId] || 0;
    const limit = limits[item.itemId] || 0;
    if (limit && sold + item.qty > limit) return { ok: false, itemId: item.itemId };
  }
  const totalSold = counters.__total || 0;
  const totalLimit = limits.__total || 0;
  if (totalLimit && totalSold + total > totalLimit) return { ok: false, itemId: "__total" };
  return { ok: true, total };
}

// 移除一筆訂單後的名額釋放（改單/刪單用）
export function releaseOrderCounters(orderItems, counters) {
  const next = { ...counters };
  for (const item of orderItems) {
    next[item.itemId] = (next[item.itemId] || 0) - item.qty;
    next.__total = (next.__total || 0) - item.qty;
  }
  return next;
}

// 套用一筆訂單的名額扣減（下單/改單用）
export function applyOrderCounters(orderItems, counters) {
  const next = { ...counters };
  for (const item of orderItems) {
    next[item.itemId] = (next[item.itemId] || 0) + item.qty;
    next.__total = (next.__total || 0) + item.qty;
  }
  return next;
}
