# 訂單修改 / 取消功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓客人在下單頁修改（換品項/數量/名字/後三碼）或取消自己的訂單，每人限 3 次，取消後可重新下單；後台不需編輯功能。

**Architecture:** 沿用單一訂單 doc（id = 客人 uid）。新增 `lib/quantity.js` 的 `swapOrderCounters` 純函式處理「釋放舊 + 套用新」counter。`index.html` 加「修改/取消」UI 與兩個獨立 transaction（`updateOrder` / `cancelOrder`）。`firestore.rules` 放寬本人 update/delete（綁定 `editCount` 遞增與上限）。

**Tech Stack:** vanilla JS + Firebase (web compat SDK, Firestore REST rules)，Vitest 單元測試，Playwright E2E。

## Global Constraints

- Firebase project：`flash-group-buy-sk`；前端 API key 不變
- `editCount` 上限 = `MAX_EDITS`（`lib/editlimit.js`，值 3）
- 中文 UI 文案（toast、按鈕）
- Firestore rules 不可為 `if true`
- 下單 create 路徑的「訂單已存在即拒絕」檢查（index.html:354-357）**不可移除**（上一輪 bug 修復）
- 每個 Task 完成後 commit + push（AGENTS.md 自動部署原則）
- 檔案皆在 `C:\Users\TW-10\Documents\firebase雲端資料夾\快閃糾團\`

---

### Task 1: lib/quantity.js 新增 swapOrderCounters + 單元測試

**Files:**
- Modify: `lib/quantity.js:22-40`
- Modify: `tests/unit/quantity.test.js:48-64`

**Interfaces:**
- Produces: `export function swapOrderCounters(oldItems, newItems, counters)` — 先 `releaseOrderCounters(oldItems, counters)` 再 `applyOrderCounters(newItems, next)`，回傳新的 counters 物件（`__orders` 不處理）。

- [ ] **Step 1: 寫失敗測試**

在 `tests/unit/quantity.test.js` 的 `describe("releaseOrderCounters / applyOrderCounters")` 內補一個 `it`：

```js
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
```

並把 import 加上 `swapOrderCounters`：

```js
import {
  calculateRemaining,
  validateOrderQty,
  releaseOrderCounters,
  applyOrderCounters,
  swapOrderCounters
} from "../../lib/quantity.js";
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/unit/quantity.test.js`
Expected: FAIL — `swapOrderCounters is not a function`

- [ ] **Step 3: 實作函式**

在 `lib/quantity.js` 的 `applyOrderCounters` 之後新增：

```js
// 換單：先釋放舊訂單名額，再套用新訂單名額（__orders 人數不變，由呼叫方自行處理）
export function swapOrderCounters(oldItems, newItems, counters) {
  const released = releaseOrderCounters(oldItems, counters);
  return applyOrderCounters(newItems, released);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/unit/quantity.test.js`
Expected: PASS（3 個 describe 全綠，新增 swap 測試通過）

- [ ] **Step 5: Commit**

```bash
git add lib/quantity.js tests/unit/quantity.test.js
git commit -m "feat: 新增 swapOrderCounters 換單計數函式與測試"
git push
```

---

### Task 2: firestore.rules 允許本人修改/取消訂單（限 editCount）

**Files:**
- Modify: `firestore.rules:111-112`

**Interfaces:**
- Produces: order `update` 允許「管理員 或（本人 + editCount 恰好+1 且 ≤3 + isPaid/createdBy 不變）」；`delete` 允許「管理員 或（本人 + editCount<3）」。
- Consumes: 無。

- [ ] **Step 1: 修改規則**

將 `firestore.rules` 第 111-112 行：

```
        // 訂單不可由本人覆寫（每人限一單）：管理員可管理他人的單，但不可 update 自己 uid 的訂單
        // （防止同 uid 連續下單時，管理員身份的第二單覆寫第一單）
        allow update: if isAdmin(eventId) && orderId != request.auth.uid;
        allow delete: if isAdmin(eventId);
```

取代為：

```
        // 本人可修改/取消自己的訂單（最多 editCount 上限次）；管理員可經營全部。
        // 本人 update 必須 editCount 恰好 +1 且 <=3、isPaid/createdBy 不可變（防覆寫、防改收款）。
        allow update: if isAdmin(eventId)
          || (orderId == request.auth.uid
              && request.resource.data.editCount == resource.data.editCount + 1
              && request.resource.data.editCount <= 3
              && request.resource.data.isPaid == resource.data.isPaid
              && request.resource.data.createdBy == resource.data.createdBy);
        allow delete: if isAdmin(eventId)
          || (orderId == request.auth.uid && resource.data.editCount < 3);
```

- [ ] **Step 2: 部署並驗證規則編譯**

Run: `firebase deploy --only firestore:rules --project flash-group-buy-sk`
Expected: `rules file firestore.rules compiled successfully` 與 `Deploy complete!`

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat: 規則允許本人修改/取消自己的訂單（editCount 遞增、上限3次）"
git push
```

---

### Task 3: index.html 我的訂單區塊加修改/取消 UI（editing 模式基底）

**Files:**
- Modify: `index.html:88-89`（import）
- Modify: `index.html:97`（狀態變數）
- Modify: `index.html:218`（送出按鈕文字/取消修改按鈕）
- Modify: `index.html:251-265`（renderMyOrders）

**Interfaces:**
- Produces: `let editing = false;`、`window._editOrder()`（開啟修改模式）、`window._cancelEdit()`（取消修改模式）。
- Consumes: `canEdit`/`canDelete`/`remainingEdits` from `lib/editlimit.js`（Task 基底，已有）。

- [ ] **Step 1: import editlimit 並加 editing 狀態**

將 index.html:89：

```js
import { calculateRemaining, validateOrderQty, applyOrderCounters } from "./lib/quantity.js";
```

改為：

```js
import { calculateRemaining, validateOrderQty, applyOrderCounters, releaseOrderCounters, swapOrderCounters } from "./lib/quantity.js";
import { canEdit, canDelete, remainingEdits } from "./lib/editlimit.js";
```

將 index.html:97 的狀態變數區補一項（在 `let myOrders = [];` 之後）：

```js
let editing = false;            // 是否處於「修改訂單」模式
```

- [ ] **Step 2: 修改 render() 送出按鈕與取消修改按鈕**

將 index.html:218：

```html
        <button class="btn btn-primary" id="submitBtn" onclick="window._submit()">送出訂單</button>
```

改為：

```html
        <button class="btn btn-primary" id="submitBtn" onclick="window._submit()">${editing ? '更新訂單' : '送出訂單'}</button>
        ${editing ? '<button class="btn-sm btn-del" style="margin-top:8px" onclick="window._cancelEdit()">取消修改</button>' : ''}
```

- [ ] **Step 3: 改寫 renderMyOrders 顯示修改/取消按鈕與剩餘次數**

將 index.html:251-265 整段：

```js
function renderMyOrders() {
  if (myOrders.length === 0) return '<div class="empty">你還沒有訂單</div>';
  return myOrders.map(o => {
    const detail = o.items.map(i => i.name + " x" + i.qty + " ($" + i.price * i.qty + ")").join("、");
    return `
      <div class="order-item">
        <div class="order-name">
          <span>${esc(o.buyerName)}${o.isPaid ? '<span class="order-paid">已收款</span>' : ''}</span>
        </div>
        <div class="order-detail">${esc(detail)}</div>
        <div class="order-total">合計 $${o.totalPrice}</div>
        <div style="font-size:11px;color:#999;margin-top:6px">訂單送出後不可修改，如需調整請聯絡主辦</div>
      </div>`;
  }).join("");
}
```

改為：

```js
function renderMyOrders() {
  if (myOrders.length === 0) return '<div class="empty">你還沒有訂單</div>';
  return myOrders.map(o => {
    const detail = o.items.map(i => i.name + " x" + i.qty + " ($" + i.price * i.qty + ")").join("、");
    const remain = remainingEdits(o.editCount);
    const actions = (canEdit(o.editCount) || canDelete(o.editCount))
      ? `
      <div style="font-size:11px;color:#999;margin-top:6px">還可修改/取消 ${remain} 次</div>
      <div style="margin-top:8px">
        ${canEdit(o.editCount) ? '<button class="btn-sm btn-edit" onclick="window._editOrder()">修改</button>' : ''}
        ${canDelete(o.editCount) ? '<button class="btn-sm btn-del" onclick="window._cancelOrder()">取消</button>' : ''}
      </div>`
      : '<div style="font-size:11px;color:#999;margin-top:6px">訂單已達修改上限，如需調整請聯絡主辦</div>';
    return `
      <div class="order-item">
        <div class="order-name">
          <span>${esc(o.buyerName)}${o.isPaid ? '<span class="order-paid">已收款</span>' : ''}</span>
        </div>
        <div class="order-detail">${esc(detail)}</div>
        <div class="order-total">合計 $${o.totalPrice}</div>
        ${actions}
      </div>`;
  }).join("");
}
```

- [ ] **Step 4: 新增 _editOrder / _cancelEdit**

在 `updateTotal`（index.html:318）之後、`window._submit` 之前插入：

```js
window._editOrder = async function() {
  const o = myOrders[0];
  if (!o) return;
  if (!canEdit(o.editCount)) { showToast("訂單已達修改上限，如需調整請聯絡主辦"); return; }
  editing = true;
  selected = {};
  o.items.forEach(i => { selected[i.itemId] = i.qty; });
  document.getElementById("buyerName").value = o.buyerName;
  try {
    const pSnap = await db.collection("fgq_orders_phones").doc(currentEventId).collection("orders").doc(currentUser.uid).get();
    if (pSnap.exists) document.getElementById("phoneLast3").value = pSnap.data().phoneLast3 || "";
  } catch (e) {}
  render();
  showToast("請調整品項後點「更新訂單」");
};

window._cancelEdit = function() {
  editing = false;
  selected = {};
  document.getElementById("buyerName").value = "";
  document.getElementById("phoneLast3").value = "";
  render();
};
```

- [ ] **Step 5: 手動驗證 UI**

Run: 開啟 `index.html`（可用 `npx serve .` 或直接開檔案，但需已部署的活動才可測完整流程）。此步只需確認頁面載入無 JS 錯誤：
Run: `npx vitest run`
Expected: 既有 16 測試仍全 PASS（此步無新邏輯、僅 UI，若無法瀏覽測試可跳過實際載入）。

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: 我的訂單區塊新增修改/取消按鈕與剩餘次數提示"
git push
```

---

### Task 4: index.html 修改訂單 transaction（updateOrder）

**Files:**
- Modify: `index.html:320-398`（_submit 分流）

**Interfaces:**
- Consumes: `editing`、`releaseOrderCounters`（Task 3/1）、`validateOrderQty`、`swapOrderCounters`。
- Produces: `async function updateOrder(name, phone, orderItems, totalPrice, limits)`。

- [ ] **Step 1: 在 _submit 開頭分流**

將 index.html:320 的 `window._submit` 函式開頭（name/phone 驗證與 orderItems 組裝後、`const btn = ...` 之前）插入分流：

```js
  // 修改模式：走更新流程
  if (editing) {
    await updateOrder(name, phone, orderItems, totalPrice, limits);
    return;
  }
```

實際插入點：在 `const limits = {}; items.forEach(...)`（index.html:335-336）之後、`const btn = ...`（index.html:338）之前。

- [ ] **Step 2: 新增 updateOrder 函式**

在 `window._submit` 函式結束（`};` 在 index.html:398）之後、`showToast` 之前插入：

```js
async function updateOrder(name, phone, orderItems, totalPrice, limits) {
  const btn = document.getElementById("submitBtn");
  btn.disabled = true; btn.textContent = "更新中...";
  try {
    await db.runTransaction(async tx => {
      const orderRef = db.collection("fgq_events").doc(currentEventId).collection("orders").doc(currentUser.uid);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new Error("訂單不存在");
      const old = orderSnap.data();
      if ((old.editCount || 0) >= 3) throw new Error("訂單已達修改上限，如需調整請聯絡主辦");
      const counterSnap = {};
      for (const key of ["__total", ...items.map(i => i.id)]) {
        const ref = db.collection("fgq_events").doc(currentEventId).collection("counters").doc(key);
        const snap = await tx.get(ref);
        counterSnap[key] = snap.exists ? (snap.data().sold || 0) : 0;
      }
      // 先釋放舊訂單再驗證，允許把原數量換到其他品項
      const released = releaseOrderCounters(old.items, counterSnap);
      const check = validateOrderQty(orderItems, released, limits);
      if (!check.ok) throw new Error("部分品項數量不足");
      const next = swapOrderCounters(old.items, orderItems, counterSnap);
      tx.update(orderRef, {
        buyerName: name,
        items: orderItems,
        totalPrice,
        editCount: (old.editCount || 0) + 1
      });
      const keys = new Set(["__total", ...old.items.map(i => i.itemId), ...orderItems.map(i => i.itemId)]);
      for (const key of keys) {
        tx.set(db.collection("fgq_events").doc(currentEventId).collection("counters").doc(key), { sold: next[key] });
      }
      // 後三碼更新（order 存在時本人可寫）
      tx.set(db.collection("fgq_orders_phones").doc(currentEventId).collection("orders").doc(currentUser.uid), { phoneLast3: phone });
      return true;
    });
    showToast("訂單已更新");
    editing = false;
    selected = {};
    document.getElementById("buyerName").value = "";
    document.getElementById("phoneLast3").value = "";
    await loadCounters();
    render();
  } catch (e) {
    showToast("更新失敗：" + e.message);
  }
  btn.disabled = false; btn.textContent = "送出訂單";
}
```

- [ ] **Step 3: 單元層驗證（純邏輯）**

`updateOrder` 本身是 async transaction，不易單元化；counter 計算邏輯已由 Task 1 的 `swapOrderCounters` 單元測試涵蓋。此步跑既有測試確認無回歸：
Run: `npx vitest run`
Expected: 全 PASS（至少 17 測試，含 Task 1 新增）。

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: 下單頁修改訂單流程（updateOrder transaction）"
git push
```

