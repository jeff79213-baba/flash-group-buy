# 快閃揪團：多筆訂單模型改版設計

- 日期：2026-08-06
- 狀態：已與使用者確認需求與設計
- 相關檔案：`index.html`、`admin.html`、`firestore.rules`、`lib/quantity.js`、`lib/editlimit.js`（將移除）、`tests/`、`scripts/seed-e2e.mjs`

## 背景與目標

目前設計為「每人（每裝置）限一單，訂單 doc id = 客人 uid，可修改/取消最多 3 次」。實務上同一活動常有親友共用裝置、或取消後想再下單的需求，且修改功能使用率低。

本改版解除「每人限一單」，改為**同一網址（同一活動）可重複下單，只要（姓名＋手機後三碼）組合不同**；(姓名＋後三碼) 於同活動內唯一。同時**移除「修改」功能，只保留「取消/刪除」**，取消後需等 10 秒才能用相同 (姓名＋後三碼) 重下。並修正下單數量可超過上限的 Bug。

### 已確認需求
1. 解除「每人限一單」：同一網址可重複下單，只要 (姓名＋手機後三碼) 組合不同即可
2. (姓名＋後三碼) 組合於**同活動內唯一**，已存在有效訂單時阻擋重複下單
3. 移除「修改」功能，只保留「取消/刪除」訂單
4. 取消後等 **10 秒**才能以相同 (姓名＋後三碼) 重下
5. 下單時若超過剩餘總數量，數量就不能再加（即時限量，不能先超過再送出失敗）
6. 統計區「多少人下單」標籤改為「訂單數」（一人可多筆）

### 明確不做
- 不做「修改」功能（整段移除）
- 不做既有測試資料遷移（雞排活動資料由使用者自行刪除重建）
- 維持既有 `lib/quantity.js` 數量驗證邏輯（`calculateRemaining`、`validateOrderQty`、`applyOrderCounters`、`releaseOrderCounters` 沿用；`swapOrderCounters` 因修改功能移除而不再使用）

## 架構與元件

### 元件 1：訂單主鍵 orderKey（取代 uid）

- 下單時前端計算 `orderKey = phoneLast3 + "_" + 姓名`；姓名中的 Firestore 文件 id 非法字元（`/`、`.`、`#`、`$`、`[`、`]`）以 `_` 取代
- order 文件 id = `orderKey`，(姓名＋後三碼) 唯一性**由文件 id 存在性天然強制**：同組合再下單 → 寫入目標已存在 → 觸發 update（非 create），而一般使用者無 update 權限 → 寫入失敗
- 移除 order 文件內的 uid 主鍵邏輯，改為 `createdBy` 欄位記錄下單者 uid
- 既有 `rate_limits` 由 `{uid}` 改為 `{orderKey}` 為鍵

**資料結構（order 文件）**：
```
orderKey: string       // phoneLast3 + "_" + 姓名
buyerName: string      // 姓名
phoneLast3: string     // 3 位數字
items: [{id, qty}]
totalPrice: number
createdBy: string      // 下單者 uid
isPaid: bool
createdAt: timestamp
```

### 元件 2：移除「修改」功能

- 刪除 `lib/editlimit.js` 與 `tests/unit/editlimit.test.js`
- 移除 `index.html` 中的 `canEdit`/`canDelete`/`remainingEdits` 使用、`_editOrder`、`_cancelEdit`、`updateOrder`、editing 狀態、`_editOrder` 相關事件
- 移除 `lib/quantity.js` 的 `swapOrderCounters`（僅修改流程使用）及其測試
- 移除 order 文件 `editCount` 欄位與 rules 中 editCount 相關條件
- 我的訂單區塊只剩「取消」按鈕

### 元件 3：後三碼存入 order 文件（取代 fgq_orders_phones）

- `phoneLast3` 直接寫入 order 文件，移除 `fgq_orders_phones` 集合及其 rules、admin 讀取、下單/取消/後台刪單中的相關操作
- `admin.html` 後台直接讀 `o.phoneLast3` 顯示（不再 join）
- 既有訂單無此欄位 → 後台顯示「—」（使用者會刪除重建，不遷移）

### 元件 4：取消 + 10 秒冷卻

- 取消走 transaction `cancelOrder`：
  - `tx.get` 讀 order（驗證 `createdBy == currentUser.uid`）與 counters
  - `tx.delete(orderRef)`
  - counters：釋放該訂單所有品項數量與 `__total`、`__orders`（`releaseOrderCounters`）
  - `tx.set(rate_limits/{orderKey}, { lastOrderAt: now })` — **保留 10 秒冷卻**，防止取消後立即用相同組合重下
- Rules `orders` create 檢查：
  - `orderId`（= orderKey）與 `request.resource.data.orderKey` 一致
  - `!exists(rate_limits/{orderKey}) || request.time - lastOrderAt >= 10 秒`
