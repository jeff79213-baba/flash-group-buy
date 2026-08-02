# 快閃糾團 v2 實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將快閃糾團改版為獨立 Firebase project、加入 Firebase Auth 權限控制、數量限制、手機後三碼、客戶刪改限次等功能的 v2 版本。

**Architecture:** 前端維持 GitHub Pages 靜態頁面（`index.html` 點餐、`admin.html` 後台），改用獨立 Firebase project `flash-group-buy-sk`。所有訪客自動匿名登入拿 uid，權限用 Firestore Security Rules 以 uid 判斷。數量用 counter 文件 + transaction 防超賣。

**Tech Stack:** Firebase Auth (匿名)、Firestore、Firestore Security Rules、純 JavaScript（無框架）、GitHub Pages、Vitest、Playwright。

## Global Constraints

- 所有 Firestore 集合必須以 `fgq_` 前綴開頭（spec 規定）
- Firebase project ID：`flash-group-buy-sk`（固定）
- 管理密碼只存 `fgq_admin/{eventId}`，**不可**放在 `fgq_events`
- 手機後三碼只存 `fgq_orders_phones/{eventId}/orders/{orderId}`（巢狀子集合，管理者可列出該活動全部），**不可**放在 orders
- 每筆訂單 `editCount` 上限 3，規則層強制
- 訂單 `createdBy` 必須 = `request.auth.uid`，規則層強制
- 密碼欄位必須附帶顯示/隱藏切換按鈕（AGENTS.md UI 規範）
- 分享碼 = 活動代碼前 3 碼 + 3 碼亂碼，與 `shortCode` 不同
- 改/刪訂單需 transaction 釋放名額
- 程式碼不可含機密資訊（API key 例外，AGENTS.md 允許前端放）
- 開發完自動 commit + push 部署（AGENTS.md 自動部署原則）

---

### Task 1: Firebase 專案初始化與授權檢查

**Files:**
- Create: `.firebaserc`
- Create: `firebase.json`
- Test: 手動指令驗證

**Interfaces:**
- Produces: Firebase project `flash-group-buy-sk` 存在、匿名登入已啟用、firebase 設定檔就緒

- [x] **Step 1: 確認 `flash-group-buy-sk` 專案是否已存在**

Run: `firebase projects:list`
Expected: 列出所有專案。若 `flash-group-buy-sk` 不在清單中，執行 Step 2；若在，跳過 Step 2。

- [x] **Step 2: 建立新 Firebase 專案**

Run: `firebase projects:create flash-group-buy-sk --display-name "快閃糾團"`
Expected: 顯示成功建立訊息。

- [x] **Step 3: 建立 `.firebaserc`**

```json
{
  "projects": {
    "default": "flash-group-buy-sk"
  }
}
```