---

### Task 5: index.html 取消訂單 transaction（cancelOrder）

**Files:**
- Modify: `index.html`（在 `updateOrder` 之後新增 `window._cancelOrder`）

**Interfaces:**
- Consumes: `editing`、`releaseOrderCounters`、`canDelete`/`remainingEdits`。
- Produces: `window._cancelOrder()`。

- [ ] **Step 1: 新增 cancelOrder**

在 `updateOrder` 函式之後、`showToast` 之前插入：

```js
window._cancelOrder = async function() {
  const o = myOrders[0];
  if (!o) return;
  if (!canDelete(o.editCount)) { showToast("訂單已達修改上限，如需調整請聯絡主辦"); return; }
  if (!confirm("確定取消訂單？取消後可重新下單。剩餘修改/取消次數：" + remainingEdits(o.editCount))) return;
  try {
    await db.runTransaction(async tx => {
      const orderRef = db.collection("fgq_events").doc(currentEventId).collection("orders").doc(currentUser.uid);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new Error("訂單不存在");
      const old = orderSnap.data();
      if ((old.editCount || 0) >= 3) throw new Error("訂單已達修改上限");
      const counterSnap = {};
      for (const key of ["__total", "__orders", ...items.map(i => i.id)]) {
        const ref = db.collection("fgq_events").doc(currentEventId).collection("counters").doc(key);
        const snap = await tx.get(ref);
        counterSnap[key] = snap.exists ? (snap.data().sold || 0) : 0;
      }
      let next = releaseOrderCounters(old.items, counterSnap);
      next.__orders = Math.max(0, (next.__orders || 0) - 1);
      tx.delete(orderRef);
      for (const key of ["__total", "__orders", ...old.items.map(i => i.itemId)]) {
        tx.set(db.collection("fgq_events").doc(currentEventId).collection("counters").doc(key), { sold: next[key] });
      }
      // 清除洗單防護，允許同一裝置重新下單
      tx.delete(db.collection("fgq_events").doc(currentEventId).collection("rate_limits").doc(currentUser.uid));
      // 後三碼刪除（order 尚存在時本人可刪）
      tx.delete(db.collection("fgq_orders_phones").doc(currentEventId).collection("orders").doc(currentUser.uid));
      return true;
    });
    showToast("訂單已取消");
    editing = false;
    selected = {};
    document.getElementById("buyerName").value = "";
    document.getElementById("phoneLast3").value = "";
    await loadCounters();
    render();
  } catch (e) {
    showToast("取消失敗：" + e.message);
  }
};
```

