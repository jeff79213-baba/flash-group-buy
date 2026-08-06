import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE || "https://jeff79213-baba.github.io/flash-group-buy/";

// 測試用活動（seed 腳本建立）
const SHARE_CODE = process.env.E2E_SHARE_CODE || "E2ETST";
const SHORT_CODE = process.env.E2E_SHORT_CODE || "E2E123456";
const PASSWORD = process.env.E2E_PASSWORD || "e2e12345";
const EVENT_NAME = process.env.E2E_EVENT_NAME || "E2E測試揪團";
const ITEM_LIMITED = "測試蛋糕";
const ITEM_UNLIMITED = "測試餅乾";

test("點餐頁載入活動並顯示品項剩餘", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(ITEM_LIMITED, { exact: true })).toBeVisible();
  // 限量品項顯示剩餘數量（依目前銷售數動態，僅驗證格式）
  await expect(page.locator(".item-remain").first()).toHaveText(/^剩餘 \d+ 份$/);
  await expect(page.getByText(ITEM_UNLIMITED, { exact: true })).toBeVisible();
  await expect(page.getByText("不限量")).toBeVisible();
});

test("選購品項可勾選並增減數量（- 號可減少）", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });

  // 勾選前 - 按鈕 disabled
  await expect(page.locator(`.item-check[data-id="cake"]`).first()).toBeEnabled();
  const minusBtn = page.locator(`.item-row:has(.item-check[data-id="cake"]) button`).first();
  await expect(minusBtn).toBeDisabled();

  await page.locator(`.item-check[data-id="cake"]`).check();
  await expect(page.locator(`#qty-cake`)).toHaveText("1");
  await expect(minusBtn).toBeEnabled();

  await minusBtn.click();
  await expect(page.locator(`#qty-cake`)).toHaveText("0");
  // 數量歸零後 - 再次 disabled
  await expect(minusBtn).toBeDisabled();
});

test("下單 → 顯示在我的訂單 + 統計張數增加", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });

  const statsText = await page.locator("#statsList").innerText();
  const beforeOrders = parseInt(statsText.match(/(\d+)\s*張訂單/)?.[1] || "0", 10);

  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "E2E買家");
  await page.fill("#phoneLast3", "123");
  await page.click("#submitBtn");

  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#myOrdersList").getByText("E2E買家")).toBeVisible();
  await expect(page.locator("#statsList")).toHaveText(new RegExp((beforeOrders + 1) + "\\s*張訂單"), { timeout: 15000 });
});

test("後三碼驗證：非 3 位數字會被阻擋", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await page.locator(`.item-check[data-id]`).first().check();
  await page.fill("#buyerName", "E2E後三碼錯");
  await page.fill("#phoneLast3", "12");
  await page.click("#submitBtn");
  await expect(page.getByText("請輸入 3 位數字手機後三碼")).toBeVisible();
});

test("空名字被阻擋", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });
  await page.locator(`.item-check[data-id]`).first().check();
  await page.fill("#phoneLast3", "999");
  await page.click("#submitBtn");
  await expect(page.getByText("請輸入你的名字")).toBeVisible();
});

test("同組合重複下單被擋", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });

  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "重複測試");
  await page.fill("#phoneLast3", "111");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });

  // 同姓名+同後三碼再下 → 被擋
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "重複測試");
  await page.fill("#phoneLast3", "111");
  await page.click("#submitBtn");
  await expect(page.getByText(/送出失敗.*已下過單/)).toBeVisible({ timeout: 15000 });
});

test("不同組合（同人可多筆）可再下單", async ({ page }) => {
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });

  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "多筆測試A");
  await page.fill("#phoneLast3", "222");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });

  // 同人不同後三碼 → 可再下
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "多筆測試A");
  await page.fill("#phoneLast3", "333");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });

  // 不同人名同後三碼 → 可再下
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "多筆測試B");
  await page.fill("#phoneLast3", "222");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });

  await expect(page.locator("#myOrdersList").getByText("多筆測試A")).toHaveCount(2);
  await expect(page.locator("#myOrdersList").getByText("多筆測試B")).toHaveCount(1);
});

test("取消訂單 → 10 秒內同組合重下被擋 → 10 秒後可重下", async ({ browser }) => {
  test.setTimeout(120000);
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + "index.html?id=" + SHARE_CODE);
  await expect(page.getByText(EVENT_NAME)).toBeVisible({ timeout: 20000 });

  // 下單
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "冷卻測試");
  await page.fill("#phoneLast3", "444");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });

  // 取消
  page.on("dialog", d => d.accept());
  await page.locator("#myOrdersList button").click();
  await expect(page.getByText("訂單已取消")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#myOrdersList").getByText("冷卻測試")).not.toBeVisible();

  // 10 秒內用相同組合重下 → 被規則擋
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "冷卻測試");
  await page.fill("#phoneLast3", "444");
  await page.click("#submitBtn");
  await expect(page.getByText(/送出失敗/)).toBeVisible({ timeout: 15000 });

  // 等 11 秒後可重下
  await page.waitForTimeout(11000);
  await page.locator(`.item-check[data-id="cake"]`).check();
  await page.fill("#buyerName", "冷卻測試");
  await page.fill("#phoneLast3", "444");
  await page.click("#submitBtn");
  await expect(page.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });
  await page.close();
});

test("管理者登入後台並看到訂單（含後三碼）", async ({ browser }) => {
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
  await buyer.fill("#buyerName", "後台檢視測試");
  await buyer.fill("#phoneLast3", "555");
  await buyer.click("#submitBtn");
  await expect(buyer.getByText("訂單已送出！")).toBeVisible({ timeout: 15000 });

  await admin.locator(".tab:has-text('訂單列表')").click();
  await expect(admin.locator("#ordersAdminList").getByText("後台檢視測試")).toBeVisible({ timeout: 15000 });
  // 後三碼直接從 order 文件讀取
  await expect(admin.locator("#ordersAdminList").getByText("後三碼 555")).toBeVisible();
  await buyer.close();
  await admin.close();
});

test("錯誤密碼登入失敗", async ({ page }) => {
  await page.goto(BASE + "admin.html");
  await page.fill("#loginShortCode", SHORT_CODE);
  await page.fill("#loginPassword", "wrongpassword");
  await page.click("button:has-text('登入')");
  await expect(page.getByText("密碼錯誤或登入失敗")).toBeVisible({ timeout: 15000 });
});