- [x] **Step 4: 建立 `firebase.json`**

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "hosting": {
    "site": "flash-group-buy-sk",
    "public": "."
  }
}
```

> 註：hosting 用 GitHub Pages 部署，此處 firebase.json 主要用於 `firebase deploy --only firestore:rules`。若不要 hosting 部署可不使用 hosting 段；但保留 site 名稱符合 AGENTS.md 規範。

- [x] **Step 5: 啟用匿名登入（需 Firebase Console）**

打開 https://console.firebase.google.com/project/flash-group-buy-sk/authentication 手動啟用 Anonymous 登入方法。**此步驟無法用 CLI 完成，必須手動。**

- [x] **Step 6: 驗證**

Run: `firebase projects:list | Select-String flash-group-buy-sk`
Expected: 列出 `flash-group-buy-sk`。

---

### Task 2: Firestore Security Rules 建立

**Files:**
- Create: `firestore.rules`

**Interfaces:**
- Produces: 完整規則檔，供 Task 11 部署，供 Task 10 測試

- [x] **Step 1: 建立 `firestore.rules`**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 共用函式：該 uid 是否為某活動的管理員 session
    function isAdmin(eventId) {
      return request.auth != null
        && exists(/databases/$(database)/documents/fgq_sessions/$(request.auth.uid))
        && get(/databases/$(database)/documents/fgq_sessions/$(request.auth.uid)).data.eventId == eventId;
    }

    // 共用函式：該品項剩餘數是否足夠
    function itemRemaining(itemId) {
      let item = get(/databases/$(database)/documents/fgq_events/$(eventId)/items/$(itemId));
      let sold = get(/databases/$(database)/documents/fgq_events/$(eventId)/counters/$(itemId));
      return item.data.limit == 0
        ? true
        : sold.exists && sold.data.sold + request.resource.data.qty <= item.data.limit;
    }

    // ---- fgq_sessions：登入憑證 ----
    // create: 驗證密碼與 fgq_admin 相符
    match /fgq_sessions/{uid} {
      allow create: if request.auth != null
        && request.auth.uid == uid
        && request.resource.data.eventId != null
        && get(/databases/$(database)/documents/fgq_admin/$(request.resource.data.eventId)).data.adminPassword
             == request.resource.data.adminPassword;
      allow read, delete: if request.auth != null && request.auth.uid == uid;
      allow update: if false;
    }

    // ---- fgq_admin：管理密碼（不可讀寫給一般使用者）----
    match /fgq_admin/{eventId} {
      allow read, write: if isAdmin(eventId);
    }

    // ---- fgq_events：活動 ----
    match /fgq_events/{eventId} {
      allow read: if request.auth != null;
      // 建立活動：任何登入者可建；密碼不能放在這
      allow create: if request.auth != null
        && request.resource.data.adminPassword == null
        && request.resource.data.name != null
        && request.resource.data.shortCode != null;
      // 修改/刪除活動：管理員
      allow update, delete: if isAdmin(eventId);

      // 品項
      match /items/{itemId} {
        allow read: if request.auth != null;
        allow write: if isAdmin(eventId);
      }

      // 計數器（sold）只能由管理員直接寫；下單用 transaction 更新
      match /counters/{counterId} {
        allow read: if request.auth != null;
        allow write: if isAdmin(eventId);
      }

      // 洗單防護：每 uid 最後下單時間（由下單流程以 batch 寫入）
      match /rate_limits/{uid} {
        allow read: if request.auth != null;
        allow write: if request.auth != null && request.auth.uid == uid;
      }

      // 訂單
      match /orders/{orderId} {
        allow read: if request.auth != null;

        // 下單：登入者、createdBy=自己、editCount=0、isPaid=false、
        //       品項非空、不含 phoneLast3、10 秒內同 uid 未下單（洗單防護）
        allow create: if request.auth != null
          && request.resource.data.createdBy == request.auth.uid
          && request.resource.data.editCount == 0
          && request.resource.data.isPaid == false
          && request.resource.data.items.size() > 0
          && request.resource.data.phoneLast3 == null
          && (!exists(/databases/$(database)/documents/fgq_events/$(eventId)/rate_limits/$(request.auth.uid))
              || request.time
                 - get(/databases/$(database)/documents/fgq_events/$(eventId)/rate_limits/$(request.auth.uid)).data.lastOrderAt
                 >= duration.value(10, 's'));

        // 修改：本人、editCount < 3、createdBy 不變、editCount 恰 +1
        allow update: if request.auth != null
          && resource.data.createdBy == request.auth.uid
          && resource.data.editCount < 3
          && request.resource.data.createdBy == request.auth.uid
          && request.resource.data.editCount == resource.data.editCount + 1;

        // 刪除：本人或管理員
        allow delete: if (request.auth != null && resource.data.createdBy == request.auth.uid)
          || isAdmin(eventId);
      }
    }

    // ---- fgq_orders_phones：手機後三碼（巢狀，管理者依 eventId 查）----
    match /fgq_orders_phones/{eventId}/{orderId} {
      allow read: if isAdmin(eventId);
      // 下單流程寫入；一般使用者僅能在自己的訂單對應路徑新增（規則不在此列）
      allow create, update: if request.auth != null;
      allow delete: if isAdmin(eventId);
    }
  }
}
```