- [ ] **Step 2: 既有測試確認無回歸**

Run: `npx vitest run`
Expected: 全 PASS。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: 下單頁取消訂單流程（釋放計數器、清除洗單防護）"
git push
```

---

### Task 6: E2E 測試（跨角色：客人修改/取消 → 後台同步）

**Files:**
- Create: `scripts/seed-e2e.mjs`
- Modify: `tests/e2e/order-flow.spec.js`

**Interfaces:**
- Consumes: 已部署的 GitHub Pages（`https://jeff79213-baba.github.io/flash-group-buy/`）。
- Produces: seed 腳本建立活動（short `E2E123456` / pw `e2e12345` / share `E2ETST`）；測試涵蓋修改同步、取消重下、次數用罄。

- [ ] **Step 1: 建立 seed 腳本**

建立 `scripts/seed-e2e.mjs`（REST 建活動 + 品項 + 管理員 session，重跑前先清舊活動）：

```js
const BASE = 'https://firestore.googleapis.com/v1/projects/flash-group-buy-sk/databases/(default)/documents';
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaSyCRjAya1_8gZHLSS6ATNOn7xaqD-Vokd7s';
async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return { _html: t.slice(0, 150) }; } }

(async () => {
  const a = await j(await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) }));
  const H = { Authorization: 'Bearer ' + a.idToken, 'Content-Type': 'application/json' };
  const evId = 'E2ETST';
  // 清舊活動（若存在）
  await fetch(BASE + '/fgq_events/' + evId, { method: 'DELETE', headers: H }).catch(() => {});
  await fetch(BASE + '/fgq_admin/' + evId, { method: 'DELETE', headers: H }).catch(() => {});
  // 建活動
  await fetch(BASE + '/fgq_events?documentId=' + evId, { method: 'POST', headers: H, body: JSON.stringify({ fields: { name: { stringValue: 'E2E測試揪團' }, shortCode: { stringValue: 'E2E123456' }, shareCode: { stringValue: 'E2ETST' }, createdAt: { timestampValue: new Date().toISOString() } } }) });
  await fetch(BASE + '/fgq_admin?documentId=' + evId, { method: 'POST', headers: H, body: JSON.stringify({ fields: { adminPassword: { stringValue: 'e2e12345' }, createdAt: { timestampValue: new Date().toISOString() } } }) });
  await fetch(BASE + '/fgq_sessions?documentId=' + a.localId, { method: 'POST', headers: H, body: JSON.stringify({ fields: { eventId: { stringValue: evId }, adminPassword: { stringValue: 'e2e12345' }, createdAt: { timestampValue: new Date().toISOString() } } }) });
  // 品項：測試蛋糕（限量50）、測試餅乾（不限量）
  await fetch(BASE + '/fgq_events/' + evId + '/items?documentId=cake', { method: 'POST', headers: H, body: JSON.stringify({ fields: { name: { stringValue: '測試蛋糕' }, price: { integerValue: 100 }, limit: { integerValue: 50 }, createdAt: { timestampValue: new Date().toISOString() } } }) });
  await fetch(BASE + '/fgq_events/' + evId + '/items?documentId=cookie', { method: 'POST', headers: H, body: JSON.stringify({ fields: { name: { stringValue: '測試餅乾' }, price: { integerValue: 50 }, limit: { integerValue: 0 }, createdAt: { timestampValue: new Date().toISOString() } } }) });
  console.log('E2E 活動已就緒，管理員 uid:', a.localId);
})().catch(e => { console.error(e); process.exit(1); });
```

