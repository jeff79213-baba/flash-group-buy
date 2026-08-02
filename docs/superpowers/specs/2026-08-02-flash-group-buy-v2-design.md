# 快閃糾團 v2 設計文件

日期：2026-08-02

## 背景

原「快閃糾團」使用 `opencode-sk` Firebase project 的 Firestore（集合 `events`），與庫存管理等專案共用，導致規則被覆蓋、網站無法連線、管理密碼明文暴露等問題。本次改版：

1. 建立**獨立 Firebase project**（`flash-group-buy-sk`）隔離資料
2. 修復資安問題（密碼驗證、權限控制、防竄改/洗單/洩漏）
3. 新增功能：團購數量限制、手機後三碼、客戶刪改限次

## 架構

- **前端**：GitHub Pages 靜態頁面（`index.html` 點餐頁、`admin.html` 管理者後台）
- **身分**：Firebase Auth 匿名登入（每裝置一 uid），權限全部以 uid 判斷
- **資料庫**：Firestore（獨立 project `flash-group-buy-sk`）

## 資料結構

所有集合使用專案前綴 `fgq_`。

```
fgq_events/{eventId}
  ├── name: string            活動名稱
  ├── shortCode: string       活動代碼（管理者登入用，自訂，如 AAAA）
  ├── shareCode: string       分享碼（點餐連結用，代碼前幾碼+亂碼）
  ├── adminPassword: string   管理密碼（登入驗證用）
  ├── deadline: timestamp     收單時間（可選）
  ├── totalLimit: number      活動總量上限（0=不限）
  ├── createdAt: timestamp
  └── items/{itemId}
        ├── name: string      品項名稱
        ├── price: number     價格
        ├── limit: number     品項數量上限（0=不限）
        └── createdAt: timestamp

fgq_events/{eventId}/orders/{orderId}
  ├── buyerName: string       姓名（顯示於訂單）
  ├── items: array            品項明細 [{name, price, qty}]
  ├── totalPrice: number      總金額
  ├── createdBy: string       下單者 uid
  ├── createdAt: timestamp    下單時間（數量排序依據）
  ├── editCount: number       已用刪改次數（0 起算，上限 3）
  └── isPaid: boolean         收款狀態

fgq_phones/{orderId}          手機後三碼（獨立集合，僅管理者可讀）
  ├── eventId: string
  ├── phoneLast3: string
  └── createdAt: timestamp
```

### 數量計數

數量採「依下單時間排序、先下單先得」，用 Firestore transaction 防超賣。

- 活動剩餘 = `totalLimit` − 該活動所有訂單的品項總量
- 品項剩餘 = `limit` − 該品項在全部訂單中的累計數量
- 改單時：舊數量釋放、新數量重算（即時釋放名額）
- 剩餘數量不足 → 不能下單（前端禁用 + 後端規則把關）

## 權限規則（Firestore Security Rules）

| 動作 | 誰能 | 說明 |
|------|------|------|
| 讀活動/品項/訂單 | 所有登入者 | 訂單明細不含 `phoneLast3`（存於 `fgq_phones`） |
| 讀 `fgq_phones` | 該活動管理者 | 用規則比對 `fgq_sessions` |
| 下單 | 所有登入者 | `createdBy = uid`，受數量限制 |
| 改/刪自己訂單 | 下單者本人 | `editCount < 3` |
| 建品項/設限量/標收款/刪單 | 該活動管理者 | 需先登入建立 session |
| 改活動設定/刪活動 | 該活動管理者 | 同上 |
| 建立活動 | 所有登入者 | 初始無管理 session |
| 建立管理 session | 輸入正確代碼+密碼者 | 寫入 `fgq_sessions/{uid}` |

### 管理者登入機制

管理者在 `admin.html` 輸入**活動代碼 + 管理密碼**。

- 密碼驗證在規則層做：建立 `fgq_sessions/{uid}` 文件，規則檢查該文件的 `eventId + adminPassword` 與 `fgq_events` 是否相符，相符才允許寫入
- 管理操作規則：`request.auth.uid in fgq_sessions` 且 session 對應該活動 → 允許
- 密碼不以明文暴露給一般使用者

### 訂單防竄改

- 訂單建立時 `createdBy` 必須 = `request.auth.uid`（規則強制）
- 後三碼寫入 `fgq_phones/{orderId}`，只有管理者 session 可讀，一般使用者完全無法存取
- 一般使用者不可改別人的訂單（規則比對 `createdBy == request.auth.uid`）
- `editCount` 由規則限制上限 3
- 收款狀態 `isPaid` 只有管理者可改

## 網址設計

- 點餐連結：`https://.../index.html?id={shareCode}`
  - `shareCode` = 活動代碼前幾碼 + 亂碼，**與管理登入用的 `shortCode` 不同**
  - 連結外流也無法反推完整活動代碼
- 管理後台：`https://.../admin.html`（登入填代碼+密碼）

## 建立活動憑證提示

建立活動成功後，**顯示一張憑證資訊卡**，內容包含：

- 活動名稱
- 活動代碼（`shortCode`，登入用）
- 管理密碼
- 點餐分享連結
- 管理後台網址

卡片提供「**複製憑證文字**」與「**開啟可截圖模式**（放大、僅顯示此卡）」的提示，並明確告知管理者：「**請截圖保存此頁，代碼與密碼遺失後無法取回**」。

管理者確認後才進入後台；之後仍可在後台「活動設定」頁重新查看代碼與密碼。

## 洗單防護

- 匿名登入每裝置一 uid，規則限制：每裝置短時間內（例如 10 秒）只能下單一筆，防止連點洗單

## 測試策略

### 單元測試（Vitest）
- 剩餘數量計算函式（活動/品項層級）
- 改單後名額釋放邏輯
- `editCount` 限制判斷
- 分享碼產生與反推防護

### 元件測試（Testing Library）
- 數量不足時按鈕禁用
- 剩餘數量顯示
- 手機後三碼輸入驗證（僅 3 碼數字）
- 訂單明細不含後三碼

### E2E（Playwright）
- 建立活動 → 分享 → 下單 → 改單 → 刪單完整流程
- 數量限制超賣阻擋
- 非管理者無法進後台