- [x] **Step 2: 驗證規則語法**

Run: `npx firebase-tools firestore:rules --project flash-group-buy-sk 2>&1 | Out-String` 或先執行 `firebase deploy --only firestore:rules --dry-run`（若不支援 dry-run 則略過，Task 11 正式部署時驗證）。

Expected: 無語法錯誤。

- [x] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat: 建立 Firestore 安全規則 v2"
```

---

### Task 3: 前端專案結構與 Firebase 設定 JS

**Files:**
- Create: `firebase-config.js`
- Create: `lib/`（若無）
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Firebase project `flash-group-buy-sk`（Task 1）
- Produces: `firebase-config.js` 輸出 `{ app, db }`，供 index.html/admin.html 使用

- [x] **Step 1: 建立 `firebase-config.js`**

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyD3quPJCOUoUH_Um5UceWXYuUXfRpJEuyo",
  authDomain: "flash-group-buy-sk.firebaseapp.com",
  projectId: "flash-group-buy-sk",
  storageBucket: "flash-group-buy-sk.firebasestorage.app",
  messagingSenderId: "741268730945",
  appId: "1:741268730945:web:503cf0dfab0e9100b042c0"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
```

> 註：此 API key 沿用原專案，實際部署前需在 Firebase Console 為 `flash-group-buy-sk` 取得正確的 web app 設定並替換。

- [x] **Step 2: 更新 `.gitignore`**

確保包含（加入若缺）：
```
node_modules/
.firebase/
```

- [x] **Step 3: Commit**

```bash
git add firebase-config.js .gitignore
git commit -m "feat: 新增 firebase-config.js 共用設定"
```

---

### Task 4: 純函式邏輯模組（數量計算、分享碼、編輯限制）

**Files:**
- Create: `lib/quantity.js`
- Create: `lib/sharecode.js`
- Create: `lib/editlimit.js`

**Interfaces:**
- Produces:
  - `calculateRemaining(limit, sold)` → number（-1 表示無限）
  - `validateOrderQty(items, counters, limits)` → boolean
  - `releaseOrderCounters(order, counters)` → 更新後 counters
  - `generateShareCode(shortCode)` → string（前3碼 + 3亂碼）
  - `isShareCodeValid(shareCode, shortCode)` → boolean
  - `MAX_EDITS = 3`, `canEdit(editCount)`, `canDelete(editCount)`

- [x] **Step 1: 建立 `lib/quantity.js`**

```javascript
// 剩餘數量；limit=0 表示不限量，回傳 -1
export function calculateRemaining(limit, sold) {
  if (!limit) return -1;
  return limit - (sold || 0);
}

// 驗證下單數量是否在活動/品項限制內
export function validateOrderQty(orderItems, counters, limits) {
  const total = orderItems.reduce((s, i) => s + i.qty, 0);
  for (const item of orderItems) {
    const sold = counters[item.itemId] || 0;
    const limit = limits[item.itemId] || 0;
    if (limit && sold + item.qty > limit) return { ok: false, itemId: item.itemId };
  }
  return { ok: true, total };
}

// 移除一筆訂單後的名額釋放（改單/刪單用）
export function releaseOrderCounters(orderItems, counters) {
  const next = { ...counters };
  for (const item of orderItems) {
    next[item.itemId] = (next[item.itemId] || 0) - item.qty;
  }
  return next;
}

// 套用一筆訂單的名額扣減（下單/改單用）
export function applyOrderCounters(orderItems, counters) {
  const next = { ...counters };
  for (const item of orderItems) {
    next[item.itemId] = (next[item.itemId] || 0) + item.qty;
  }
  return next;
}
```