Run: `node scripts/seed-e2e.mjs`
Expected: 輸出「E2E 活動已就緒」。

- [ ] **Step 2: 部署 hosting（供 E2E 用）**

Run: `firebase deploy --only hosting --project flash-group-buy-sk`
Expected: `Deploy complete!`

- [ ] **Step 3: 新增 E2E 測試**

在 `tests/e2e/order-flow.spec.js` 末尾新增（每個測試用獨立 browser context = 不同匿名 uid）：

```js
test("修改訂單數量 → 後台同步顯示", async ({ browser }) => {
  const buyer = await (await browser.newContext()).newPage();
  const admin = await (await browser.newContext()).newPage();
  await admin.goto(BASE + "admin.html");
  await admin.fill("#loginShortCode", SHORT_CODE);
  await admin.fill("#loginPassword", PASSWORD);
  await admin.click("button:has-text('登入')");
  await expect(admin.getByText("活動設定")).toBeVisible({ timeout: 20000 });

  await buyer.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(buyer.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await buyer.locator(`.item-check[data-id="cake"]`).check();
  await buyer.fill("#buyerName", "修改測試");
  await buyer.fill("#phoneLast3", "123");
  await buyer.click("#submitBtn");
  await expect(buyer.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });
  await expect(admin.locator("#ordersAdminList").getByText("修改測試")).toBeVisible({ timeout: 15000 });

  await buyer.click("button:has-text('修改')");
  await buyer.click("button:has-text('+')");
  await buyer.click("#submitBtn");
  await expect(buyer.getByText("訂單已更新")).toBeVisible({ timeout: 15000 });
  await expect(buyer.locator("#myOrdersList").getByText(/測試蛋糕 x2/)).toBeVisible();
  await expect(admin.locator("#ordersAdminList").getByText(/測試蛋糕 x2/)).toBeVisible({ timeout: 15000 });
  await buyer.close();
  await admin.close();
});

test("取消訂單 → 可重新下單", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "取消測試");
  await page.fill("#phoneLast3", "456");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });

  page.on("dialog", d => d.accept());
  await page.click("button:has-text('取消')");
  await expect(page.getByText("訂單已取消")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#myOrdersList").getByText("取消測試")).not.toBeVisible();

  // 同一瀏覽器可重新下單
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "取消測試2");
  await page.fill("#phoneLast3", "789");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#myOrdersList").getByText("取消測試2")).toBeVisible();
  await page.close();
});
```