- 成功下單時 transaction 同步 `tx.set(rate_limits/{orderKey}, { lastOrderAt: now })`（防連刷）

### 元件 5：數量即時控制（修 Bug：可超過再送出失敗）

- `counters` onSnapshot **改用 snapshot 資料更新 `counters` 變數並重繪**（現況忽略 snapshot 資料，僅重繪統計，造成 `_qty` 上限用 stale 值）
- 售完（`limit - sold <= 0`）品項：checkbox disabled + 標示「已售完」（現況只防 deadline）
- `_qty` 增加時上限 = `limit - sold`（即時）；`+` 按鈕達上限時 disabled
- `_sel` 勾選售完品項直接擋掉並 toast

### 元件 6：我的訂單區塊

- 由單筆 `orders/{uid}` 改為查詢 `orders where createdBy == currentUser.uid`（`getWhere`/query）
- 每筆訂單卡片：姓名、明細、總額、取消按鈕（無修改）
- 取消按鈕 `onclick="window._cancelOrder('<orderKey>')"`（轉義安全）

### 元件 7：Firestore Security Rules

`orders`（改以 orderKey 為鍵）：
```
allow create: if isLoggedIn()
  && request.resource.data.createdBy == request.auth.uid
  && request.resource.data.orderKey == orderId
  && request.resource.data.buyerName is string
  && request.resource.data.buyerName != ''
  && request.resource.data.phoneLast3 is string
  && request.resource.data.phoneLast3.matches('[0-9]{3}')
  && request.resource.data.isPaid == false
  && request.resource.data.items is list
  && request.resource.data.items.size() > 0
  && (!exists(rate_limits/{orderId})
      || request.time - rate_limits/{orderId}.lastOrderAt >= duration.value(10, 's'));
allow read: if isLoggedIn() && (resource.data.createdBy == request.auth.uid || isAdmin(eventId));
allow update: if isAdmin(eventId);   // 僅後台 toggle paid
allow delete: if isAdmin(eventId) || resource.data.createdBy == request.auth.uid;
```

`rate_limits`（改以 orderKey 為鍵）：
```
allow read: if isLoggedIn();
allow create, update: if isLoggedIn();   // 本人下單/取消時寫入
allow delete: if isAdmin(eventId);
```

移除 `fgq_orders_phones` 全部 rules。移除 editCount 相關條件。

### 元件 8：後台（admin.html）

- `listenOrdersAdmin` 沿用（監聽整個 orders 集合）
- 後三碼改讀 `o.phoneLast3`（取代 `fgq_orders_phones` join，移除 :603-607 的 phones 讀取）
- 後台刪單 transaction：刪 order + 刪 `rate_limits/{orderKey}`（管理員刪除即釋放，不套 10 秒）
- 移除 :505 的 `fgq_orders_phones` 讀取

## 測試策略

### 單元測試（Vitest）
- `quantity.js`：移除 `swapOrderCounters` 測試，其餘沿用；新增/調整讓 `releaseOrderCounters` 與 `applyOrderCounters` 覆蓋
- 新增 `orderKey` 產生函式測試（非法字元取代、格式）

### 元件測試
- 數量上限即時控制：售完品項 checkbox disabled、`+` 達上限 disabled、`_qty` 超過擋住

### E2E（Playwright，`order-flow.spec.js`）
- 重寫為新模型流程：下單 → 統計變動 → 同組合重下被擋 → 不同組合可再下 → 取消 → 10 秒後可重下（測試內等 10 秒或調整 seed）
- `#allOrdersList` 既有失敗為已知問題不阻塞

### seed 調整（`scripts/seed-e2e.mjs`）
- 後台檢視用的 seed 訂單改為 orderKey 文件 id（後三碼_姓名），補 `phoneLast3`、`createdBy` 欄位，移除 `editCount`

## 影響範圍

| 檔案 | 變動 |
|------|------|
| `index.html` | orderKey 下單、移除修改流程、我的訂單 query、即時限量、取消寫 rate_limits |
| `admin.html` | 後三碼改讀 order 文件、刪 rate_limits、移除 fgq_orders_phones |
| `firestore.rules` | orders create/read/update/delete、rate_limits 改 orderKey、移除 fgq_orders_phones 與 editCount |
| `lib/quantity.js` | 移除 `swapOrderCounters` |
| `lib/editlimit.js` | 刪除檔案 |
| `tests/unit/editlimit.test.js` | 刪除檔案 |
| `tests/unit/quantity.test.js` | 移除 swap 相關 |
| `tests/e2e/order-flow.spec.js` | 重寫新模型 |
| `scripts/seed-e2e.mjs` | seed 資料改 orderKey 模型 |
| `操作紀錄.md` | 補記需求變更與驗證 |