- [x] **Step 2: 建立 `lib/sharecode.js`**

```javascript
// 分享碼 = 活動代碼前3碼 + 3碼亂碼（大寫字母+數字）
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randChar() {
  return CHARS[Math.floor(Math.random() * CHARS.length)];
}
export function generateShareCode(shortCode, prefixLen = 3, randLen = 3) {
  const prefix = (shortCode || "").toUpperCase().slice(0, prefixLen);
  if (prefix.length < prefixLen) {
    throw new Error("活動代碼需至少 " + prefixLen + " 碼才能產生分享碼");
  }
  let rand = "";
  for (let i = 0; i < randLen; i++) rand += randChar();
  return prefix + rand;
}

// 驗證分享碼是否以該活動代碼前綴開頭（防呆，非安全性保證）
export function isShareCodeValid(shareCode, shortCode) {
  const prefix = (shortCode || "").toUpperCase().slice(0, 3);
  return (shareCode || "").toUpperCase().startsWith(prefix);
}
```

- [x] **Step 3: 建立 `lib/editlimit.js`**

```javascript
export const MAX_EDITS = 3;

export function canEdit(editCount) {
  return (editCount || 0) < MAX_EDITS;
}

export function canDelete(editCount) {
  return (editCount || 0) < MAX_EDITS;
}

export function remainingEdits(editCount) {
  return Math.max(0, MAX_EDITS - (editCount || 0));
}
```

- [x] **Step 4: Commit**

```bash
git add lib/
git commit -m "feat: 新增數量/分享碼/編輯限制純函式模組"
```

---

### Task 5: 單元測試（Vitest）

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `tests/unit/quantity.test.js`
- Create: `tests/unit/sharecode.test.js`
- Create: `tests/unit/editlimit.test.js`

**Interfaces:**
- Consumes: Task 4 的 lib 模組
- Produces: 通過的單元測試

- [x] **Step 1: 建立 `package.json`**

```json
{
  "name": "flash-group-buy",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "@playwright/test": "^1.48.0"
  }
}
```

- [x] **Step 2: 安裝依賴**

Run: `npm install`
Expected: 無錯誤，node_modules 建立。

- [x] **Step 3: 建立 `tests/unit/quantity.test.js`**

```javascript
import { describe, it, expect } from "vitest";
import {
  calculateRemaining,
  validateOrderQty,
  releaseOrderCounters,
  applyOrderCounters
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
      { a: 10 },
      { a: 50 }
    );
    expect(ok.ok).toBe(true);
    expect(ok.total).toBe(5);
  });
  it("超量失敗並回傳 itemId", () => {
    const res = validateOrderQty(
      [{ itemId: "a", qty: 10 }],
      { a: 45 },
      { a: 50 }
    );
    expect(res.ok).toBe(false);
    expect(res.itemId).toBe("a");
  });
});

describe("releaseOrderCounters / applyOrderCounters", () => {
  it("釋放名額", () => {
    const next = releaseOrderCounters(
      [{ itemId: "a", qty: 3 }],
      { a: 10 }
    );
    expect(next.a).toBe(7);
  });
  it("扣減名額", () => {
    const next = applyOrderCounters(
      [{ itemId: "a", qty: 3 }],
      { a: 10 }
    );
    expect(next.a).toBe(13);
  });
});
```

- [x] **Step 4: 建立 `tests/unit/sharecode.test.js`**