- [ ] **Step 4: 跑 E2E**

Run: `npx playwright test tests/e2e/order-flow.spec.js`
Expected: 新增測試 PASS（既有測試若依賴舊版 `#allOrdersList` 而失敗，為既有問題，不阻塞本功能；記錄於操作紀錄）。

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-e2e.mjs tests/e2e/order-flow.spec.js
git commit -m "test: 訂單修改/取消 E2E（客人改單→後台同步、取消→重下）"
git push
```

---

### Task 7: 完整驗證 + 部署 + 操作紀錄

**Files:**
- Modify: `操作紀錄.md`

**Interfaces:**
- Consumes: 全部先前任務。

- [ ] **Step 1: 跑全部單元測試**

Run: `npx vitest run`
Expected: 全 PASS（含 Task 1 新增測試）。

- [ ] **Step 2: 跑全部 E2E**

Run: `npx playwright test`
Expected: 本功能測試 PASS；既有失敗（若有）列入操作紀錄。

- [ ] **Step 3: 部署 hosting + rules**

Run: `firebase deploy --only hosting,firestore:rules --project flash-group-buy-sk`
Expected: `Deploy complete!`

- [ ] **Step 4: 更新操作紀錄**

在 `操作紀錄.md` 開頭新增章節，記錄：功能內容（修改/取消、限3次、取消可重下、後台不加編輯）、改動檔案（index.html、firestore.rules、lib/quantity.js）、驗證結果、commit hash。

- [ ] **Step 5: Commit**

```bash
git add 操作紀錄.md
git commit -m "docs: 記錄訂單修改/取消功能完成與驗證"
git push
```

- [ ] **Step 6: 回報**

回報「已上傳部署完成」，附 GitHub Pages URL 與測試結果摘要。
