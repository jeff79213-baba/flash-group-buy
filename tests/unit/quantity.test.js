import { describe, it, expect } from "vitest";
import {
  calculateRemaining,
  validateOrderQty,
  releaseOrderCounters,
  applyOrderCounters,
  swapOrderCounters
} from "../../lib/quantity.js";

describe("calculateRemaining", () => {
  it("limit=0 表示不限量回傳 -1", () => {
    expect(calculateRemaining(0, 5)).toBe(-1);
  });
  it("有上限時正確計算剩餘", () => {
    expect(calculateRemaining(50, 30)).toBe(20);
  });
});

describe("validateOrderQty", () => {
  it("未超量通過", () => {
    const ok = validateOrderQty(
      [{ itemId: "a", qty: 5 }],
      { a: 10, __total: 10 },
      { a: 50, __total: 100 }
    );
    expect(ok.ok).toBe(true);
    expect(ok.total).toBe(5);
  });
  it("品項超量失敗並回傳 itemId", () => {
    const res = validateOrderQty(
      [{ itemId: "a", qty: 10 }],
      { a: 45, __total: 45 },
      { a: 50, __total: 100 }
    );
    expect(res.ok).toBe(false);
    expect(res.itemId).toBe("a");
  });
  it("活動總量超量失敗", () => {
    const res = validateOrderQty(
      [{ itemId: "a", qty: 10 }],
      { a: 0, __total: 95 },
      { a: 50, __total: 100 }
    );
    expect(res.ok).toBe(false);
    expect(res.itemId).toBe("__total");
  });
});

describe("releaseOrderCounters / applyOrderCounters", () => {
  it("釋放名額（含 __total）", () => {
    const next = releaseOrderCounters(
      [{ itemId: "a", qty: 3 }],
      { a: 10, __total: 20 }
    );
    expect(next.a).toBe(7);
    expect(next.__total).toBe(17);
  });
  it("扣減名額（含 __total）", () => {
    const next = applyOrderCounters(
      [{ itemId: "a", qty: 3 }],
      { a: 10, __total: 20 }
    );
    expect(next.a).toBe(13);
    expect(next.__total).toBe(23);
  });
  it("swap：換單釋放舊數量並套用新數量", () => {
    const next = swapOrderCounters(
      [{ itemId: "a", qty: 2 }],
      [{ itemId: "b", qty: 3 }],
      { a: 10, b: 1, __total: 11 }
    );
    expect(next.a).toBe(8);
    expect(next.b).toBe(4);
    expect(next.__total).toBe(12);
  });
});