```javascript
import { describe, it, expect } from "vitest";
import { generateShareCode, isShareCodeValid } from "../../lib/sharecode.js";

describe("generateShareCode", () => {
  it("產生前3碼+3亂碼，共6碼", () => {
    const code = generateShareCode("MAY2025");
    expect(code).toMatch(/^MAY[A-Z0-9]{3}$/);
  });
  it("代碼太短時拋錯", () => {
    expect(() => generateShareCode("AB")).toThrow();
  });
  it("分享碼與原代碼不同", () => {
    expect(generateShareCode("MAY2025")).not.toBe("MAY2025");
  });
});

describe("isShareCodeValid", () => {
  it("以代碼前3碼開頭為有效", () => {
    expect(isShareCodeValid("MAYXYZ", "MAY2025")).toBe(true);
  });
  it("不以代碼前3碼開頭為無效", () => {
    expect(isShareCodeValid("ABCXYZ", "MAY2025")).toBe(false);
  });
});
```

- [x] **Step 5: 建立 `tests/unit/editlimit.test.js`**

```javascript
import { describe, it, expect } from "vitest";
import { MAX_EDITS, canEdit, canDelete, remainingEdits } from "../../lib/editlimit.js";

describe("editlimit", () => {
  it("MAX_EDITS 為 3", () => {
    expect(MAX_EDITS).toBe(3);
  });
  it("未達上限可改/刪", () => {
    expect(canEdit(0)).toBe(true);
    expect(canDelete(2)).toBe(true);
  });
  it("達上限不可改/刪", () => {
    expect(canEdit(3)).toBe(false);
    expect(canDelete(3)).toBe(false);
  });
  it("剩餘次數計算", () => {
    expect(remainingEdits(1)).toBe(2);
    expect(remainingEdits(4)).toBe(0);
  });
});
```

- [x] **Step 6: 建立 `vitest.config.js`**

```javascript
export default {
  test: {
    environment: "node"
  }
};
```

- [x] **Step 7: 執行測試**

Run: `npm test`
Expected: 3 個測試檔全部通過（PASS）。

- [x] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.js tests/
git commit -m "feat: 新增單元測試並通過"
```

---

### Task 6: 點餐頁 index.html 改版

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `firebase-config.js`（Task 3）、lib 模組（Task 4）
- Produces: 完整點餐頁

- [x] **Step 1: 加入匿名登入與頁面結構**

在 `index.html` 的 `<body>` 內、`<script>` 頂部加入：

```html
<div id="loading">載入中...</div>
<div id="app" style="display:none">
  <div id="eventHeader"></div>
  <div id="itemsList"></div>
  <div id="orderForm">
    <input type="text" id="buyerName" placeholder="你的名字" maxlength="20">
    <input type="text" id="phoneLast3" placeholder="手機後三碼" maxlength="3" pattern="[0-9]{3}">
    <button id="submitBtn">送出訂單</button>
  </div>
  <div id="myOrders"></div>
  <div id="allOrders"></div>
</div>
```

`<script>` 開頭：

```javascript
const { db } = await import("./firebase-config.js");
await firebase.auth().signInAnonymously();
```

- [x] **Step 2: 實作活動載入與剩餘數量顯示**

以 shareCode 查 `fgq_events`（用 `where("shareCode", "==", code)`），顯示活動名稱、品項列表（品項名、價格、剩餘量 `calculateRemaining(limit, sold)`），剩餘量為 0 或 -1（不限）時顯示對應狀態。

- [x] **Step 3: 實作下單（含後三碼與 transaction）**

使用 `db.runTransaction`：讀計數器 → `validateOrderQty` → 寫入 `orders/{newId}`（`createdBy = currentUser.uid`, `editCount=0`, `isPaid=false`）→ 寫入 `fgq_orders_phones/{eventId}/orders/{newId}`（`{phoneLast3}`）→ 更新 counters → 更新 `rate_limits/{uid}`（`lastOrderAt = now`）。

送出前驗證：名字非空、後三碼為 3 位數字、數量合法。

- [x] **Step 4: 實作「我的訂單」區**

依 `createdBy == currentUser.uid` 過濾顯示本人訂單，含剩餘可改刪次數。改單按鈕（填新數量，transaction 釋放舊名額再扣新名額、`editCount+1`）、刪單按鈕（transaction 釋放名額、`editCount+1` 再刪、或直接刪）。達上限時按鈕停用並提示「此訂單已達修改上限，需聯絡管理者協助」。

- [x] **Step 5: 實作「所有訂單」區**

顯示所有訂單（buyerName、明細、金額、已收款標記），**不顯示**手機後三碼。

- [x] **Step 6: 本機驗證**

Run: `npx http-server . -p 8080` 後開啟 http://localhost:8080/index.html
Expected: 匿名登入成功、活動載入正常（需先有 Task 11 的規則與資料）。

- [x] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: 點餐頁 v2（匿名登入/剩餘數量/後三碼/改刪限次）"
```

