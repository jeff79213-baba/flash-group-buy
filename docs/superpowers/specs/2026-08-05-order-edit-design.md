# 快閃揪團：訂單修改 / 取消功能設計

- 日期：2026-08-05
- 狀態：已與使用者確認需求與設計
- 相關檔案：`index.html`、`firestore.rules`、`lib/editlimit.js`、`lib/quantity.js`

## 背景與目標

目前設計為「每人（每裝置）限一單，訂單送出後不可修改」。實務上客人下單後常有加購、改數量、填錯資料的需求。本功能讓客人在下單頁直接修改／取消自己的訂單，主辦後台維持現狀（僅刪單）。

### 已確認需求
1. 客人可修改自己的訂單：**換品項、改數量、改名字、改手機後三碼**
2. 客人可**取消自己的訂單**
3. 每位客人對自己的訂單最多修改/取消 **3 次**（沿用既有 `editCount` 設計與 `lib/editlimit.js`）
4. 取消訂單後清除 `rate_limits`，**允許同一裝置重新下新單**（新單 `editCount` 從 0 起）
5. 後台管理頁**不加**編輯訂單功能（維持刪單）

## 既有基礎（沿用）

- `order` doc id = 客人 uid（每人一單）；欄位含 `editCount`（建單時 0）、`isPaid`、`items`、`totalPrice`、`buyerName`、`createdAt`
- `lib/editlimit.js`：`MAX_EDITS = 3`、`canEdit`、`canDelete`、`remainingEdits`（已有單元測試，但尚未被頁面使用）
- `lib/quantity.js`：`validateOrderQty`（驗證數量上限/庫存）、`applyOrderCounters`（計算 counter 增量）
- `fgq_orders_phones/{eventId}/orders/{orderId}`：存後三碼 `phoneLast3`
- `rate_limits/{uid}`：洗單防護（10 秒規則）；規則已允許本人 `delete`
- 下單 transaction 已含「訂單已存在即拒絕」（上一輪 bug 修復，不得移除）

## 架構與元件

### 元件 1：下單頁「我的訂單」區塊（index.html）
- 已下單時，卡片顯示訂單明細 + 剩餘可改次數提示（「還可修改 N 次」）
- `canEdit(editCount)` 為 true 時顯示「修改」按鈕，`canDelete(editCount)` 為 true 時顯示「取消」按鈕
- 次數用罄（`editCount == 3`）時不顯示按鈕，改顯示「訂單已達修改上限，如需調整請聯絡主辦」

### 元件 2：修改流程（index.html）
1. 點「修改」→ 現有訂單回填到選購表單（品項勾選、數量、名字、後三碼），送出按鈕文字改為「更新訂單」
2. 送出時走獨立 transaction `updateOrder`：
   - `tx.get` 讀目前 order、counters、品項
   - 名字與後三碼沿用下單驗證：名字必填、後三碼須為 3 位數字
   - `validateOrderQty` 驗證新數量（仍受品項上限/庫存限制）
   - `tx.update(orderRef)`：`items`、`totalPrice`、`buyerName`、`editCount: 舊值 + 1`
   - counters：**釋放舊訂單數量 → 套用新數量**（對每個牽涉品項與 `__total`、`__orders` 正確增減；`__orders` 人數不變）
   - `fgq_orders_phones/{eventId}/orders/{uid}`：更新 `phoneLast3`
3. 更新成功後 toast「訂單已更新」，重整表單與統計

### 元件 3：取消流程（index.html）
1. 點「取消」→ 確認框（提示剩餘可改次數）
2. 送出時走 transaction `cancelOrder`：
   - `tx.get` 讀 order 與 counters
   - `tx.delete(orderRef)`
   - counters：**釋放**該訂單的所有品項數量與 `__total`、`__orders`
   - `tx.delete(rate_limits/{uid})`（允許重下新單）
   - 刪除 `fgq_orders_phones/{eventId}/orders/{uid}`
3. 取消後 toast「訂單已取消」，頁面回到未下單狀態（可重新下單）

### 元件 4：Firestore Security Rules（firestore.rules）
`orders` 規則調整（保留 `create` 現狀與 rate_limits 10 秒檢查）：

```
allow update: if isAdmin(eventId)
  || (orderId == request.auth.uid
      && request.resource.data.editCount == resource.data.editCount + 1
      && request.resource.data.editCount <= 3
      && request.resource.data.isPaid == resource.data.isPaid
      && request.resource.data.createdBy == resource.data.createdBy);

allow delete: if isAdmin(eventId)
  || (orderId == request.auth.uid && resource.data.editCount < 3);
```

- 本人 update 必須 `editCount` 恰好 +1 且 ≤3、`isPaid` 不可變（僅主辦可改收款）、`createdBy` 不可變
- 本人 delete 需 `editCount < 3`（取消也算一次）
- `rate_limits` 的本人 delete 已允許，不需改
- counters 的 create/update 既有 `±99` 小額變動規則已足以涵蓋釋放/重加，不需改

## 資料流摘要

| 動作 | order | counters | rate_limits | fgq_orders_phones |
|------|-------|----------|-------------|-------------------|
| 下單（既有） | create | +qty/+total/+1人 | set lastOrderAt | set phoneLast3 |
| 修改 | update (editCount+1) | 釋放舊 + 套用新 | 不變 | update phoneLast3 |
| 取消 | delete | 釋放全部 | delete（可重下） | delete |

## 錯誤處理

- 修改時新數量超過品項剩餘/上限 → `validateOrderQty` 拒絕，toast「部分品項數量不足」
- 修改/取消後 counter 不得為負（transaction 內讀取當前值計算）
- 規則違規（直接覆寫、改 isPaid、超過次數）→ transaction 失敗，catch 顯示錯誤訊息
- `editCount == 3` 後隱藏修改/取消按鈕，避免使用者嘗試

## 測試策略

- **單元測試**（Vitest）：
  - `lib/quantity.js` 新增或擴充「釋放 counter」純函式（取消時計算釋放量）
  - `lib/editlimit.js` 既有測試維持（`canEdit`/`canDelete`/`remainingEdits`）
- **E2E（Playwright，符合 AGENTS.md 跨角色權限條件）**：
  - 客人下單 → 修改數量 → 後台訂單列表顯示更新後的數量與 `editCount`
  - 客人取消訂單 → 後台訂單消失 → 同一裝置可重新下新單
  - 修改次數達 3 次後按鈕消失
  - 客人無法修改 `isPaid`（規則擋）

## 非目標（YAGNI）

- 後台編輯訂單功能（使用者明確認定不需要）
- 修改次數放寬/可設定（沿用固定 3 次）
- 多訂單（同 uid 多筆）機制（維持每人一單）