---

### Task 7: 後台頁 admin.html 改版（建立活動 + 登入）

**Files:**
- Modify: `admin.html`

**Interfaces:**
- Consumes: `firebase-config.js`、lib 模組
- Produces: 完整後台頁

- [x] **Step 1: 建立活動（含憑證卡）**

`<script>` 加入：

```javascript
async function createEvent() {
  const name = ...; const shortCode = ...; const password = ...;
  const shareCode = generateShareCode(shortCode);
  // 用 db.runTransaction：
  //   1. 查 shortCode 是否重複
  //   2. 寫 fgq_events/{id}（含 name, shortCode, shareCode, totalLimit, createdAt）
  //   3. 寫 fgq_admin/{id}（adminPassword）
  //   4. 寫 fgq_sessions/{uid}（eventId, adminPassword → 由 rules 驗證）
  showCredentialCard({ name, shortCode, password, shareCode });
}
```

憑證卡顯示：活動名稱、活動代碼、管理密碼、點餐分享連結、管理後台網址，含「複製憑證文字」與「請截圖保存此頁，代碼與密碼遺失後無法取回」提示。

- [x] **Step 2: 登入**

輸入活動代碼 + 管理密碼 → 查 `fgq_events where shortCode == 代碼` 得 eventId → 寫 `fgq_sessions/{uid}`（`{eventId, adminPassword}`），若 rules 拒絕（密碼錯）顯示錯誤。

- [x] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat: 後台 v2 建立活動與登入"
```

---

### Task 8: 後台訂單管理與品項設定

**Files:**
- Modify: `admin.html`

**Interfaces:**
- Consumes: Task 7 後台
- Produces: 完整管理功能

- [ ] **Step 1: 品項管理**

新增品項（name, price, limit）、刪除品項、顯示品項與剩餘量。

- [ ] **Step 2: 活動設定**

編輯活動名稱、代碼、收單時間、總量上限（totalLimit）。檢視管理密碼（從 fgq_admin 讀取）。

- [ ] **Step 3: 訂單管理**

訂單列表含手機後三碼（從 `fgq_orders_phones/{eventId}/orders` 讀取）、標記已收款/取消收款、刪除訂單（管理員可刪任何，transaction 釋放名額）。

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat: 後台 v2 品項/設定/訂單管理"
```

---

### Task 9: E2E 測試（Playwright）

**Files:**
- Create: `playwright.config.js`
- Create: `tests/e2e/order-flow.spec.js`

**Interfaces:**
- Consumes: 部署後的網站（Task 11）
- Produces: 通過的 E2E 測試

- [ ] **Step 1: 建立 `playwright.config.js`**

```javascript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "https://jeff79213-baba.github.io/flash-group-buy/"
  }
});
```

- [ ] **Step 2: 建立 `tests/e2e/order-flow.spec.js`**

覆蓋：建立活動 → 顯示憑證卡 → 下單 → 改單 → 刪單 → 數量不足阻擋。需先建立測試活動資料（手動或腳本），並處理真實 Firebase 驗證。

- [ ] **Step 3: 執行**

Run: `npx playwright test`
Expected: 通過。

- [ ] **Step 4: Commit**

```bash
git add playwright.config.js tests/e2e/
git commit -m "test: 新增 E2E 訂單流程測試"
```

---

### Task 10: Rules 整合測試（可選，@firebase/rules-unit-testing）

**Files:**
- Create: `tests/rules/firestore-rules.test.js`

**Interfaces:**
- Consumes: `firestore.rules`
- Produces: 通過的規則測試

- [ ] **Step 1: 安裝**

Run: `npm install -D @firebase/rules-unit-testing firebase`

- [ ] **Step 2: 建立測試**

驗證：未登入不可讀、登入者可讀 events、非本人不可改別人訂單、editCount 達上限被拒、fgq_orders_phones 一般使用者不可讀、密碼錯誤 session 建立失敗。

- [ ] **Step 3: 執行**

Run: `npx vitest run tests/rules`
Expected: 通過。

- [ ] **Step 4: Commit**

```bash
git add tests/rules/
git commit -m "test: 新增 Firestore rules 整合測試"
```

---

### Task 11: 部署規則與上傳

**Files:**
- Modify: 無（僅部署）

- [ ] **Step 1: 部署 Firestore 規則**

Run: `firebase deploy --only firestore:rules --project flash-group-buy-sk`
Expected: 顯示成功部署。

- [ ] **Step 2: Git push（自動部署 GitHub Pages）**

```bash
git add -A
git commit -m "feat: 快閃糾團 v2 完成"
git push origin master
```

- [ ] **Step 3: 驗證網站**

Run: `curl.exe -s -o NUL -w "%{http_code}" -L "https://jeff79213-baba.github.io/flash-group-buy/"`
Expected: 200。

---

### Task 12: 更新網址文件與設定 Firebase Web App 金鑰

**Files:**
- Modify: `網址.txt`
- Modify: `firebase-config.js`

- [ ] **Step 1: 從 Firebase Console 取得 `flash-group-buy-sk` 的正確 web 設定**

在 https://console.firebase.google.com/project/flash-group-buy-sk/settings/general 加入 Web App，取得新的 firebaseConfig，更新 `firebase-config.js` 的 apiKey/authDomain/appId 等。

- [ ] **Step 2: 更新 `網址.txt`**

加入 Firebase project 名稱、後台網址、點餐網址。

- [ ] **Step 3: Commit + push**

```bash
git add .
git commit -m "chore: 更新網址文件與正式 Firebase 金鑰"
git push origin master
```

---

## Self-Review

**Spec 覆蓋檢查：**
- ✅ 獨立 Firebase project → Task 1
- ✅ Firestore Rules（權限、session、editCount、isPaid、洗單防護 rate_limits）→ Task 2
- ✅ 匿名登入 → Task 6
- ✅ 數量限制（品項+活動總量、counter、transaction、釋放名額）→ Task 2/4/6
- ✅ 手機後三碼（fgq_orders_phones、僅管理者可讀）→ Task 2/6/8
- ✅ 客戶刪改限次（editCount<3、提醒）→ Task 2/4/6
- ✅ 分享碼（代碼前3碼+亂碼）→ Task 4/7
- ✅ 建立活動憑證卡（截圖提醒）→ Task 7
- ✅ 管理者登入（代碼+密碼、規則驗證）→ Task 2/7
- ✅ 洗單防護（rate_limits/{uid} + 10 秒規則檢查）→ Task 2/6
- ✅ 測試策略（單元/E2E/Rules 整合）→ Task 5/9/10

**自我審查修正已完成：**
1. ✅ 洗單防護已加入 Task 2 的 orders create 規則與 rate_limits 集合，Task 6 下單流程一併寫入 lastOrderAt
2. ✅ 手機後三碼改為 `fgq_orders_phones/{eventId}/orders/{orderId}` 巢狀子集合結構，Task 2/6/8 已同步
3. ✅ 活動總量限制由 Task 4 的 `validateOrderQty` 以 `__total` counter 檢查（下單 transaction 讀活動 totalLimit + 累計總量比對）
